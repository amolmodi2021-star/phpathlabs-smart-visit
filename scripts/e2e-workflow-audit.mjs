/**
 * READ-ONLY audit of local LIMS workflow (no app code edits).
 * Creates estimate → HV → register (with tubes) → collect → accept →
 * results → verify → approve → dispatch, then DELETES all created rows.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import crypto from "node:crypto";

const API = "http://127.0.0.1:54421";
const ANON =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const SVC =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const report = {
  startedAt: new Date().toISOString(),
  steps: [],
  issues: [],
  created: {},
  cleaned: false,
};

function note(step, ok, detail) {
  report.steps.push({ step, ok, detail, at: new Date().toISOString() });
  console.log(`${ok ? "OK" : "FAIL"}  ${step}${detail ? " — " + detail : ""}`);
}
function issue(severity, detail) {
  report.issues.push({ severity, detail });
  console.log(`ISSUE[${severity}] ${detail}`);
}

async function api(method, path, body, key = SVC) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: method === "POST" ? "return=representation" : "return=representation",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const err = new Error(`${method} ${path} → ${res.status}: ${text}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

async function rpc(fn, args = {}) {
  return api("POST", `/rest/v1/rpc/${fn}`, args);
}

function psql(sql) {
  return execFileSync(
    "docker",
    ["exec", "-i", "supabase_db_phpathlabs-local", "psql", "-U", "postgres", "-d", "postgres", "-t", "-A", "-v", "ON_ERROR_STOP=1"],
    { input: sql, encoding: "utf8" },
  ).trim();
}

function uuid() {
  return crypto.randomUUID();
}

async function main() {
  // --- 0. Preconditions ---
  const tests = await api(
    "GET",
    "/rest/v1/tests?select=id,test_name,test_code,price,sample_tube,sample_type,tube_color&is_active=eq.true&order=test_name.asc",
  );
  if (!tests?.length) throw new Error("No active tests");

  // Prefer a test that has at least one real parameter (not only subheaders)
  let test = null;
  for (const t of tests) {
    const junc = await api(
      "GET",
      `/rest/v1/test_parameters?test_id=eq.${t.id}&parameter_id=not.is.null&select=parameter_id&limit=1`,
    );
    if (junc?.length) {
      test = t;
      break;
    }
  }
  if (!test) test = tests[0];
  note("precheck.tests", true, `using ${test.test_code || test.test_name} (${test.id})`);

  const tubesMeta = await api(
    "GET",
    `/rest/v1/test_sample_tubes?test_id=eq.${test.id}&select=*`,
  );
  note("precheck.test_sample_tubes", true, `${tubesMeta?.length || 0} tube mapping(s)`);

  // --- 1. Create estimate ---
  const estimateId = uuid();
  const patientName = "AUDIT TEST PATIENT";
  const mobile = "9999912345";
  const price = Number(test.price) || 100;
  const [est] = await api("POST", "/rest/v1/estimates", {
    id: estimateId,
    patient_name: patientName,
    whatsapp_number: mobile,
    status: "Estimate Created",
    total_amount: price,
    final_amount: price,
    discount_amount: 0,
  });
  report.created.estimateId = estimateId;
  const [estTest] = await api("POST", "/rest/v1/estimate_tests", {
    estimate_id: estimateId,
    test_id: test.id,
    test_name: test.test_name,
    price,
    item_type: "test",
    discounted_price: price,
  });
  report.created.estimateTestId = estTest.id;
  note("1.create_estimate", true, `estimate ${estimateId}`);

  // --- 2. Book home visit ---
  const visitId = uuid();
  const tomorrow = new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 10);
  const [visit] = await api("POST", "/rest/v1/home_visits", {
    id: visitId,
    estimate_id: estimateId,
    visit_date: tomorrow,
    visit_time: "10:00",
    address: "AUDIT ADDRESS, SURAT",
    status: "Pending",
  });
  report.created.homeVisitId = visitId;
  await api("PATCH", `/rest/v1/estimates?id=eq.${estimateId}`, {
    status: "Home Visit Booked",
  });
  note("2.book_home_visit", true, `visit ${visitId} status Pending`);

  // Complete visit (as phlebo would)
  await api("PATCH", `/rest/v1/home_visits?id=eq.${visitId}`, {
    status: "Completed",
    paid_amount: price,
    payment_mode: "Cash",
  });
  note("2b.complete_home_visit", true, "status Completed");

  // --- 3. Atomic register (quick-register path via register_patient_atomic) ---
  let invoiceNumber;
  let umrNumber;
  try {
    invoiceNumber = await rpc("generate_invoice_number");
  } catch (e) {
    issue("high", `generate_invoice_number failed: ${e.message}`);
    invoiceNumber = `AUDIT${Date.now()}`;
  }
  try {
    umrNumber = await rpc("generate_umr_number");
  } catch (e) {
    issue("high", `generate_umr_number failed: ${e.message}`);
    umrNumber = `UMR${Date.now()}`;
  }

  const tubeType = tubesMeta?.[0]?.tube_value || test.sample_tube || "EDTA";
  const tubeColor = tubesMeta?.[0]?.tube_color || test.tube_color || "PURPLE";
  const sampleType = tubesMeta?.[0]?.sample_type || test.sample_type || "WHOLE BLOOD";

  const atomicReg = await rpc("register_patient_atomic", {
    p_registration: {
      invoice_number: invoiceNumber,
      umr_number: umrNumber,
      patient_name: patientName,
      title: "MR",
      gender: "Male",
      mobile_number: mobile,
      address: "AUDIT ADDRESS, SURAT",
      visit_type: "home_visit",
      home_visit_id: visitId,
      status: "registered",
      tests: [{ test_id: test.id, test_name: test.test_name, price, item_type: "test" }],
      gross_amount: price,
      net_amount: price,
      final_amount: price,
      paid_amount: price,
      due_amount: 0,
      payments: [{ mode: "Cash", amount: price }],
      registered_by: "AUDIT_SCRIPT",
    },
    p_tubes: [
      {
        tube_type: tubeType,
        tube_color: tubeColor,
        sample_type: sampleType,
        suffix: "",
        test_ids: [test.id],
        test_names: [test.test_name],
        status: "pending",
      },
    ],
    p_payment: {
      transaction_type: "registration_payment",
      direction: "in",
      performed_by: "AUDIT_SCRIPT",
      cash_amount: price,
      total_amount: price,
      gross_amount: price,
      final_amount: price,
      paid_amount: price,
      due_amount: 0,
    },
    p_home_visit_id: visitId,
    p_home_visit_patch: { status: "Registered" },
  });

  const registrationId = atomicReg.id;
  report.created.registrationId = registrationId;
  report.created.invoiceNumber = invoiceNumber;
  report.created.umrNumber = umrNumber;
  note("3.register_patient_atomic", true, `invoice ${invoiceNumber} umr ${umrNumber} id ${registrationId}`);

  // Verify tubes + payment created atomically
  const tubes = await api(
    "GET",
    `/rest/v1/sample_tubes?registration_id=eq.${registrationId}&select=id,sample_uid,status,test_ids`,
  );
  if (!tubes?.length) {
    issue("high", "Atomic register did not create sample_tubes");
    note("3b.sample_tubes", false, "missing");
  } else {
    report.created.tubeId = tubes[0].id;
    report.created.sampleUid = tubes[0].sample_uid;
    note("3b.sample_tubes", true, `${tubes.length} tube(s) uid=${tubes[0].sample_uid}`);
  }

  const pays = await api(
    "GET",
    `/rest/v1/payment_transactions?registration_id=eq.${registrationId}&select=id,total_amount,transaction_type`,
  );
  if (!pays?.length) {
    issue("high", "Atomic register did not create payment_transactions");
    note("3c.payment", false, "missing");
  } else {
    note("3c.payment", true, `${pays[0].transaction_type} ₹${pays[0].total_amount}`);
  }

  const hvAfter = await api("GET", `/rest/v1/home_visits?id=eq.${visitId}&select=status`);
  note("3d.home_visit_status", hvAfter?.[0]?.status === "Registered", `status=${hvAfter?.[0]?.status}`);

  // patient_master upsert
  try {
    await api("POST", "/rest/v1/patient_master", {
      umr_id: umrNumber,
      patient_name: patientName,
      title: "MR",
      gender: "Male",
      mobile_number: mobile,
      address: "AUDIT ADDRESS, SURAT",
    });
    note("3e.patient_master", true, umrNumber);
  } catch (e) {
    issue("medium", `patient_master write failed: ${e.message}`);
    note("3e.patient_master", false, e.message);
  }

  // --- 3f. RLS: anon must not be able to INSERT clinical data ---
  try {
    await api(
      "POST",
      "/rest/v1/patient_registrations",
      {
        invoice_number: `ANONBLOCK${Date.now()}`,
        patient_name: "SHOULD FAIL",
        mobile_number: "0000000000",
        visit_type: "lab_visit",
        tests: [],
      },
      ANON,
    );
    issue("high", "RLS failed: anon was able to INSERT patient_registrations");
    note("3f.rls_anon_write_blocked", false, "anon insert succeeded");
  } catch (e) {
    note("3f.rls_anon_write_blocked", true, `blocked as expected (${e.status || "err"})`);
  }

  // --- 3g. Queue RPCs reachable ---
  try {
    const q1 = await rpc("lims_results_entry_candidate_ids");
    const q2 = await rpc("lims_verification_candidate_ids");
    const q3 = await rpc("lims_doctor_approval_candidate_ids");
    const q4 = await rpc("lims_dispatch_candidate_ids");
    note(
      "3g.queue_rpcs",
      true,
      `entry=${(q1 || []).length} verify=${(q2 || []).length} approve=${(q3 || []).length} dispatch=${(q4 || []).length}`,
    );
  } catch (e) {
    issue("high", `Queue RPCs failed: ${e.message}`);
    note("3g.queue_rpcs", false, e.message);
  }

  const tube = tubes?.[0];
  if (!tube) throw new Error("No sample tube — cannot continue pipeline");

  // --- 4. Sample collection ---
  await api("PATCH", `/rest/v1/sample_tubes?id=eq.${tube.id}&status=eq.pending`, {
    status: "collected",
    collected_at: new Date().toISOString(),
    collected_by: "AUDIT_SCRIPT",
  });
  note("4.sample_collection", true, "tube collected");

  // --- 5. Sample acceptance ---
  await api("PATCH", `/rest/v1/sample_tubes?id=eq.${tube.id}&status=eq.collected`, {
    status: "accepted",
    accepted_at: new Date().toISOString(),
    accepted_by: "AUDIT_SCRIPT",
  });
  note("5.sample_acceptance", true, "tube accepted");

  // --- 6. Results: load parameters and enter ---
  const params = await api(
    "GET",
    `/rest/v1/test_parameters?test_id=eq.${test.id}&select=parameter_id,report_test_parameters(id,parameter_name,param_code,unit,normal_range_low,normal_range_high,normal_range_text)`,
  );
  // junction may use different shape — also try report params via test_parameters
  let parameterRows = [];
  if (params?.length) {
    parameterRows = params
      .map((p) => p.report_test_parameters || p)
      .filter(Boolean)
      .flat();
  }
  if (!parameterRows.length) {
    // fallback: get via test_parameters ids then report_test_parameters
    const junctions = await api(
      "GET",
      `/rest/v1/test_parameters?test_id=eq.${test.id}&select=parameter_id`,
    );
    const ids = (junctions || []).map((j) => j.parameter_id).filter(Boolean);
    if (ids.length) {
      parameterRows = await api(
        "GET",
        `/rest/v1/report_test_parameters?id=in.(${ids.join(",")})&select=id,parameter_name,param_code,unit,normal_range_low,normal_range_high,normal_range_text`,
      );
    }
  }
  if (!parameterRows?.length) {
    issue("high", `No parameters linked to test ${test.test_name} — cannot enter results for this test`);
    note("6.results", false, "no parameters");
  } else {
    const resultIds = [];
    for (const p of parameterRows) {
      const pid = p.id || p.parameter_id;
      const [row] = await api("POST", "/rest/v1/patient_results", {
        registration_id: registrationId,
        test_id: test.id,
        parameter_id: pid,
        param_code: p.param_code || null,
        parameter_name: p.parameter_name || p.param_code || "PARAM",
        result_value: "10",
        unit: p.unit || null,
        normal_range_low: p.normal_range_low ?? null,
        normal_range_high: p.normal_range_high ?? null,
        status: "entered",
        entered_by: "AUDIT_SCRIPT",
        entered_at: new Date().toISOString(),
      });
      resultIds.push(row.id);
    }
    report.created.resultIds = resultIds;
    note("6.results", true, `entered ${resultIds.length} parameter(s)`);
  }

  // --- 7. Verification ---
  if (report.created.resultIds?.length) {
    await api(
      "PATCH",
      `/rest/v1/patient_results?registration_id=eq.${registrationId}&test_id=eq.${test.id}`,
      {
        status: "verified",
        verified_by: "AUDIT_SCRIPT",
        verified_at: new Date().toISOString(),
      },
    );
    note("7.verification", true, "results verified");
  } else {
    note("7.verification", false, "skipped — no results");
  }

  // --- 8. Doctor approval + approved_reports snapshot ---
  if (report.created.resultIds?.length) {
    await api(
      "PATCH",
      `/rest/v1/patient_results?registration_id=eq.${registrationId}&test_id=eq.${test.id}`,
      {
        status: "approved",
        approved_by: "AUDIT_SCRIPT",
        approved_at: new Date().toISOString(),
      },
    );
    const liveResults = await api(
      "GET",
      `/rest/v1/patient_results?registration_id=eq.${registrationId}&select=*`,
    );
    const [apr] = await api("POST", "/rest/v1/approved_reports", {
      registration_id: registrationId,
      invoice_number: invoiceNumber,
      umr_number: umrNumber,
      patient_name: patientName,
      title: "MR",
      gender: "Male",
      mobile_number: mobile,
      approved_by: "AUDIT_SCRIPT",
      approval_date: new Date().toISOString(),
      test_results: liveResults,
      is_held: false,
    });
    report.created.approvedReportId = apr.id;
    note("8.doctor_approval", true, `approved_reports ${apr.id}`);
  } else {
    note("8.doctor_approval", false, "skipped — no results");
  }

  // --- 9. Dispatch ---
  if (report.created.resultIds?.length) {
    await api(
      "PATCH",
      `/rest/v1/patient_results?registration_id=eq.${registrationId}&test_id=eq.${test.id}`,
      {
        status: "dispatched",
        dispatched_at: new Date().toISOString(),
      },
    );
    await api("PATCH", `/rest/v1/patient_registrations?id=eq.${registrationId}`, {
      status: "dispatched",
    });
    const token = crypto.randomBytes(16).toString("hex");
    const [link] = await api("POST", "/rest/v1/report_share_links", {
      registration_id: registrationId,
      invoice_number: invoiceNumber,
      token,
      expires_at: new Date(Date.now() + 7 * 864e5).toISOString(),
    });
    report.created.shareLinkId = link.id;
    note("9.dispatch", true, `dispatched + share link ${token.slice(0, 8)}…`);
  } else {
    note("9.dispatch", false, "skipped — no results");
  }

  // --- 10. Login edge function + JWT issuance ---
  try {
    const bad = await fetch(`${API}/functions/v1/user-auth`, {
      method: "POST",
      headers: {
        apikey: ANON,
        Authorization: `Bearer ${ANON}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ action: "login", username: "PHPATHLABS", password: "wrong-password-check" }),
    });
    const badBody = await bad.json();
    note(
      "10.user_auth_reachable",
      bad.status === 401 || bad.status === 200,
      `status ${bad.status} body=${JSON.stringify(badBody).slice(0, 80)}`,
    );

    const good = await fetch(`${API}/functions/v1/user-auth`, {
      method: "POST",
      headers: {
        apikey: ANON,
        Authorization: `Bearer ${ANON}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ action: "login", username: "PHPATHLABS", password: "admin123" }),
    });
    const goodBody = await good.json();
    const hasToken = !!goodBody?.access_token;
    note("10b.jwt_issued", good.status === 200 && hasToken, hasToken ? "access_token present" : JSON.stringify(goodBody).slice(0, 120));
    if (hasToken) {
      // staff JWT can write; already covered by 3f for anon block
      const probe = await fetch(`${API}/rest/v1/rpc/lims_dispatch_candidate_ids`, {
        method: "POST",
        headers: {
          apikey: ANON,
          Authorization: `Bearer ${goodBody.access_token}`,
          "Content-Type": "application/json",
        },
        body: "{}",
      });
      note("10c.staff_jwt_rpc", probe.ok, `status ${probe.status}`);
    }
  } catch (e) {
    note("10.user_auth_reachable", false, e.message);
    issue("high", `user-auth edge function unreachable: ${e.message}`);
  }

  // --- Cleanup ---
  await cleanup(report.created);
  report.cleaned = true;
  note("11.cleanup", true, "all audit rows deleted");

  report.finishedAt = new Date().toISOString();
  report.summary = {
    passed: report.steps.filter((s) => s.ok).length,
    failed: report.steps.filter((s) => !s.ok).length,
    issues: report.issues.length,
  };
  fs.writeFileSync("data-export/e2e-audit-report.json", JSON.stringify(report, null, 2));
  console.log("\n=== SUMMARY ===");
  console.log(JSON.stringify(report.summary, null, 2));
  console.log("Full report → data-export/e2e-audit-report.json");
}

async function cleanup(created) {
  const id = created.registrationId;
  // delete children first via SQL for certainty
  const sql = `
    BEGIN;
    ${created.shareLinkId ? `DELETE FROM report_share_links WHERE id = '${created.shareLinkId}';` : ""}
    ${id ? `DELETE FROM report_share_links WHERE registration_id = '${id}';` : ""}
    ${id ? `DELETE FROM approved_reports WHERE registration_id = '${id}';` : ""}
    ${id ? `DELETE FROM patient_results WHERE registration_id = '${id}';` : ""}
    ${id ? `DELETE FROM outsourced_test_snips WHERE registration_id = '${id}';` : ""}
    ${id ? `DELETE FROM lims_test_orders WHERE sample_id IN (SELECT sample_uid FROM sample_tubes WHERE registration_id = '${id}');` : ""}
    ${id ? `DELETE FROM sample_tubes WHERE registration_id = '${id}';` : ""}
    ${id ? `DELETE FROM payment_transactions WHERE registration_id = '${id}';` : ""}
    ${id ? `DELETE FROM patient_registrations WHERE id = '${id}';` : ""}
    ${created.umrNumber ? `DELETE FROM patient_master WHERE umr_id = '${created.umrNumber}';` : ""}
    ${created.homeVisitId ? `DELETE FROM home_visits WHERE id = '${created.homeVisitId}';` : ""}
    ${created.estimateId ? `DELETE FROM estimate_tests WHERE estimate_id = '${created.estimateId}';` : ""}
    ${created.estimateId ? `DELETE FROM estimates WHERE id = '${created.estimateId}';` : ""}
    COMMIT;
  `;
  psql(sql);
}

main().catch(async (e) => {
  console.error("AUDIT ABORTED:", e.message);
  report.fatal = e.message;
  try {
    if (report.created) await cleanup(report.created);
    report.cleaned = true;
    console.log("Cleanup after failure: done");
  } catch (ce) {
    console.error("Cleanup failed:", ce.message);
    report.cleanupError = ce.message;
  }
  fs.writeFileSync("data-export/e2e-audit-report.json", JSON.stringify(report, null, 2));
  process.exit(1);
});
