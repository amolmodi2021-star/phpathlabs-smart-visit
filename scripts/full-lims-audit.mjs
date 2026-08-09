/**
 * Full LIMS feature audit (local).
 * - Core clinical path (estimate → HV → register → collect → accept → results → verify → approve → dispatch)
 * - Extra probes: outsourced snip path, due payment, cancelled-test queue, RLS anon, queue RPC sizes, interface notify
 * - ALWAYS cleans up created rows (even on failure)
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
  flaws: [],
  created: {
    estimateIds: [],
    visitIds: [],
    registrationIds: [],
    tubeIds: [],
    resultIds: [],
    snipIds: [],
    reportIds: [],
    shareIds: [],
    paymentIds: [],
    notifyIds: [],
  },
  cleaned: false,
  workload: {},
};

function note(step, ok, detail) {
  report.steps.push({ step, ok, detail, at: new Date().toISOString() });
  console.log(`${ok ? "OK  " : "FAIL"} ${step}${detail ? " — " + detail : ""}`);
}
function flaw(severity, area, detail, laterFix) {
  report.flaws.push({ severity, area, detail, laterFix });
  console.log(`FLAW[${severity}] [${area}] ${detail}`);
}

async function api(method, path, body, key = SVC) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
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
    const err = new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 500)}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

async function rpc(fn, args = {}, key = SVC) {
  return api("POST", `/rest/v1/rpc/${fn}`, args, key);
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

async function cleanup() {
  const c = report.created;
  const ids = (arr) => (arr?.length ? arr.map((x) => `'${x}'`).join(",") : null);
  try {
    if (c.notifyIds.length) psql(`DELETE FROM lims_result_notify WHERE id IN (${ids(c.notifyIds)});`);
    if (c.shareIds.length) psql(`DELETE FROM report_share_links WHERE id IN (${ids(c.shareIds)});`);
    if (c.reportIds.length) {
      psql(`DELETE FROM approved_reports WHERE id IN (${ids(c.reportIds)});`);
    }
    if (c.resultIds.length) psql(`DELETE FROM patient_results WHERE id IN (${ids(c.resultIds)});`);
    if (c.snipIds.length) psql(`DELETE FROM outsourced_test_snips WHERE id IN (${ids(c.snipIds)});`);
    if (c.tubeIds.length) psql(`DELETE FROM sample_tubes WHERE id IN (${ids(c.tubeIds)});`);
    if (c.paymentIds.length) psql(`DELETE FROM payment_transactions WHERE id IN (${ids(c.paymentIds)});`);
    if (c.registrationIds.length) {
      const r = ids(c.registrationIds);
      psql(`DELETE FROM patient_results WHERE registration_id IN (${r});`);
      psql(`DELETE FROM outsourced_test_snips WHERE registration_id IN (${r});`);
      psql(`DELETE FROM sample_tubes WHERE registration_id IN (${r});`);
      psql(`DELETE FROM approved_reports WHERE registration_id IN (${r});`);
      psql(`DELETE FROM report_share_links WHERE registration_id IN (${r});`);
      psql(`DELETE FROM payment_transactions WHERE registration_id IN (${r});`);
      psql(`DELETE FROM lims_result_notify WHERE registration_id IN (${r});`);
      psql(`DELETE FROM patient_registrations WHERE id IN (${r});`);
    }
    if (c.visitIds.length) psql(`DELETE FROM home_visits WHERE id IN (${ids(c.visitIds)});`);
    if (c.estimateIds.length) {
      const e = ids(c.estimateIds);
      psql(`DELETE FROM estimate_tests WHERE estimate_id IN (${e});`);
      psql(`DELETE FROM estimates WHERE id IN (${e});`);
    }
    // Marker cleanup by name
    psql(`DELETE FROM lims_result_notify WHERE registration_id IN (SELECT id FROM patient_registrations WHERE patient_name LIKE 'FULLAUDIT %');`);
    psql(`DELETE FROM report_share_links WHERE registration_id IN (SELECT id FROM patient_registrations WHERE patient_name LIKE 'FULLAUDIT %');`);
    psql(`DELETE FROM approved_reports WHERE registration_id IN (SELECT id FROM patient_registrations WHERE patient_name LIKE 'FULLAUDIT %');`);
    psql(`DELETE FROM patient_results WHERE registration_id IN (SELECT id FROM patient_registrations WHERE patient_name LIKE 'FULLAUDIT %');`);
    psql(`DELETE FROM outsourced_test_snips WHERE registration_id IN (SELECT id FROM patient_registrations WHERE patient_name LIKE 'FULLAUDIT %');`);
    psql(`DELETE FROM sample_tubes WHERE registration_id IN (SELECT id FROM patient_registrations WHERE patient_name LIKE 'FULLAUDIT %');`);
    psql(`DELETE FROM payment_transactions WHERE registration_id IN (SELECT id FROM patient_registrations WHERE patient_name LIKE 'FULLAUDIT %');`);
    psql(`DELETE FROM patient_registrations WHERE patient_name LIKE 'FULLAUDIT %';`);
    psql(`DELETE FROM home_visits WHERE estimate_id IN (SELECT id FROM estimates WHERE patient_name LIKE 'FULLAUDIT %');`);
    psql(`DELETE FROM estimate_tests WHERE estimate_id IN (SELECT id FROM estimates WHERE patient_name LIKE 'FULLAUDIT %');`);
    psql(`DELETE FROM estimates WHERE patient_name LIKE 'FULLAUDIT %';`);
    report.cleaned = true;
    note("cleanup", true, "audit rows removed");
  } catch (e) {
    note("cleanup", false, e.message);
    flaw("P1", "audit", `Cleanup failed: ${e.message}`, "Manual delete FULLAUDIT* rows");
  }
}

async function pickTestWithParams() {
  const tests = await api(
    "GET",
    "/rest/v1/tests?select=id,test_name,test_code,price,is_outsourced&is_active=eq.true&order=test_name.asc&limit=50",
  );
  for (const t of tests || []) {
    const junc = await api(
      "GET",
      `/rest/v1/test_parameters?test_id=eq.${t.id}&parameter_id=not.is.null&select=parameter_id,report_test_parameters(id,param_code,parameter_name,unit)&limit=5`,
    );
    if (junc?.length) {
      return { test: t, params: junc.map((j) => j.report_test_parameters).filter(Boolean) };
    }
  }
  throw new Error("No test with parameters");
}

async function main() {
  const marker = `FULLAUDIT ${Date.now()}`;
  const mobile = "9999900001";

  try {
    // ---- Workload / queue probes (no create) ----
    const entry = await rpc("lims_results_entry_candidate_ids");
    const verify = await rpc("lims_verification_candidate_ids");
    const approve = await rpc("lims_doctor_approval_candidate_ids");
    const dispatch = await rpc("lims_dispatch_candidate_ids");
    const outsourced = await rpc("lims_outsourced_candidate_ids");
    report.workload = {
      results_entry: entry?.length ?? 0,
      verification: verify?.length ?? 0,
      doctor_approval: approve?.length ?? 0,
      dispatch: dispatch?.length ?? 0,
      outsourced: outsourced?.length ?? 0,
    };
    note(
      "workload.queue_sizes",
      true,
      `entry=${report.workload.results_entry} verify=${report.workload.verification} approve=${report.workload.doctor_approval} dispatch=${report.workload.dispatch} outsourced=${report.workload.outsourced}`,
    );
    if (report.workload.dispatch > 2000) {
      flaw(
        "P1",
        "dispatch",
        `Dispatch candidate queue is large (${report.workload.dispatch}). Full UUID array round-trip to filter RPC will be heavy under load.`,
        "Collapse candidate+filter+page into one SQL RPC returning only the page",
      );
    }
    if (report.workload.results_entry > 1000) {
      flaw(
        "P1",
        "results",
        `Results Entry candidates=${report.workload.results_entry}; JSONB tube expand on every open is costly.`,
        "Materialize accepted leaf tests or page candidates server-side",
      );
    }

    // ---- RLS anon probe ----
    try {
      const anonRegs = await api(
        "GET",
        "/rest/v1/patient_registrations?select=id,patient_name,mobile_number&limit=3",
        null,
        ANON,
      );
      if (Array.isArray(anonRegs) && anonRegs.length > 0) {
        flaw(
          "P0",
          "security",
          `Anon role can SELECT patient_registrations PHI (got ${anonRegs.length} rows).`,
          "Replace anon_select_* with token-scoped SECURITY DEFINER RPCs",
        );
        note("probe.anon_phi", false, "anon read allowed");
      } else {
        note("probe.anon_phi", true, "no rows or blocked");
      }
    } catch (e) {
      note("probe.anon_phi", true, `blocked: ${e.status || e.message}`);
    }

    // ---- Notify table / realtime publication ----
    const pub = psql(
      `SELECT COUNT(*) FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='lims_result_notify';`,
    );
    note("probe.notify_publication", pub === "1", `lims_result_notify in publication=${pub}`);
    if (pub !== "1") {
      flaw("P1", "interface", "lims_result_notify not in realtime publication — live machine updates won't fire", "ALTER PUBLICATION supabase_realtime ADD TABLE lims_result_notify");
    }

    // ---- Core clinical path ----
    const { test, params } = await pickTestWithParams();
    note("precheck.test", true, `${test.test_code || test.test_name} params=${params.length}`);

    const estimateId = uuid();
    const price = Number(test.price) || 100;
    await api("POST", "/rest/v1/estimates", {
      id: estimateId,
      patient_name: marker,
      whatsapp_number: mobile,
      status: "Estimate Created",
      total_amount: price,
      final_amount: price,
      discount_amount: 0,
      home_visit_charges: 150,
    });
    report.created.estimateIds.push(estimateId);
    await api("POST", "/rest/v1/estimate_tests", {
      estimate_id: estimateId,
      test_id: test.id,
      test_name: test.test_name,
      price,
      fasting_required: false,
      discounted_price: price,
    });
    note("1.estimate", true, estimateId);

    const visitId = uuid();
    const today = new Date().toISOString().slice(0, 10);
    await api("POST", "/rest/v1/home_visits", {
      id: visitId,
      estimate_id: estimateId,
      visit_date: today,
      visit_time: "10:00",
      address: "AUDIT ADDRESS",
      status: "Completed",
    });
    report.created.visitIds.push(visitId);
    await api("PATCH", `/rest/v1/estimates?id=eq.${estimateId}`, {
      status: "Home Visit Booked",
      home_visit_charges: 150,
      final_amount: price + 150,
    });
    note("2.home_visit", true, visitId);

    const invoiceNumber = await rpc("generate_invoice_number");
    const umrNumber = await rpc("generate_umr_number");
    const tubeType = "EDTA";
    const tubeColor = "PURPLE";
    const sampleType = "WHOLE BLOOD";

    const atomicReg = await rpc("register_patient_atomic", {
      p_registration: {
        invoice_number: invoiceNumber,
        umr_number: umrNumber,
        title: "MR",
        patient_name: marker,
        gender: "Male",
        mobile_number: mobile,
        doctor_name: "SELF",
        address: "AUDIT ADDRESS",
        visit_type: "home_visit",
        home_visit_id: visitId,
        tests: [{ test_id: test.id, test_name: test.test_name, price, item_type: "test" }],
        gross_amount: price,
        discount_amount: 0,
        home_visit_charges: 150,
        net_amount: price,
        final_amount: price + 150,
        paid_amount: 0,
        due_amount: price + 150,
        status: "registered",
        registered_by: "FULL_AUDIT",
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
      p_payment: null,
      p_home_visit_id: visitId,
      p_home_visit_patch: { status: "Registered" },
    });
    const regId = atomicReg?.id;
    if (!regId) throw new Error(`register failed: ${JSON.stringify(atomicReg)}`);
    report.created.registrationIds.push(regId);
    note("3.register_atomic", true, `${regId} invoice=${invoiceNumber}`);

    const tubes = await api("GET", `/rest/v1/sample_tubes?registration_id=eq.${regId}&select=*`);
    if (!tubes?.length) throw new Error("no tubes");
    report.created.tubeIds.push(...tubes.map((t) => t.id));
    note("3b.tubes", true, `${tubes.length}`);

    // Collect + accept
    await api("PATCH", `/rest/v1/sample_tubes?id=eq.${tubes[0].id}`, {
      status: "collected",
      collected_at: new Date().toISOString(),
      collected_by: "AUDIT",
    });
    await api("PATCH", `/rest/v1/sample_tubes?id=eq.${tubes[0].id}`, {
      status: "accepted",
      accepted_at: new Date().toISOString(),
      accepted_by: "AUDIT",
    });
    note("4.collect_accept", true, tubes[0].id);

    // Results → verify → approve → dispatch
    const now = new Date().toISOString();
    const resultRows = params.slice(0, 3).map((p) => ({
      registration_id: regId,
      test_id: test.id,
      parameter_id: p.id,
      param_code: p.param_code,
      parameter_name: p.parameter_name,
      result_value: "10",
      unit: p.unit || "",
      status: "entered",
      entered_at: now,
      entered_by: "AUDIT",
    }));
    const inserted = await api("POST", "/rest/v1/patient_results", resultRows);
    report.created.resultIds.push(...(inserted || []).map((r) => r.id));
    note("5.results_entered", true, `${inserted?.length || 0}`);

    await api("PATCH", `/rest/v1/patient_results?registration_id=eq.${regId}&status=eq.entered`, {
      status: "verified",
      verified_at: now,
      verified_by: "AUDIT",
    });
    note("6.verified", true);

    await api("PATCH", `/rest/v1/patient_results?registration_id=eq.${regId}&status=eq.verified`, {
      status: "approved",
      approved_at: now,
      approved_by: "AUDIT",
    });
    const [apr] = await api("POST", "/rest/v1/approved_reports", {
      registration_id: regId,
      test_results: resultRows,
      approved_by: "AUDIT",
      is_held: false,
    });
    if (apr?.id) report.created.reportIds.push(apr.id);
    note("7.approved", true, apr?.id);

    await api("PATCH", `/rest/v1/patient_results?registration_id=eq.${regId}&status=eq.approved`, {
      status: "dispatched",
      dispatched_at: now,
      dispatched_by: "AUDIT",
    });
    await api("PATCH", `/rest/v1/patient_registrations?id=eq.${regId}`, { status: "dispatched" });
    const [share] = await api("POST", "/rest/v1/report_share_links", {
      registration_id: regId,
      token: crypto.randomBytes(16).toString("hex"),
      expires_at: new Date(Date.now() + 7 * 864e5).toISOString(),
    });
    if (share?.id) report.created.shareIds.push(share.id);
    note("8.dispatch", true, share?.token?.slice(0, 8));

    // ---- Outsourced path probe (second reg) ----
    const estimateId2 = uuid();
    await api("POST", "/rest/v1/estimates", {
      id: estimateId2,
      patient_name: `${marker} OS`,
      whatsapp_number: mobile,
      status: "Estimate Created",
      total_amount: price,
      final_amount: price,
    });
    report.created.estimateIds.push(estimateId2);
    await api("POST", "/rest/v1/estimate_tests", {
      estimate_id: estimateId2,
      test_id: test.id,
      test_name: test.test_name,
      price,
      discounted_price: price,
    });
    const visitId2 = uuid();
    await api("POST", "/rest/v1/home_visits", {
      id: visitId2,
      estimate_id: estimateId2,
      visit_date: today,
      visit_time: "11:00",
      address: "AUDIT OS",
      status: "Completed",
    });
    report.created.visitIds.push(visitId2);
    const invoice2 = await rpc("generate_invoice_number");
    const umr2 = await rpc("generate_umr_number");
    const reg2 = await rpc("register_patient_atomic", {
      p_registration: {
        invoice_number: invoice2,
        umr_number: umr2,
        title: "MR",
        patient_name: `${marker} OS`,
        gender: "Male",
        mobile_number: mobile,
        doctor_name: "SELF",
        visit_type: "walk_in",
        tests: [{ test_id: test.id, test_name: test.test_name, price, item_type: "test" }],
        gross_amount: price,
        discount_amount: 0,
        home_visit_charges: 0,
        net_amount: price,
        final_amount: price,
        paid_amount: price,
        due_amount: 0,
        status: "registered",
        payments: [{ mode: "Cash", amount: price }],
        registered_by: "FULL_AUDIT",
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
        performed_by: "FULL_AUDIT",
        cash_amount: price,
        total_amount: price,
        gross_amount: price,
        final_amount: price,
        paid_amount: price,
        due_amount: 0,
      },
      p_home_visit_id: null,
      p_home_visit_patch: null,
    });
    const regId2 = reg2?.id;
    if (!regId2) throw new Error(`OS register failed: ${JSON.stringify(reg2)}`);
    report.created.registrationIds.push(regId2);
    const tubes2 = await api("GET", `/rest/v1/sample_tubes?registration_id=eq.${regId2}&select=id`);
    report.created.tubeIds.push(...(tubes2 || []).map((t) => t.id));
    if (tubes2?.[0]) {
      await api("PATCH", `/rest/v1/sample_tubes?id=eq.${tubes2[0].id}`, {
        status: "accepted",
        accepted_at: now,
        collected_at: now,
      });
    }
    const [snip] = await api("POST", "/rest/v1/outsourced_test_snips", {
      registration_id: regId2,
      test_id: test.id,
      outsource_status: "sent",
      outsourced_lab_name: "AUDIT LAB",
      result_mode: "manual",
      sent_at: now,
    });
    if (snip?.id) report.created.snipIds.push(snip.id);
    const osCandidates = await rpc("lims_outsourced_candidate_ids");
    const osHas = (osCandidates || []).includes(regId2);
    note("9.outsourced_snip", osHas, `snip=${snip?.id} in_candidates=${osHas}`);
    if (!osHas) {
      flaw(
        "P1",
        "outsourced",
        "Newly sent outsourced snip registration not in lims_outsourced_candidate_ids",
        "Review candidate RPC status filter vs snip statuses",
      );
    }

    // ---- Due payment probe ----
    const dueRegs = await api(
      "GET",
      "/rest/v1/patient_registrations?due_amount=gt.0&is_bad_debt=eq.false&bill_cancelled=eq.false&select=id&limit=1",
    );
    note("10.due_queue", true, `open_dues_sample=${dueRegs?.length || 0}`);

    // ---- Notify insert probe ----
    const [n] = await api("POST", "/rest/v1/lims_result_notify", {
      registration_id: regId2,
      source: "audit",
    });
    if (n?.id) report.created.notifyIds.push(n.id);
    note("11.notify_insert", !!n?.id, n?.id);

    // ---- Cancelled-test status gap probe (read-only logic check via SQL) ----
    const cancelGap = psql(`
      SELECT COUNT(*) FROM patient_registrations pr
      WHERE jsonb_array_length(COALESCE(pr.cancelled_tests, '[]'::jsonb)) > 0
        AND pr.bill_cancelled = false
        AND pr.status NOT IN ('dispatched','cancelled')
      LIMIT 1;
    `);
    note("12.cancelled_tests_present", true, `regs_with_cancelled=${cancelGap}`);
    if (Number(cancelGap) > 0) {
      flaw(
        "P1",
        "status",
        "Registrations with cancelled_tests exist; limsStatus/candidate RPCs may still treat cancelled leaf tests as pending.",
        "Exclude cancelled_tests IDs in recalculateRegistrationStatus and lims_*_candidate_ids",
      );
    }

    // ---- user-auth reachability ----
    try {
      const res = await fetch(`${API}/functions/v1/user-auth`, {
        method: "POST",
        headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, "Content-Type": "application/json" },
        body: JSON.stringify({ action: "login", username: "nope", password: "nope" }),
      });
      note("13.user_auth", res.status === 401 || res.status === 200, `status=${res.status}`);
    } catch (e) {
      note("13.user_auth", false, e.message);
    }

    // ---- Masters smoke ----
    const masters = await Promise.all([
      api("GET", "/rest/v1/tests?select=id&is_active=eq.true&limit=1"),
      api("GET", "/rest/v1/phlebotomists?select=id&limit=1"),
      api("GET", "/rest/v1/message_templates?select=*&limit=1"),
    ]);
    note("14.masters", true, `tests/phlebos/templates ok`);

  } catch (e) {
    note("fatal", false, e.message);
    flaw("P0", "audit", `Audit aborted: ${e.message}`, "Investigate failed step");
  } finally {
    await cleanup();
    report.finishedAt = new Date().toISOString();
    report.summary = {
      steps_ok: report.steps.filter((s) => s.ok).length,
      steps_fail: report.steps.filter((s) => !s.ok).length,
      flaws: report.flaws.length,
      by_severity: {
        P0: report.flaws.filter((f) => f.severity === "P0").length,
        P1: report.flaws.filter((f) => f.severity === "P1").length,
        P2: report.flaws.filter((f) => f.severity === "P2").length,
      },
      cleaned: report.cleaned,
      workload: report.workload,
    };
    fs.mkdirSync("data-export", { recursive: true });
    fs.writeFileSync("data-export/full-lims-audit-report.json", JSON.stringify(report, null, 2));
    console.log("\n=== FULL LIMS AUDIT SUMMARY ===");
    console.log(JSON.stringify(report.summary, null, 2));
    console.log("Report → data-export/full-lims-audit-report.json");
  }
}

main();
