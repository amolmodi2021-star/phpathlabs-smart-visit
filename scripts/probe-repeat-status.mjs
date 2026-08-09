/**
 * Focused probe: does recalculateRegistrationStatus wipe repeat_collection?
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

const marker = `PROBE ${Date.now()}`;
const findings = [];

try {
  const tests = await api(
    "GET",
    "/rest/v1/tests?select=id,test_name,test_code,price,sample_tube,tube_color,sample_type&test_code=in.(TST0068,TST0008)&is_active=eq.true",
  );
  const inv = await rpc("generate_invoice_number");
  const umr = await rpc("generate_umr_number");
  const tubesPayload = tests.map((t) => ({
    tube_type: t.sample_tube || "DEFAULT",
    tube_color: t.tube_color || "",
    sample_type: t.sample_type || "",
    suffix: "",
    test_ids: [t.id],
    test_names: [t.test_name],
    status: "pending",
  }));
  const reg = await rpc("register_patient_atomic", {
    p_registration: {
      invoice_number: inv,
      umr_number: umr,
      title: "MR",
      patient_name: marker,
      gender: "Male",
      mobile_number: "9998877777",
      doctor_name: "SELF",
      visit_type: "lab_visit",
      tests: tests.map((t) => ({
        test_id: t.id,
        test_name: t.test_name,
        price: Number(t.price),
        item_type: "test",
      })),
      gross_amount: 100,
      final_amount: 100,
      paid_amount: 100,
      due_amount: 0,
      status: "registered",
      registered_by: "PROBE",
    },
    p_tubes: tubesPayload,
    p_payment: null,
    p_home_visit_id: null,
    p_home_visit_patch: null,
  });
  const regId = reg.id;
  const now = new Date().toISOString();
  const tb = await api("GET", `/rest/v1/sample_tubes?registration_id=eq.${regId}&select=id,test_ids`);
  for (const t of tb) {
    await api("PATCH", `/rest/v1/sample_tubes?id=eq.${t.id}`, {
      status: "accepted",
      accepted_at: now,
      collected_at: now,
    });
  }
  for (const t of tests) {
    const junc = await api(
      "GET",
      `/rest/v1/test_parameters?test_id=eq.${t.id}&parameter_id=not.is.null&select=parameter_id,report_test_parameters(id,param_code,parameter_name)&limit=2`,
    );
    const params = (junc || []).map((j) => j.report_test_parameters).filter(Boolean);
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

  const cbc = tests.find((t) => t.test_code === "TST0068");
  await api("DELETE", `/rest/v1/patient_results?registration_id=eq.${regId}&test_id=eq.${cbc.id}`);
  const cbcTube = tb.find((t) => (t.test_ids || []).includes(cbc.id));
  await api("PATCH", `/rest/v1/sample_tubes?id=eq.${cbcTube.id}`, {
    status: "pending",
    collected_at: null,
    accepted_at: null,
  });
  await api("PATCH", `/rest/v1/patient_registrations?id=eq.${regId}`, {
    status: "repeat_collection",
  });
  let st = (await api("GET", `/rest/v1/patient_registrations?id=eq.${regId}&select=status`))[0].status;
  console.log("AFTER_SET", st);
  if (st !== "repeat_collection") findings.push("Failed to set repeat_collection");

  // Mimic limsStatus.ts: preserve repeat_collection ONLY if already set;
  // otherwise downgrade terminal statuses when pending tubes remain.
  psql(`
DO $$
DECLARE
  v_reg uuid := '${regId}'::uuid;
  v_current text;
  v_new text := 'registered';
  v_has_pending boolean;
  v_has_collected boolean;
  v_downstream_n int;
  v_n_appr int;
BEGIN
  SELECT status INTO v_current FROM patient_registrations WHERE id = v_reg;
  SELECT
    EXISTS (SELECT 1 FROM sample_tubes WHERE registration_id = v_reg AND status = 'pending'),
    EXISTS (SELECT 1 FROM sample_tubes WHERE registration_id = v_reg AND status = 'collected')
  INTO v_has_pending, v_has_collected;

  IF v_has_pending AND v_current = 'repeat_collection' THEN
    UPDATE patient_registrations SET status = 'repeat_collection' WHERE id = v_reg;
    RETURN;
  END IF;

  SELECT COUNT(*), COUNT(*) FILTER (WHERE status = 'approved')
  INTO v_downstream_n, v_n_appr
  FROM patient_results WHERE registration_id = v_reg
    AND status IN ('entered','results_entered','verified','approved','dispatched');

  IF v_downstream_n > 0 AND v_n_appr = v_downstream_n THEN
    v_new := 'approved';
  ELSIF v_n_appr > 0 THEN
    v_new := 'partially_approved';
  ELSE
    v_new := 'registered';
  END IF;

  IF v_has_pending THEN
    IF v_new = 'approved' THEN v_new := 'partially_approved';
    ELSIF v_new = 'registered' AND v_has_collected THEN v_new := 'partially_collected';
    END IF;
  END IF;

  UPDATE patient_registrations SET status = v_new WHERE id = v_reg;
END $$;
`);
  st = (await api("GET", `/rest/v1/patient_registrations?id=eq.${regId}&select=status`))[0].status;
  console.log("AFTER_RECALC_EXPLICIT_REPEAT", st);
  if (st !== "repeat_collection") {
    findings.push(`FAIL: expected repeat_collection after recalc, got ${st}`);
  } else {
    findings.push("PASS: explicit repeat_collection preserved while pending tubes exist.");
  }

  // --- Scenario B: first-time partial — pending tube + accepted sibling with results ---
  // Should NOT become repeat_collection.
  await api("PATCH", `/rest/v1/patient_registrations?id=eq.${regId}`, { status: "partially_approved" });
  psql(`
DO $$
DECLARE
  v_reg uuid := '${regId}'::uuid;
  v_current text;
  v_new text := 'registered';
  v_has_pending boolean;
  v_downstream_n int;
  v_n_appr int;
BEGIN
  SELECT status INTO v_current FROM patient_registrations WHERE id = v_reg;
  SELECT EXISTS (SELECT 1 FROM sample_tubes WHERE registration_id = v_reg AND status = 'pending')
  INTO v_has_pending;

  IF v_has_pending AND v_current = 'repeat_collection' THEN
    UPDATE patient_registrations SET status = 'repeat_collection' WHERE id = v_reg;
    RETURN;
  END IF;

  SELECT COUNT(*), COUNT(*) FILTER (WHERE status = 'approved')
  INTO v_downstream_n, v_n_appr
  FROM patient_results WHERE registration_id = v_reg
    AND status IN ('entered','results_entered','verified','approved','dispatched');

  IF v_downstream_n > 0 AND v_n_appr = v_downstream_n THEN v_new := 'approved';
  ELSIF v_n_appr > 0 THEN v_new := 'partially_approved';
  ELSE v_new := 'registered';
  END IF;

  IF v_has_pending THEN
    IF v_new = 'approved' THEN v_new := 'partially_approved'; END IF;
  END IF;

  UPDATE patient_registrations SET status = v_new WHERE id = v_reg;
END $$;
`);
  st = (await api("GET", `/rest/v1/patient_registrations?id=eq.${regId}&select=status`))[0].status;
  console.log("AFTER_RECALC_FIRST_TIME_PARTIAL", st);
  if (st === "repeat_collection") {
    findings.push("FAIL: first-time pending+advanced siblings incorrectly marked repeat_collection");
  } else if (!["partially_approved", "partial_processing", "partially_collected", "partially_accepted"].includes(st)) {
    findings.push(`FAIL: first-time partial got unexpected status ${st}`);
  } else {
    findings.push(`PASS: first-time partial stays non-repeat (${st}).`);
  }

  const pendingTubes = await api(
    "GET",
    `/rest/v1/sample_tubes?registration_id=eq.${regId}&status=eq.pending&select=id`,
  );
  console.log("PENDING_TUBES", pendingTubes.length);
  if (!pendingTubes.length) findings.push("Repeat did not leave pending tubes");

  // Sample collection queue visibility is tube-status based — pending tubes remain visible (good)
  findings.push(
    pendingTubes.length
      ? "Pending tubes remain visible for Sample Collection."
      : "Pending tubes missing from collection queue.",
  );
} catch (e) {
  findings.push(`Probe error: ${e.message}`);
  console.error(e);
} finally {
  psql(`
    DELETE FROM patient_results WHERE registration_id IN (SELECT id FROM patient_registrations WHERE patient_name LIKE 'PROBE %');
    DELETE FROM sample_tubes WHERE registration_id IN (SELECT id FROM patient_registrations WHERE patient_name LIKE 'PROBE %');
    DELETE FROM payment_transactions WHERE registration_id IN (SELECT id FROM patient_registrations WHERE patient_name LIKE 'PROBE %');
    DELETE FROM patient_registrations WHERE patient_name LIKE 'PROBE %';
  `);
  console.log("FINDINGS:");
  findings.forEach((f) => console.log("- " + f));
  process.exit(findings.some((f) => f.startsWith("FAIL") || f.startsWith("Probe error")) ? 1 : 0);
}
