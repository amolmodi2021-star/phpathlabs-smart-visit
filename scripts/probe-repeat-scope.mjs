/**
 * Probe: repeat collection must only affect the requested test.
 * Shared tube (CBC+ESR) → repeat CBC only → ESR tube stays accepted; CBC gets new pending tube.
 */
import { execFileSync } from "node:child_process";

const API = "http://127.0.0.1:54421";
const SVC =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

async function api(method, path, body) {
  const r = await fetch(API + path, {
    method,
    headers: {
      apikey: SVC,
      Authorization: `Bearer ${SVC}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const t = await r.text();
  const d = t ? JSON.parse(t) : null;
  if (!r.ok) throw new Error(t);
  return d;
}
async function rpc(fn, a) {
  return api("POST", `/rest/v1/rpc/${fn}`, a);
}
function psql(sql) {
  return execFileSync(
    "docker",
    ["exec", "-i", "supabase_db_phpathlabs-local", "psql", "-U", "postgres", "-d", "postgres", "-t", "-A"],
    { input: sql, encoding: "utf8" },
  ).trim();
}

const findings = [];
const marker = `PROBE SCOPE ${Date.now()}`;

try {
  const tests = await api(
    "GET",
    "/rest/v1/tests?select=id,test_name,test_code,price,sample_tube,tube_color,sample_type&test_code=in.(TST0068,TST0105)&is_active=eq.true",
  );
  const cbc = tests.find((t) => t.test_code === "TST0068");
  const esr = tests.find((t) => t.test_code === "TST0105");
  if (!cbc || !esr) throw new Error("Need CBC and ESR fixtures");

  const inv = await rpc("generate_invoice_number");
  const umr = await rpc("generate_umr_number");
  // One shared EDTA tube with both tests
  const reg = await rpc("register_patient_atomic", {
    p_registration: {
      invoice_number: inv,
      umr_number: umr,
      title: "MR",
      patient_name: marker,
      gender: "Male",
      mobile_number: "9998866666",
      doctor_name: "SELF",
      visit_type: "lab_visit",
      tests: [cbc, esr].map((t) => ({
        test_id: t.id,
        test_name: t.test_name,
        price: Number(t.price),
        item_type: "test",
      })),
      gross_amount: 200,
      final_amount: 200,
      paid_amount: 200,
      due_amount: 0,
      status: "registered",
      registered_by: "PROBE",
    },
    p_tubes: [
      {
        tube_type: "EDTA",
        tube_color: "PURPLE",
        sample_type: "WHOLE BLOOD",
        suffix: "",
        test_ids: [cbc.id, esr.id],
        test_names: [cbc.test_name, esr.test_name],
        status: "pending",
      },
    ],
    p_payment: null,
    p_home_visit_id: null,
    p_home_visit_patch: null,
  });
  const regId = reg.id;
  const now = new Date().toISOString();
  const tubes0 = await api("GET", `/rest/v1/sample_tubes?registration_id=eq.${regId}&select=*`);
  await api("PATCH", `/rest/v1/sample_tubes?id=eq.${tubes0[0].id}`, {
    status: "accepted",
    collected_at: now,
    accepted_at: now,
  });

  // Enter+approve results for both
  for (const t of [cbc, esr]) {
    const junc = await api(
      "GET",
      `/rest/v1/test_parameters?test_id=eq.${t.id}&parameter_id=not.is.null&select=parameter_id,report_test_parameters(id,param_code,parameter_name)&limit=2`,
    );
    const params = (junc || []).map((j) => j.report_test_parameters).filter(Boolean);
    if (!params.length) continue;
    await api(
      "POST",
      "/rest/v1/patient_results",
      params.map((p) => ({
        registration_id: regId,
        test_id: t.id,
        parameter_id: p.id,
        param_code: p.param_code,
        parameter_name: p.parameter_name,
        result_value: "1",
        status: "approved",
        entered_at: now,
        verified_at: now,
        approved_at: now,
      })),
    );
  }

  // Simulate scoped repeat for CBC only (SQL mirrors applyRepeatCollectionForTests)
  await api("DELETE", `/rest/v1/patient_results?registration_id=eq.${regId}&test_id=eq.${cbc.id}`);
  const tubes = await api("GET", `/rest/v1/sample_tubes?registration_id=eq.${regId}&select=*`);
  const shared = tubes.find((t) => (t.test_ids || []).includes(cbc.id) && (t.test_ids || []).includes(esr.id));
  if (!shared) throw new Error("shared tube missing");

  // Keep ESR on original accepted tube; split CBC to new pending
  await api("PATCH", `/rest/v1/sample_tubes?id=eq.${shared.id}`, {
    test_ids: [esr.id],
    test_names: [esr.test_name],
  });
  const uid = await rpc("generate_sample_uid");
  await api("POST", "/rest/v1/sample_tubes", {
    sample_uid: uid,
    registration_id: regId,
    tube_type: shared.tube_type,
    tube_color: shared.tube_color,
    sample_type: shared.sample_type,
    suffix: "R",
    test_ids: [cbc.id],
    test_names: [cbc.test_name],
    status: "pending",
  });
  await api("PATCH", `/rest/v1/patient_registrations?id=eq.${regId}`, {
    status: "repeat_collection",
    repeat_tests: [{ test_id: cbc.id, test_name: cbc.test_name, requested_at: now }],
  });

  const after = await api("GET", `/rest/v1/sample_tubes?registration_id=eq.${regId}&select=*&order=created_at.asc`);
  const accepted = after.filter((t) => t.status === "accepted");
  const pending = after.filter((t) => t.status === "pending");
  const esrStillAccepted = accepted.some(
    (t) => (t.test_ids || []).includes(esr.id) && !(t.test_ids || []).includes(cbc.id),
  );
  const cbcPendingOnly = pending.some(
    (t) => (t.test_ids || []).includes(cbc.id) && !(t.test_ids || []).includes(esr.id),
  );
  const esrResults = await api(
    "GET",
    `/rest/v1/patient_results?registration_id=eq.${regId}&test_id=eq.${esr.id}&select=id`,
  );
  const cbcResults = await api(
    "GET",
    `/rest/v1/patient_results?registration_id=eq.${regId}&test_id=eq.${cbc.id}&select=id`,
  );
  const regRow = (await api("GET", `/rest/v1/patient_registrations?id=eq.${regId}&select=status,repeat_tests`))[0];

  console.log({
    accepted: accepted.length,
    pending: pending.length,
    esrStillAccepted,
    cbcPendingOnly,
    esrResults: esrResults.length,
    cbcResults: cbcResults.length,
    status: regRow.status,
    repeat_tests: regRow.repeat_tests,
  });

  if (!esrStillAccepted) findings.push("FAIL: ESR tube was not kept accepted");
  else findings.push("PASS: ESR remains on accepted tube");
  if (!cbcPendingOnly) findings.push("FAIL: CBC was not split to its own pending tube");
  else findings.push("PASS: CBC-only pending tube created");
  if (!esrResults.length) findings.push("FAIL: ESR results were wiped");
  else findings.push("PASS: ESR results preserved");
  if (cbcResults.length) findings.push("FAIL: CBC results should be deleted");
  else findings.push("PASS: CBC results cleared");
  if (regRow.status !== "repeat_collection") findings.push(`FAIL: status=${regRow.status}`);
  else findings.push("PASS: registration marked repeat_collection");
  if (!Array.isArray(regRow.repeat_tests) || regRow.repeat_tests.length !== 1 || regRow.repeat_tests[0].test_id !== cbc.id) {
    findings.push("FAIL: repeat_tests should list only CBC");
  } else findings.push("PASS: repeat_tests lists only CBC");
} catch (e) {
  findings.push(`Probe error: ${e.message}`);
  console.error(e);
} finally {
  psql(`
    DELETE FROM patient_results WHERE registration_id IN (SELECT id FROM patient_registrations WHERE patient_name LIKE 'PROBE SCOPE %');
    DELETE FROM sample_tubes WHERE registration_id IN (SELECT id FROM patient_registrations WHERE patient_name LIKE 'PROBE SCOPE %');
    DELETE FROM payment_transactions WHERE registration_id IN (SELECT id FROM patient_registrations WHERE patient_name LIKE 'PROBE SCOPE %');
    DELETE FROM patient_registrations WHERE patient_name LIKE 'PROBE SCOPE %';
  `);
  console.log("FINDINGS:");
  findings.forEach((f) => console.log("- " + f));
  process.exit(findings.some((f) => f.startsWith("FAIL") || f.startsWith("Probe")) ? 1 : 0);
}
