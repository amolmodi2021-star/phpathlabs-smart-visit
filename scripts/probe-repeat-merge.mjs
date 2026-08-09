/**
 * Probe: multiple tests from the same physical tube requested for repeat
 * (CBC then ESR) must collapse into ONE pending tube.
 */
import { execFileSync } from "node:child_process";

const API = "http://127.0.0.1:54421";
const SVC =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

// Use REST for fixture setup; call consolidate logic via SQL mirror of merge
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
const marker = `PROBE MERGE ${Date.now()}`;

try {
  const tests = await api(
    "GET",
    "/rest/v1/tests?select=id,test_name,test_code,price,sample_tube,tube_color,sample_type&test_code=in.(TST0068,TST0105)&is_active=eq.true",
  );
  const cbc = tests.find((t) => t.test_code === "TST0068");
  const esr = tests.find((t) => t.test_code === "TST0105");
  const inv = await rpc("generate_invoice_number");
  const umr = await rpc("generate_umr_number");
  const reg = await rpc("register_patient_atomic", {
    p_registration: {
      invoice_number: inv,
      umr_number: umr,
      title: "MR",
      patient_name: marker,
      gender: "Male",
      mobile_number: "9998855555",
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
  let tubes = await api("GET", `/rest/v1/sample_tubes?registration_id=eq.${regId}&select=*`);
  await api("PATCH", `/rest/v1/sample_tubes?id=eq.${tubes[0].id}`, {
    status: "accepted",
    collected_at: now,
    accepted_at: now,
  });

  // --- Repeat CBC only (split) ---
  await api("DELETE", `/rest/v1/patient_results?registration_id=eq.${regId}&test_id=eq.${cbc.id}`);
  tubes = await api("GET", `/rest/v1/sample_tubes?registration_id=eq.${regId}&select=*`);
  const shared = tubes[0];
  await api("PATCH", `/rest/v1/sample_tubes?id=eq.${shared.id}`, {
    test_ids: [esr.id],
    test_names: [esr.test_name],
  });
  const uid1 = await rpc("generate_sample_uid");
  await api("POST", "/rest/v1/sample_tubes", {
    sample_uid: uid1,
    registration_id: regId,
    tube_type: "EDTA",
    tube_color: "PURPLE",
    sample_type: "WHOLE BLOOD",
    suffix: "R",
    test_ids: [cbc.id],
    test_names: [cbc.test_name],
    status: "pending",
  });
  await api("PATCH", `/rest/v1/patient_registrations?id=eq.${regId}`, {
    status: "repeat_collection",
    repeat_tests: [{ test_id: cbc.id, test_name: cbc.test_name, requested_at: now }],
  });

  // --- Then repeat ESR (would create second pending without merge) ---
  await api("DELETE", `/rest/v1/patient_results?registration_id=eq.${regId}&test_id=eq.${esr.id}`);
  tubes = await api("GET", `/rest/v1/sample_tubes?registration_id=eq.${regId}&select=*`);
  const esrTube = tubes.find((t) => (t.test_ids || []).includes(esr.id) && t.status === "accepted");
  await api("PATCH", `/rest/v1/sample_tubes?id=eq.${esrTube.id}`, {
    status: "pending",
    collected_at: null,
    accepted_at: null,
    test_ids: [esr.id],
    test_names: [esr.test_name],
  });
  await api("PATCH", `/rest/v1/patient_registrations?id=eq.${regId}`, {
    repeat_tests: [
      { test_id: cbc.id, test_name: cbc.test_name, requested_at: now },
      { test_id: esr.id, test_name: esr.test_name, requested_at: now },
    ],
  });

  // Before merge: expect 2 pending EDTA tubes
  let pending = (
    await api("GET", `/rest/v1/sample_tubes?registration_id=eq.${regId}&status=eq.pending&select=*`)
  );
  console.log("BEFORE_MERGE pending=", pending.length, pending.map((t) => t.test_ids));
  if (pending.length < 2) findings.push("SETUP: expected 2 pending before merge");

  // Consolidate (same logic as consolidatePendingRepeatTubes)
  const keep = pending.sort((a, b) => String(a.suffix || "").length - String(b.suffix || "").length)[0];
  const drop = pending.filter((t) => t.id !== keep.id);
  const mergedIds = [];
  const mergedNames = [];
  for (const t of pending) {
    (t.test_ids || []).forEach((id, i) => {
      if (!mergedIds.includes(id)) {
        mergedIds.push(id);
        mergedNames.push((t.test_names || [])[i] || "");
      }
    });
  }
  await api("PATCH", `/rest/v1/sample_tubes?id=eq.${keep.id}`, {
    test_ids: mergedIds,
    test_names: mergedNames,
    status: "pending",
    collected_at: null,
    accepted_at: null,
  });
  if (drop.length) {
    await api("DELETE", `/rest/v1/sample_tubes?id=in.(${drop.map((t) => t.id).join(",")})`);
  }

  pending = await api(
    "GET",
    `/rest/v1/sample_tubes?registration_id=eq.${regId}&status=eq.pending&select=*`,
  );
  console.log("AFTER_MERGE pending=", pending.length, pending.map((t) => t.test_ids));

  const okCount = pending.length === 1;
  const okBoth =
    pending[0] &&
    (pending[0].test_ids || []).includes(cbc.id) &&
    (pending[0].test_ids || []).includes(esr.id);

  if (!okCount) findings.push(`FAIL: expected 1 pending tube, got ${pending.length}`);
  else findings.push("PASS: single pending tube after merge");
  if (!okBoth) findings.push("FAIL: merged tube missing CBC or ESR");
  else findings.push("PASS: merged tube contains CBC+ESR");
} catch (e) {
  findings.push(`Probe error: ${e.message}`);
  console.error(e);
} finally {
  psql(`
    DELETE FROM patient_results WHERE registration_id IN (SELECT id FROM patient_registrations WHERE patient_name LIKE 'PROBE MERGE %');
    DELETE FROM sample_tubes WHERE registration_id IN (SELECT id FROM patient_registrations WHERE patient_name LIKE 'PROBE MERGE %');
    DELETE FROM payment_transactions WHERE registration_id IN (SELECT id FROM patient_registrations WHERE patient_name LIKE 'PROBE MERGE %');
    DELETE FROM patient_registrations WHERE patient_name LIKE 'PROBE MERGE %';
  `);
  console.log("FINDINGS:");
  findings.forEach((f) => console.log("- " + f));
  process.exit(findings.some((f) => f.startsWith("FAIL") || f.startsWith("Probe")) ? 1 : 0);
}
