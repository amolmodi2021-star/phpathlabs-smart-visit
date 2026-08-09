/**
 * Partial-pipeline / multi-visit LIMS robustness audit (local).
 *
 * Covers:
 * - Lab / home / pickup / channel(SJYO) registrations with 10–12 mixed tests
 * - Partial collect → accept → results → verify → approve → dispatch
 * - Outsourced + snip-image tests (zero-param)
 * - Send-back: verification→entry, approval→verification, approval→repeat collection
 * - Scoped repeat (only listed tests) + shared-tube split + CBC→ESR merge to one pending
 * - First-time partial pending ≠ repeat_collection / REPEAT badge
 * - Test cancel, bill cancel, refunds + daily payment_transactions cash tally
 * - Stuck-test detection via candidate RPCs + tube/result/snip state
 * - Full path through dispatch for every visit type + shared-tube scenario
 *
 * ALWAYS deletes PARTIALAUDIT* rows (success or failure).
 * Report → data-export/partial-pipeline-audit-report.json
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import crypto from "node:crypto";

const API = "http://127.0.0.1:54421";
const ANON =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const SVC =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const MARKER = `PARTIALAUDIT ${Date.now()}`;
const MOBILE_BASE = "99988";

const report = {
  startedAt: new Date().toISOString(),
  marker: MARKER,
  steps: [],
  flaws: [],
  scenarios: {},
  cash: {},
  created: {
    estimateIds: [],
    visitIds: [],
    registrationIds: [],
    paymentIds: [],
  },
  cleaned: false,
};

function note(step, ok, detail) {
  report.steps.push({ step, ok, detail, at: new Date().toISOString() });
  console.log(`${ok ? "OK  " : "FAIL"} ${step}${detail ? " — " + detail : ""}`);
}
function flaw(severity, area, detail, laterFix) {
  report.flaws.push({ severity, area, detail, laterFix });
  console.log(`FLAW[${severity}] [${area}] ${detail}`);
}
function uuid() {
  return crypto.randomUUID();
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
    body: body == null ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const err = new Error(`${method} ${path} → ${res.status}: ${String(text).slice(0, 600)}`);
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

async function cleanup() {
  try {
    const like = MARKER.replace(/'/g, "''");
    // Broad marker cleanup (covers all scenarios)
    psql(`
      DELETE FROM lims_result_notify WHERE registration_id IN (SELECT id FROM patient_registrations WHERE patient_name LIKE 'PARTIALAUDIT %');
      DELETE FROM report_share_links WHERE registration_id IN (SELECT id FROM patient_registrations WHERE patient_name LIKE 'PARTIALAUDIT %');
      DELETE FROM report_link_events WHERE token IN (SELECT token FROM report_share_links WHERE registration_id IN (SELECT id FROM patient_registrations WHERE patient_name LIKE 'PARTIALAUDIT %'));
      DELETE FROM approved_reports WHERE registration_id IN (SELECT id FROM patient_registrations WHERE patient_name LIKE 'PARTIALAUDIT %');
      DELETE FROM patient_results WHERE registration_id IN (SELECT id FROM patient_registrations WHERE patient_name LIKE 'PARTIALAUDIT %');
      DELETE FROM outsourced_test_snips WHERE registration_id IN (SELECT id FROM patient_registrations WHERE patient_name LIKE 'PARTIALAUDIT %');
      DELETE FROM sample_tubes WHERE registration_id IN (SELECT id FROM patient_registrations WHERE patient_name LIKE 'PARTIALAUDIT %');
      DELETE FROM lims_test_orders WHERE sample_id IN (SELECT invoice_number FROM patient_registrations WHERE patient_name LIKE 'PARTIALAUDIT %')
        OR sample_id LIKE ANY (SELECT invoice_number || '%' FROM patient_registrations WHERE patient_name LIKE 'PARTIALAUDIT %');
      DELETE FROM payment_transactions WHERE registration_id IN (SELECT id FROM patient_registrations WHERE patient_name LIKE 'PARTIALAUDIT %')
        OR patient_name LIKE 'PARTIALAUDIT %';
      DELETE FROM patient_master WHERE patient_name LIKE 'PARTIALAUDIT %' OR mobile_number LIKE '99988%';
      DELETE FROM patient_registrations WHERE patient_name LIKE 'PARTIALAUDIT %';
      DELETE FROM home_visits WHERE estimate_id IN (SELECT id FROM estimates WHERE patient_name LIKE 'PARTIALAUDIT %');
      DELETE FROM estimate_tests WHERE estimate_id IN (SELECT id FROM estimates WHERE patient_name LIKE 'PARTIALAUDIT %');
      DELETE FROM estimates WHERE patient_name LIKE 'PARTIALAUDIT %';
    `);
    const left = psql(`SELECT COUNT(*) FROM patient_registrations WHERE patient_name LIKE 'PARTIALAUDIT %';`);
    report.cleaned = left === "0";
    note("cleanup", report.cleaned, `leftover regs=${left} (marker=${like})`);
  } catch (e) {
    note("cleanup", false, e.message);
    flaw("P0", "audit", `Cleanup failed: ${e.message}`, "Manually DELETE PARTIALAUDIT% rows");
  }
}

/** Mirror of src/lib/limsStatus.ts recalculateRegistrationStatus (SQL). */
function recalcStatus(regId) {
  psql(`
DO $$
DECLARE
  v_reg uuid := '${regId}'::uuid;
  v_cancelled text[];
  v_current text;
  v_new text := 'registered';
  v_has_untracked boolean := false;
  v_has_pending boolean;
  v_has_collected boolean;
  tube_count int;
  accepted_untracked int;
BEGIN
  SELECT status INTO v_current FROM patient_registrations WHERE id = v_reg;

  SELECT COALESCE(array_agg(COALESCE(elem->>'test_id', elem->>'id')), ARRAY[]::text[])
  INTO v_cancelled
  FROM patient_registrations pr
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(pr.cancelled_tests, '[]'::jsonb)) elem
  WHERE pr.id = v_reg;

  SELECT COUNT(*) INTO tube_count FROM sample_tubes WHERE registration_id = v_reg;
  IF tube_count = 0 THEN
    UPDATE patient_registrations SET status = 'registered' WHERE id = v_reg;
    RETURN;
  END IF;

  SELECT
    EXISTS (SELECT 1 FROM sample_tubes WHERE registration_id = v_reg AND status = 'pending'),
    EXISTS (SELECT 1 FROM sample_tubes WHERE registration_id = v_reg AND status = 'collected')
  INTO v_has_pending, v_has_collected;

  -- untracked accepted tests
  SELECT COUNT(*) INTO accepted_untracked
  FROM (
    SELECT jsonb_array_elements_text(COALESCE(test_ids,'[]'::jsonb)) AS tid
    FROM sample_tubes WHERE registration_id = v_reg AND status = 'accepted'
  ) a
  WHERE a.tid <> '' AND NOT (a.tid = ANY (COALESCE(v_cancelled, ARRAY[]::text[])))
    AND NOT EXISTS (
      SELECT 1 FROM patient_results pr
      WHERE pr.registration_id = v_reg AND pr.test_id::text = a.tid
        AND pr.status IN ('entered','results_entered','verified','approved','dispatched')
    )
    AND NOT EXISTS (
      SELECT 1 FROM outsourced_test_snips os
      WHERE os.registration_id = v_reg AND os.test_id::text = a.tid
        AND os.outsource_status IN ('entered','results_entered','verified','approved','dispatched')
    );

  v_has_untracked := accepted_untracked > 0;

  -- Active explicit repeats: listed in repeat_tests AND still on a pending tube
  IF EXISTS (
    SELECT 1
    FROM patient_registrations pr
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(pr.repeat_tests, '[]'::jsonb)) rt
    WHERE pr.id = v_reg
      AND COALESCE(rt->>'test_id','') <> ''
      AND EXISTS (
        SELECT 1 FROM sample_tubes st
        WHERE st.registration_id = v_reg
          AND st.status = 'pending'
          AND EXISTS (
            SELECT 1 FROM jsonb_array_elements_text(COALESCE(st.test_ids, '[]'::jsonb)) tid
            WHERE tid = rt->>'test_id'
          )
      )
  ) THEN
    -- prune completed repeat_tests
    UPDATE patient_registrations pr SET
      status = 'repeat_collection',
      repeat_tests = COALESCE((
        SELECT jsonb_agg(rt)
        FROM jsonb_array_elements(COALESCE(pr.repeat_tests, '[]'::jsonb)) rt
        WHERE EXISTS (
          SELECT 1 FROM sample_tubes st
          WHERE st.registration_id = v_reg
            AND st.status = 'pending'
            AND EXISTS (
              SELECT 1 FROM jsonb_array_elements_text(COALESCE(st.test_ids, '[]'::jsonb)) tid
              WHERE tid = rt->>'test_id'
            )
        )
      ), '[]'::jsonb)
    WHERE pr.id = v_reg;
    RETURN;
  END IF;

  -- Clear stale repeat_tests if none active
  UPDATE patient_registrations SET repeat_tests = '[]'::jsonb
  WHERE id = v_reg AND COALESCE(jsonb_array_length(repeat_tests), 0) > 0;

  WITH downstream AS (
    SELECT status AS st FROM patient_results
    WHERE registration_id = v_reg AND (v_cancelled IS NULL OR NOT (test_id::text = ANY (v_cancelled)))
    UNION ALL
    SELECT outsource_status FROM outsourced_test_snips
    WHERE registration_id = v_reg
      AND outsource_status IN ('entered','results_entered','verified','approved','dispatched')
      AND (v_cancelled IS NULL OR NOT (test_id::text = ANY (v_cancelled)))
  ),
  agg AS (
    SELECT
      COUNT(*) AS n,
      COUNT(*) FILTER (WHERE st = 'dispatched') AS n_disp,
      COUNT(*) FILTER (WHERE st = 'approved') AS n_appr,
      COUNT(*) FILTER (WHERE st = 'verified') AS n_ver,
      COUNT(*) FILTER (WHERE st IN ('entered','results_entered')) AS n_ent
    FROM downstream
  ),
  tubes AS (
    SELECT
      COUNT(*) AS n,
      COUNT(*) FILTER (WHERE status = 'accepted') AS n_acc,
      COUNT(*) FILTER (WHERE status IN ('collected','accepted')) AS n_col_acc,
      COUNT(*) FILTER (WHERE status = 'collected') AS n_col
    FROM sample_tubes WHERE registration_id = v_reg
  )
  SELECT CASE
    WHEN a.n > 0 AND a.n_disp = a.n THEN 'dispatched'
    WHEN a.n_disp > 0 THEN 'partially_dispatched'
    WHEN a.n > 0 AND a.n_appr = a.n THEN 'approved'
    WHEN a.n_appr > 0 THEN 'partially_approved'
    WHEN a.n > 0 AND a.n_ver = a.n THEN 'verified'
    WHEN a.n_ver > 0 THEN 'partial_verified'
    WHEN a.n > 0 AND a.n_ent = a.n THEN 'processed'
    WHEN a.n_ent > 0 THEN 'partial_processing'
    WHEN EXISTS (
      SELECT 1 FROM patient_results pr
      WHERE pr.registration_id = v_reg AND COALESCE(pr.result_value,'') <> ''
        AND (v_cancelled IS NULL OR NOT (pr.test_id::text = ANY (v_cancelled)))
    ) THEN 'processing'
    WHEN t.n > 0 AND t.n_acc = t.n THEN 'sample_accepted'
    WHEN t.n_acc > 0 THEN 'partially_accepted'
    WHEN t.n > 0 AND t.n_col_acc = t.n THEN 'sample_collected'
    WHEN t.n_col > 0 THEN 'partially_collected'
    ELSE 'registered'
  END INTO v_new
  FROM agg a, tubes t;

  IF v_has_untracked THEN
    IF v_new = 'dispatched' THEN v_new := 'partially_dispatched';
    ELSIF v_new = 'approved' THEN v_new := 'partially_approved';
    ELSIF v_new = 'verified' THEN v_new := 'partial_verified';
    ELSIF v_new = 'processed' THEN v_new := 'partial_processing';
    END IF;
  END IF;

  IF v_has_pending THEN
    IF v_new = 'dispatched' THEN v_new := 'partially_dispatched';
    ELSIF v_new = 'approved' THEN v_new := 'partially_approved';
    ELSIF v_new = 'verified' THEN v_new := 'partial_verified';
    ELSIF v_new = 'processed' THEN v_new := 'partial_processing';
    ELSIF v_new = 'sample_accepted' THEN v_new := 'partially_accepted';
    ELSIF v_new = 'sample_collected' THEN v_new := 'partially_collected';
    ELSIF v_new = 'registered' AND v_has_collected THEN v_new := 'partially_collected';
    END IF;
  END IF;

  UPDATE patient_registrations SET status = v_new WHERE id = v_reg;
END $$;
`);
}

async function getReg(regId) {
  const rows = await api("GET", `/rest/v1/patient_registrations?id=eq.${regId}&select=*`);
  return rows?.[0];
}
async function getTubes(regId) {
  return (await api("GET", `/rest/v1/sample_tubes?registration_id=eq.${regId}&select=*&order=created_at.asc`)) || [];
}
async function getResults(regId) {
  return (await api("GET", `/rest/v1/patient_results?registration_id=eq.${regId}&select=*`)) || [];
}
async function getSnips(regId) {
  return (await api("GET", `/rest/v1/outsourced_test_snips?registration_id=eq.${regId}&select=*`)) || [];
}

async function expectStatus(regId, allowed, label) {
  recalcStatus(regId);
  const reg = await getReg(regId);
  const ok = allowed.includes(reg.status);
  note(`${label}.status`, ok, `got=${reg.status} want∈[${allowed.join(",")}]`);
  if (!ok) {
    flaw("P0", "status", `${label}: expected status in [${allowed.join(",")}] got ${reg.status}`, "Fix limsStatus / tube transitions for partial pipeline");
  }
  return reg.status;
}

async function assertNotStuck(regId, label) {
  const [tubes, results, snips, entryIds, verifyIds, approveIds, dispatchIds, osIds] = await Promise.all([
    getTubes(regId),
    getResults(regId),
    getSnips(regId),
    rpc("lims_results_entry_candidate_ids"),
    rpc("lims_verification_candidate_ids"),
    rpc("lims_doctor_approval_candidate_ids"),
    rpc("lims_dispatch_candidate_ids"),
    rpc("lims_outsourced_candidate_ids"),
  ]);
  const reg = await getReg(regId);
  const cancelled = new Set(
    (Array.isArray(reg.cancelled_tests) ? reg.cancelled_tests : [])
      .map((x) => (typeof x === "string" ? x : x?.test_id))
      .filter(Boolean),
  );

  const tracked = new Set();
  for (const r of results) {
    if (cancelled.has(r.test_id)) continue;
    if (["entered", "results_entered", "verified", "approved", "dispatched"].includes(r.status)) tracked.add(r.test_id);
  }
  for (const s of snips) {
    if (cancelled.has(s.test_id)) continue;
    if (["entered", "results_entered", "verified", "approved", "dispatched", "results_saved", "sent", "pending"].includes(s.outsource_status)) {
      // pending/sent/results_saved still "owned" by outsourced queue
      if (["entered", "results_entered", "verified", "approved", "dispatched"].includes(s.outsource_status)) tracked.add(s.test_id);
    }
  }

  const issues = [];
  // Accepted tests without tracked results must appear in entry OR have open snip
  const acceptedTests = new Set();
  for (const t of tubes) {
    if (t.status !== "accepted") continue;
    for (const tid of t.test_ids || []) {
      if (!tid || cancelled.has(tid)) continue;
      acceptedTests.add(tid);
    }
  }

  for (const tid of acceptedTests) {
    const hasTracked = tracked.has(tid);
    const openSnip = snips.find(
      (s) =>
        s.test_id === tid &&
        ["pending", "sent", "results_saved"].includes(s.outsource_status),
    );
    const inEntry = (entryIds || []).includes(regId);
    if (!hasTracked && !openSnip) {
      // Must be visible in results entry candidates
      if (!inEntry) {
        issues.push(`test ${tid} accepted but not tracked, no open snip, reg NOT in entry candidates`);
      }
    }
  }

  // Pending tubes → collection visible (we can't call collection query; check tube status only)
  const pendingTubes = tubes.filter((t) => t.status === "pending");
  const collectedTubes = tubes.filter((t) => t.status === "collected");

  // Entered results → verification candidate
  const hasEntered = results.some((r) => ["entered", "results_entered"].includes(r.status) && !cancelled.has(r.test_id));
  const hasEnteredSnip = snips.some((s) => ["entered", "results_entered"].includes(s.outsource_status) && !cancelled.has(s.test_id));
  if ((hasEntered || hasEnteredSnip) && !(verifyIds || []).includes(regId)) {
    issues.push(`has entered results/snips but reg NOT in verification candidates`);
  }

  const hasVerified = results.some((r) => r.status === "verified" && !cancelled.has(r.test_id));
  const hasVerifiedSnip = snips.some((s) => s.outsource_status === "verified" && !cancelled.has(s.test_id));
  if ((hasVerified || hasVerifiedSnip) && !(approveIds || []).includes(regId)) {
    issues.push(`has verified rows but reg NOT in doctor_approval candidates`);
  }

  const hasApproved = results.some((r) => r.status === "approved" && !cancelled.has(r.test_id));
  const hasApprovedSnip = snips.some((s) => s.outsource_status === "approved" && !cancelled.has(s.test_id));
  if ((hasApproved || hasApprovedSnip) && !(dispatchIds || []).includes(regId)) {
    issues.push(`has approved rows but reg NOT in dispatch candidates`);
  }

  const hasOpenOs = snips.some((s) => ["pending", "sent", "results_saved"].includes(s.outsource_status));
  if (hasOpenOs && !(osIds || []).includes(regId)) {
    // outsourced candidate RPC may exclude some states — note as P1 if missing
    issues.push(`has open outsourced snip but reg NOT in outsourced candidates`);
  }

  const ok = issues.length === 0;
  note(
    `${label}.not_stuck`,
    ok,
    `pendingTubes=${pendingTubes.length} collected=${collectedTubes.length} acceptedTests=${acceptedTests.size} issues=${issues.length}`,
  );
  for (const i of issues) {
    flaw("P0", "pipeline", `${label}: ${i}`, "Ensure candidate RPCs + status recalc include partial / snip / send-back states");
  }
  return { pendingTubes, collectedTubes, acceptedTests, entryIds, verifyIds, approveIds, dispatchIds, osIds, issues };
}

async function loadFixtureBundle() {
  const channels = await api("GET", "/rest/v1/channels?select=id,name,billing_type&order=name.asc");
  const sjyo = (channels || []).find((c) => /sjyo/i.test(c.name));
  if (!sjyo) throw new Error("Channel SJYO not found");

  const pickups = await api("GET", "/rest/v1/pickup_points?select=id,name,billing_type&order=name.asc&limit=20");
  const pickup = (pickups || []).find((p) => /vasundhara/i.test(p.name)) || pickups?.[0];
  if (!pickup) throw new Error("No pickup point found");

  const tests = await api(
    "GET",
    "/rest/v1/tests?select=id,test_name,test_code,price,is_outsourced,sample_tube,tube_color,sample_type,is_active&is_active=eq.true&order=test_name.asc&limit=500",
  );

  const withParams = [];
  const noParams = [];
  const outsourced = [];
  for (const t of tests || []) {
    const junc = await api(
      "GET",
      `/rest/v1/test_parameters?test_id=eq.${t.id}&parameter_id=not.is.null&select=parameter_id,report_test_parameters(id,param_code,parameter_name,unit)&limit=20`,
    );
    const params = (junc || []).map((j) => j.report_test_parameters).filter(Boolean);
    const enriched = { ...t, params, paramCount: params.length };
    if (t.is_outsourced) outsourced.push(enriched);
    else if (params.length === 0) noParams.push(enriched);
    else withParams.push(enriched);
  }

  // Prefer diverse tubes
  const pick = [];
  const wantCodes = ["TST0068", "TST0105", "TST0175", "TST0252", "TST0008", "TST0006", "TST0003", "TST0011"];
  for (const code of wantCodes) {
    const t = withParams.find((x) => x.test_code === code);
    if (t && !pick.find((p) => p.id === t.id)) pick.push(t);
  }
  while (pick.length < 8 && withParams.length) {
    const t = withParams[pick.length % withParams.length];
    if (!pick.find((p) => p.id === t.id)) pick.push(t);
    else break;
  }

  // 2 outsourced
  for (const t of outsourced.slice(0, 2)) {
    if (!pick.find((p) => p.id === t.id)) pick.push(t);
  }
  // 2 snip (zero-param)
  for (const t of noParams.filter((x) => Number(x.price || 0) < 5000).slice(0, 2)) {
    if (!pick.find((p) => p.id === t.id)) pick.push(t);
  }

  if (pick.length < 10) {
    for (const t of withParams) {
      if (pick.length >= 12) break;
      if (!pick.find((p) => p.id === t.id)) pick.push(t);
    }
  }

  note(
    "fixtures",
    true,
    `tests=${pick.length} sjyo=${sjyo.name} pickup=${pickup.name} os=${pick.filter((t) => t.is_outsourced).length} snip=${pick.filter((t) => t.paramCount === 0).length}`,
  );
  return { sjyo, pickup, tests: pick.slice(0, 12) };
}

function buildTubesFromTests(testList) {
  const groups = new Map();
  for (const t of testList) {
    const tube = (t.sample_tube || "DEFAULT").trim() || "DEFAULT";
    const color = (t.tube_color || "").trim();
    const stype = (t.sample_type || "").trim();
    const key = `${tube}||${color}||${stype}`;
    if (!groups.has(key)) {
      groups.set(key, {
        tube_type: tube,
        tube_color: color,
        sample_type: stype,
        suffix: "",
        test_ids: [],
        test_names: [],
        status: "pending",
      });
    }
    const g = groups.get(key);
    g.test_ids.push(t.id);
    g.test_names.push(t.test_name);
  }
  return Array.from(groups.values());
}

async function registerPatient({ name, mobile, visitType, channelId, pickupPointId, homeVisitId, tests, paid, due, hvCharges = 0 }) {
  const invoice = await rpc("generate_invoice_number");
  const umr = visitType === "pickup_point" ? null : await rpc("generate_umr_number");
  const gross = tests.reduce((s, t) => s + Number(t.price || 0), 0) + Number(hvCharges || 0);
  const finalAmt = gross;
  const paidAmt = paid ?? finalAmt;
  const dueAmt = due ?? Math.max(0, finalAmt - paidAmt);
  const tubes = buildTubesFromTests(tests);
  const testsJson = tests.map((t) => ({
    test_id: t.id,
    test_name: t.test_name,
    price: Number(t.price || 0),
    discounted_price: Number(t.price || 0),
    item_type: "test",
  }));

  const payment =
    paidAmt > 0
      ? {
          invoice_number: invoice,
          patient_name: name,
          transaction_type: "registration_payment",
          direction: "in",
          performed_by: "PARTIAL_AUDIT",
          cash_amount: paidAmt,
          gpay_amount: 0,
          paytm_amount: 0,
          credit_card_amount: 0,
          neft_amount: 0,
          total_amount: paidAmt,
          gross_amount: gross,
          discount_amount: 0,
          final_amount: finalAmt,
          paid_amount: paidAmt,
          due_amount: dueAmt,
          remarks: "PARTIALAUDIT registration",
        }
      : null;

  const atomic = await rpc("register_patient_atomic", {
    p_registration: {
      invoice_number: invoice,
      umr_number: umr,
      title: "MR",
      patient_name: name,
      gender: "Male",
      dob: "1990-01-15",
      mobile_number: mobile,
      doctor_name: "SELF",
      address: "PARTIALAUDIT ADDR",
      visit_type: visitType,
      channel_id: channelId || null,
      pickup_point_id: pickupPointId || null,
      home_visit_id: homeVisitId || null,
      home_visit_charges: hvCharges || 0,
      tests: testsJson,
      gross_amount: gross,
      discount_amount: 0,
      net_amount: gross - (hvCharges || 0),
      final_amount: finalAmt,
      paid_amount: paidAmt,
      due_amount: dueAmt,
      payments: paidAmt > 0 ? [{ mode: "Cash", amount: paidAmt }] : [],
      status: "registered",
      registered_by: "PARTIAL_AUDIT",
    },
    p_tubes: tubes,
    p_payment: payment,
    p_home_visit_id: homeVisitId || null,
    p_home_visit_patch: homeVisitId ? { status: "Registered", paid_amount: paidAmt, due_amount: dueAmt } : null,
  });

  const regId = atomic?.id;
  if (!regId) throw new Error(`register failed: ${JSON.stringify(atomic)}`);
  report.created.registrationIds.push(regId);

  if (payment) {
    const pays = await api(
      "GET",
      `/rest/v1/payment_transactions?registration_id=eq.${regId}&select=id`,
    );
    report.created.paymentIds.push(...(pays || []).map((p) => p.id));
  }

  return { regId, invoice, umr, tubes: await getTubes(regId), finalAmt, paidAmt, dueAmt };
}

async function enterResultsForTests(regId, testList, status = "entered") {
  const now = new Date().toISOString();
  const rows = [];
  for (const t of testList) {
    if (!t.params?.length) continue;
    for (const p of t.params.slice(0, 4)) {
      rows.push({
        registration_id: regId,
        test_id: t.id,
        parameter_id: p.id,
        param_code: p.param_code,
        parameter_name: p.parameter_name,
        result_value: "12.5",
        unit: p.unit || "",
        status,
        entered_at: now,
        entered_by: "PARTIAL_AUDIT",
        ...(status === "verified"
          ? { verified_at: now, verified_by: "PARTIAL_AUDIT" }
          : {}),
        ...(status === "approved"
          ? { verified_at: now, verified_by: "PARTIAL_AUDIT", approved_at: now, approved_by: "PARTIAL_AUDIT" }
          : {}),
        ...(status === "dispatched"
          ? {
              verified_at: now,
              verified_by: "PARTIAL_AUDIT",
              approved_at: now,
              approved_by: "PARTIAL_AUDIT",
              dispatched_at: now,
              dispatched_by: "PARTIAL_AUDIT",
            }
          : {}),
      });
    }
  }
  if (!rows.length) return [];
  // delete existing for these tests then insert
  const testIds = [...new Set(rows.map((r) => r.test_id))];
  for (const tid of testIds) {
    await api("DELETE", `/rest/v1/patient_results?registration_id=eq.${regId}&test_id=eq.${tid}`);
  }
  const inserted = await api("POST", "/rest/v1/patient_results", rows);
  return inserted || [];
}

async function upsertSnip(regId, test, outsourceStatus, resultMode = "snip") {
  const existing = await api(
    "GET",
    `/rest/v1/outsourced_test_snips?registration_id=eq.${regId}&test_id=eq.${test.id}&select=id`,
  );
  const payload = {
    registration_id: regId,
    test_id: test.id,
    outsource_status: outsourceStatus,
    outsourced_lab_name: "AUDIT LAB",
    result_mode: resultMode,
    snip_image_urls:
      resultMode === "snip"
        ? ["https://example.com/partialaudit-snip.png"]
        : [],
    sent_at: new Date().toISOString(),
  };
  if (existing?.[0]?.id) {
    await api("PATCH", `/rest/v1/outsourced_test_snips?id=eq.${existing[0].id}`, payload);
    return existing[0].id;
  }
  const [row] = await api("POST", "/rest/v1/outsourced_test_snips", payload);
  return row?.id;
}

async function setResultStatus(regId, testIds, fromStatuses, toStatus) {
  const now = new Date().toISOString();
  const patch = { status: toStatus };
  if (toStatus === "verified") Object.assign(patch, { verified_at: now, verified_by: "PARTIAL_AUDIT" });
  if (toStatus === "approved") Object.assign(patch, { approved_at: now, approved_by: "PARTIAL_AUDIT" });
  if (toStatus === "dispatched") Object.assign(patch, { dispatched_at: now, dispatched_by: "PARTIAL_AUDIT" });
  if (toStatus === "pending" || toStatus === "entered") {
    if (toStatus === "pending") Object.assign(patch, { verified_at: null, verified_by: null, approved_at: null, approved_by: null });
    if (toStatus === "entered") Object.assign(patch, { verified_at: null, verified_by: null, approved_at: null, approved_by: null });
  }
  for (const tid of testIds) {
    const filter = fromStatuses?.length
      ? `&status=in.(${fromStatuses.join(",")})`
      : "";
    await api("PATCH", `/rest/v1/patient_results?registration_id=eq.${regId}&test_id=eq.${tid}${filter}`, patch);
  }
}

async function setSnipStatus(regId, testIds, toStatus) {
  for (const tid of testIds) {
    await api("PATCH", `/rest/v1/outsourced_test_snips?registration_id=eq.${regId}&test_id=eq.${tid}`, {
      outsource_status: toStatus,
    });
  }
}

/** Simulate verification send-back → pending (Results Entry). */
async function sendBackFromVerification(regId, testIds) {
  await setResultStatus(regId, testIds, ["entered", "results_entered", "verified"], "pending");
  await setSnipStatus(regId, testIds, "results_saved");
  recalcStatus(regId);
}

/** Simulate doctor send-back → entered (Verification). */
async function sendBackFromApproval(regId, testIds) {
  await setResultStatus(regId, testIds, ["verified", "approved"], "entered");
  await setSnipStatus(regId, testIds, "results_entered");
  recalcStatus(regId);
}

/** Scoped repeat — mirrors src/lib/repeatCollection.ts (split shared tubes + merge). */
async function repeatCollectionScoped(regId, tests) {
  const unique = new Map();
  for (const t of tests) unique.set(t.id || t.test_id, t.test_name || t.testName || "");
  const repeatIds = new Set(unique.keys());
  const now = new Date().toISOString();

  for (const testId of repeatIds) {
    await api("DELETE", `/rest/v1/patient_results?registration_id=eq.${regId}&test_id=eq.${testId}`);
    await api("DELETE", `/rest/v1/outsourced_test_snips?registration_id=eq.${regId}&test_id=eq.${testId}`);
  }

  const tubes = await getTubes(regId);
  const physicalKey = (t) =>
    `${String(t.tube_type || "").toUpperCase()}||${String(t.tube_color || "").toUpperCase()}||${String(t.sample_type || "").toUpperCase()}`;

  const reg = await getReg(regId);
  const priorRepeat = Array.isArray(reg.repeat_tests) ? reg.repeat_tests : [];
  const mergeable = new Set([...priorRepeat.map((x) => x.test_id), ...repeatIds]);

  const pendingByKey = new Map();
  for (const t of tubes) {
    if (t.status !== "pending") continue;
    const ids = Array.isArray(t.test_ids) ? t.test_ids : [];
    if (ids.length && ids.every((id) => mergeable.has(id))) pendingByKey.set(physicalKey(t), t);
  }

  const suffixes = tubes.map((t) => String(t.suffix || "").trim());
  const nextSuffix = (base) => {
    const root = `${base || ""}R`;
    if (!suffixes.includes(root)) {
      suffixes.push(root);
      return root;
    }
    let i = 2;
    while (suffixes.includes(`${root}${i}`)) i++;
    suffixes.push(`${root}${i}`);
    return `${root}${i}`;
  };

  for (const tube of [...tubes]) {
    const ids = Array.isArray(tube.test_ids) ? tube.test_ids : [];
    const names = Array.isArray(tube.test_names) ? tube.test_names : [];
    const hitIds = ids.filter((id) => repeatIds.has(id));
    if (!hitIds.length) continue;
    const remainIds = ids.filter((id) => !repeatIds.has(id));
    const remainNames = ids
      .map((id, i) => ({ id, name: names[i] || "" }))
      .filter((x) => !repeatIds.has(x.id))
      .map((x) => x.name);
    const hitNames = hitIds.map((id) => unique.get(id) || names[ids.indexOf(id)] || "");
    const key = physicalKey(tube);

    if (remainIds.length === 0) {
      await api("PATCH", `/rest/v1/sample_tubes?id=eq.${tube.id}`, {
        status: "pending",
        collected_at: null,
        collected_by: null,
        accepted_at: null,
        accepted_by: null,
      });
      pendingByKey.set(key, { ...tube, status: "pending", test_ids: ids, test_names: names });
      continue;
    }

    await api("PATCH", `/rest/v1/sample_tubes?id=eq.${tube.id}`, {
      test_ids: remainIds,
      test_names: remainNames,
    });

    const existingPending = pendingByKey.get(key);
    if (existingPending && existingPending.id !== tube.id) {
      const exIds = Array.isArray(existingPending.test_ids) ? [...existingPending.test_ids] : [];
      const exNames = Array.isArray(existingPending.test_names) ? [...existingPending.test_names] : [];
      hitIds.forEach((id, i) => {
        if (!exIds.includes(id)) {
          exIds.push(id);
          exNames.push(hitNames[i] || "");
        }
      });
      await api("PATCH", `/rest/v1/sample_tubes?id=eq.${existingPending.id}`, {
        test_ids: exIds,
        test_names: exNames,
        status: "pending",
        collected_at: null,
        accepted_at: null,
      });
      pendingByKey.set(key, { ...existingPending, test_ids: exIds, test_names: exNames });
      continue;
    }

    const uid = await rpc("generate_sample_uid");
    const [inserted] = await api("POST", "/rest/v1/sample_tubes", {
      sample_uid: uid,
      registration_id: regId,
      tube_type: tube.tube_type,
      tube_color: tube.tube_color,
      sample_type: tube.sample_type,
      suffix: nextSuffix(tube.suffix),
      test_ids: hitIds,
      test_names: hitNames,
      status: "pending",
    });
    pendingByKey.set(key, inserted);
  }

  // Consolidate pending repeat tubes by physical key
  const allPending = (await getTubes(regId)).filter((t) => t.status === "pending");
  const activeRepeat = new Set([...priorRepeat.map((x) => x.test_id), ...repeatIds]);
  const groups = new Map();
  for (const t of allPending) {
    const ids = Array.isArray(t.test_ids) ? t.test_ids : [];
    if (!ids.length || !ids.every((id) => activeRepeat.has(id))) continue;
    const key = physicalKey(t);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    group.sort((a, b) => String(a.suffix || "").length - String(b.suffix || "").length);
    const keep = group[0];
    const mergedIds = [];
    const mergedNames = [];
    for (const t of group) {
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
    const drop = group.slice(1).map((t) => t.id);
    if (drop.length) await api("DELETE", `/rest/v1/sample_tubes?id=in.(${drop.join(",")})`);
  }

  const nextRepeat = [...priorRepeat];
  for (const [test_id, test_name] of unique) {
    const idx = nextRepeat.findIndex((x) => x.test_id === test_id);
    const entry = { test_id, test_name, requested_at: now, requested_by: "PARTIAL_AUDIT" };
    if (idx >= 0) nextRepeat[idx] = entry;
    else nextRepeat.push(entry);
  }
  await api("PATCH", `/rest/v1/patient_registrations?id=eq.${regId}`, {
    status: "repeat_collection",
    repeat_tests: nextRepeat,
  });
  recalcStatus(regId);
}

/** Legacy name used in clinical path — single test. */
async function repeatCollection(regId, test) {
  const t = typeof test === "string" ? { id: test, test_name: "" } : test;
  await repeatCollectionScoped(regId, [t]);
}

async function collectTubes(tubeIds) {
  const now = new Date().toISOString();
  for (const id of tubeIds) {
    await api("PATCH", `/rest/v1/sample_tubes?id=eq.${id}&status=eq.pending`, {
      status: "collected",
      collected_at: now,
      collected_by: "PARTIAL_AUDIT",
    });
  }
}
async function acceptTubes(tubeIds) {
  const now = new Date().toISOString();
  for (const id of tubeIds) {
    await api("PATCH", `/rest/v1/sample_tubes?id=eq.${id}&status=eq.collected`, {
      status: "accepted",
      accepted_at: now,
      accepted_by: "PARTIAL_AUDIT",
    });
  }
}

async function runPartialClinicalPath(label, ctx) {
  const { regId, tests } = ctx;
  const inhouse = tests.filter((t) => !t.is_outsourced && t.paramCount > 0);
  const os = tests.filter((t) => t.is_outsourced);
  const snipTests = tests.filter((t) => t.paramCount === 0);
  let tubes = await getTubes(regId);
  if (tubes.length < 2) {
    flaw("P1", label, `Only ${tubes.length} tube(s) — partial collect needs ≥2`, "Use tests with distinct sample tubes");
  }

  // --- Partial collect ---
  const half = Math.max(1, Math.floor(tubes.length / 2));
  await collectTubes(tubes.slice(0, half).map((t) => t.id));
  await expectStatus(regId, ["partially_collected", "sample_collected"], `${label}.partial_collect`);
  await assertNotStuck(regId, `${label}.after_partial_collect`);

  // --- Complete collect then partial accept ---
  tubes = await getTubes(regId);
  await collectTubes(tubes.filter((t) => t.status === "pending").map((t) => t.id));
  tubes = await getTubes(regId);
  const collected = tubes.filter((t) => t.status === "collected");
  const acceptHalf = Math.max(1, Math.floor(collected.length / 2));
  await acceptTubes(collected.slice(0, acceptHalf).map((t) => t.id));
  await expectStatus(regId, ["partially_accepted", "sample_accepted"], `${label}.partial_accept`);
  await assertNotStuck(regId, `${label}.after_partial_accept`);

  // Accept remaining
  tubes = await getTubes(regId);
  await acceptTubes(tubes.filter((t) => t.status === "collected").map((t) => t.id));
  await expectStatus(regId, ["sample_accepted", "partially_accepted"], `${label}.full_accept`);

  // Seed natural OS snips as pending (as acceptance would for is_outsourced)
  for (const t of os) {
    await upsertSnip(regId, t, "pending", t.paramCount === 0 ? "snip" : "manual");
  }
  // Transfer zero-param inhouse to snip outsourced path
  for (const t of snipTests) {
    await upsertSnip(regId, t, "sent", "snip");
  }

  // --- Partial results entry (half of inhouse) ---
  const firstHalf = inhouse.slice(0, Math.max(1, Math.floor(inhouse.length / 2)));
  const secondHalf = inhouse.slice(firstHalf.length);
  await enterResultsForTests(regId, firstHalf, "entered");
  recalcStatus(regId);
  await expectStatus(regId, ["partial_processing", "processing", "processed"], `${label}.partial_results`);
  {
    const st = await getReg(regId);
    const notRepeat =
      st.status !== "repeat_collection" &&
      !(Array.isArray(st.repeat_tests) && st.repeat_tests.length > 0);
    note(`${label}.first_time_partial_not_repeat`, notRepeat, `status=${st.status}`);
    if (!notRepeat) {
      flaw(
        "P0",
        "repeat",
        `${label}: first-time partial marked repeat_collection`,
        "Only explicit repeat_tests with pending tubes may set REPEAT",
      );
    }
  }
  await assertNotStuck(regId, `${label}.after_partial_results`);

  // Enter remaining inhouse
  await enterResultsForTests(regId, secondHalf, "entered");

  // Snip path: results_saved → results_entered
  for (const t of [...os, ...snipTests]) {
    await upsertSnip(regId, t, "results_entered", "snip");
  }
  recalcStatus(regId);
  await assertNotStuck(regId, `${label}.after_all_entered`);

  // --- Partial verify ---
  const verifyFirst = firstHalf.slice(0, Math.max(1, Math.floor(firstHalf.length / 2)));
  await setResultStatus(regId, verifyFirst.map((t) => t.id), ["entered", "results_entered"], "verified");
  await setSnipStatus(regId, os.slice(0, 1).map((t) => t.id), "verified");
  recalcStatus(regId);
  await expectStatus(regId, ["partial_verified", "verified", "partial_processing", "processed"], `${label}.partial_verify`);
  await assertNotStuck(regId, `${label}.after_partial_verify`);

  // --- Send back from verification (one test) ---
  const sendBackTest = secondHalf[0] || firstHalf[0];
  if (sendBackTest) {
    await setResultStatus(regId, [sendBackTest.id], null, "entered"); // ensure entered first
    await sendBackFromVerification(regId, [sendBackTest.id]);
    const results = await getResults(regId);
    const back = results.filter((r) => r.test_id === sendBackTest.id);
    const okPending = back.length === 0 || back.every((r) => r.status === "pending");
    note(`${label}.sendback_verification`, okPending, `test=${sendBackTest.test_code} statuses=${[...new Set(back.map((r) => r.status))].join(",")}`);
    if (!okPending) {
      flaw("P0", "sendback", `${label}: verification send-back did not set pending for ${sendBackTest.test_code}`, "Align sendBackTest with status pending + entry queue");
    }
    // Re-enter after send-back
    await enterResultsForTests(regId, [sendBackTest], "entered");
  }

  // Verify all remaining entered
  await setResultStatus(regId, inhouse.map((t) => t.id), ["entered", "results_entered", "pending"], "verified");
  await setSnipStatus(regId, [...os, ...snipTests].map((t) => t.id), "verified");
  recalcStatus(regId);
  await assertNotStuck(regId, `${label}.after_full_verify`);

  // --- Partial approve ---
  const approveFirst = inhouse.slice(0, Math.max(1, Math.floor(inhouse.length / 2)));
  await setResultStatus(regId, approveFirst.map((t) => t.id), ["verified"], "approved");
  await setSnipStatus(regId, snipTests.slice(0, 1).map((t) => t.id), "approved");
  recalcStatus(regId);
  await expectStatus(regId, ["partially_approved", "approved", "partial_verified", "verified"], `${label}.partial_approve`);
  await assertNotStuck(regId, `${label}.after_partial_approve`);

  // --- Send back from doctor approval ---
  const sb2 = inhouse.find((t) => !approveFirst.includes(t)) || approveFirst[0];
  if (sb2) {
    await sendBackFromApproval(regId, [sb2.id]);
    const results = await getResults(regId);
    const back = results.filter((r) => r.test_id === sb2.id);
    const okEntered = back.every((r) => r.status === "entered");
    note(`${label}.sendback_approval`, okEntered, `test=${sb2.test_code}`);
    if (!okEntered) {
      flaw("P0", "sendback", `${label}: approval send-back did not set entered for ${sb2.test_code}`, "Fix sendBackForVerification status transitions");
    }
    await setResultStatus(regId, [sb2.id], ["entered"], "verified");
  }

  // --- Repeat collection on one approved test (scoped) ---
  const repeatTarget = approveFirst[0];
  if (repeatTarget) {
    await repeatCollection(regId, repeatTarget);
    const tubesAfter = await getTubes(regId);
    const pendingAgain = tubesAfter.filter(
      (t) => (t.test_ids || []).includes(repeatTarget.id) && t.status === "pending",
    );
    const regAfter = await getReg(regId);
    const repeatList = Array.isArray(regAfter.repeat_tests) ? regAfter.repeat_tests : [];

    note(`${label}.repeat_collection`, pendingAgain.length > 0, `test=${repeatTarget.test_code} pendingTubes=${pendingAgain.length}`);
    if (!pendingAgain.length) {
      flaw("P0", "repeat", `${label}: no pending tube for ${repeatTarget.test_code}`, "Scoped repeat must open pending tube for target test");
    }
    note(
      `${label}.repeat_scoped_list`,
      repeatList.some((x) => x.test_id === repeatTarget.id),
      `repeat_tests=${repeatList.map((x) => x.test_name || x.test_id).join(",")}`,
    );
    if (!repeatList.some((x) => x.test_id === repeatTarget.id)) {
      flaw("P0", "repeat", `${label}: repeat_tests missing ${repeatTarget.test_code}`, "Track repeat_tests per test");
    }
    // Pending tubes for this repeat should not drag unrelated non-repeat tests unless they shared and were split out
    const pendingHasOnlyRepeatListed = pendingAgain.every((t) =>
      (t.test_ids || []).every((id) => repeatList.some((r) => r.test_id === id)),
    );
    note(`${label}.repeat_tube_scoped`, pendingHasOnlyRepeatListed, "pending tubes only carry listed repeat tests");
    if (!pendingHasOnlyRepeatListed) {
      flaw("P0", "repeat", `${label}: pending repeat tube includes non-repeat tests`, "Split shared tubes; only repeat tests on pending tube");
    }
    await expectStatus(regId, ["repeat_collection"], `${label}.after_repeat`);

    await collectTubes(pendingAgain.map((t) => t.id));
    await acceptTubes(pendingAgain.map((t) => t.id));
    await enterResultsForTests(regId, [repeatTarget], "entered");
    await setResultStatus(regId, [repeatTarget.id], ["entered"], "verified");
    await setResultStatus(regId, [repeatTarget.id], ["verified"], "approved");
    recalcStatus(regId);
    const stAfterRe = await getReg(regId);
    const cleared =
      stAfterRe.status !== "repeat_collection" &&
      !(Array.isArray(stAfterRe.repeat_tests) && stAfterRe.repeat_tests.length > 0);
    note(`${label}.repeat_cleared`, cleared, `status=${stAfterRe.status}`);
    if (!cleared) {
      flaw("P1", "repeat", `${label}: repeat_tests stuck after re-collect`, "Clear repeat_tests once pending repeat tubes are done");
    }
  }

  // Finish approve all
  await setResultStatus(regId, inhouse.map((t) => t.id), ["verified", "entered", "pending"], "approved");
  await setSnipStatus(regId, [...os, ...snipTests].map((t) => t.id), "approved");
  recalcStatus(regId);
  await assertNotStuck(regId, `${label}.after_full_approve`);

  // --- Partial dispatch ---
  const dispFirst = inhouse.slice(0, Math.max(1, Math.floor(inhouse.length / 2)));
  await setResultStatus(regId, dispFirst.map((t) => t.id), ["approved"], "dispatched");
  await setSnipStatus(regId, os.slice(0, 1).map((t) => t.id), "dispatched");
  recalcStatus(regId);
  await expectStatus(regId, ["partially_dispatched", "dispatched"], `${label}.partial_dispatch`);
  await assertNotStuck(regId, `${label}.after_partial_dispatch`);

  // Full dispatch
  await setResultStatus(regId, inhouse.map((t) => t.id), ["approved", "verified"], "dispatched");
  await setSnipStatus(regId, [...os, ...snipTests].map((t) => t.id), "dispatched");
  // Upsert approved_reports
  const reg = await getReg(regId);
  try {
    const [ar] = await api("POST", "/rest/v1/approved_reports", {
      registration_id: regId,
      invoice_number: reg.invoice_number,
      umr_number: reg.umr_number,
      patient_name: reg.patient_name,
      gender: reg.gender,
      mobile_number: reg.mobile_number,
      approved_by: "PARTIAL_AUDIT",
      registration_date: reg.created_at,
      approval_date: new Date().toISOString(),
      test_results: {},
    });
    if (ar?.id) {
      /* tracked via reg cleanup */
    }
  } catch (e) {
    // upsert conflict ok
    await api("PATCH", `/rest/v1/approved_reports?registration_id=eq.${regId}`, {
      approval_date: new Date().toISOString(),
    }).catch(() => {});
  }
  recalcStatus(regId);
  await expectStatus(regId, ["dispatched", "partially_dispatched"], `${label}.full_dispatch`);
  await assertNotStuck(regId, `${label}.after_full_dispatch`);

  report.scenarios[label] = { regId, invoice: reg.invoice_number, ok: report.flaws.filter((f) => f.detail.includes(label)).length === 0 };
}

async function runSharedTubeRepeatDispatchAudit(allTests) {
  const label = "shared_tube_repeat";
  // Prefer CBC + ESR (same EDTA) + one PLAIN test for first-time partial check
  const byCode = Object.fromEntries(allTests.map((t) => [t.test_code, t]));
  let cbc = byCode.TST0068;
  let esr = byCode.TST0105;
  let plain = allTests.find((t) => !t.is_outsourced && t.paramCount > 0 && t.sample_tube && /PLAIN/i.test(t.sample_tube));
  if (!cbc || !esr) {
    // fallback: pick two inhouse with same sample_tube
    const inhouse = allTests.filter((t) => !t.is_outsourced && t.paramCount > 0);
    const groups = new Map();
    for (const t of inhouse) {
      const k = `${t.sample_tube || ""}||${t.tube_color || ""}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(t);
    }
    const pair = [...groups.values()].find((g) => g.length >= 2);
    if (pair) {
      cbc = pair[0];
      esr = pair[1];
    }
  }
  if (!cbc || !esr) {
    note(`${label}.skip`, false, "Could not find shared-tube pair");
    flaw("P2", label, "No shared-tube test pair in fixtures", "Seed CBC+ESR");
    return;
  }
  if (!plain || plain.id === cbc.id || plain.id === esr.id) {
    plain = allTests.find(
      (t) => !t.is_outsourced && t.paramCount > 0 && t.id !== cbc.id && t.id !== esr.id,
    );
  }
  const bundle = [cbc, esr, plain].filter(Boolean);
  // Enrich params if missing
  for (const t of bundle) {
    if (!t.params?.length) {
      const junc = await api(
        "GET",
        `/rest/v1/test_parameters?test_id=eq.${t.id}&parameter_id=not.is.null&select=parameter_id,report_test_parameters(id,param_code,parameter_name,unit)&limit=10`,
      );
      t.params = (junc || []).map((j) => j.report_test_parameters).filter(Boolean);
      t.paramCount = t.params.length;
    }
  }

  const name = `${MARKER} SHARED`;
  // Force shared tube for CBC+ESR in registration payload
  const invoice = await rpc("generate_invoice_number");
  const umr = await rpc("generate_umr_number");
  const gross = bundle.reduce((s, t) => s + Number(t.price || 0), 0);
  const tubesPayload = [
    {
      tube_type: cbc.sample_tube || "EDTA",
      tube_color: cbc.tube_color || "PURPLE",
      sample_type: cbc.sample_type || "WHOLE BLOOD",
      suffix: "",
      test_ids: [cbc.id, esr.id],
      test_names: [cbc.test_name, esr.test_name],
      status: "pending",
    },
  ];
  if (plain) {
    tubesPayload.push({
      tube_type: plain.sample_tube || "PLAIN",
      tube_color: plain.tube_color || "RED",
      sample_type: plain.sample_type || "SERUM",
      suffix: "",
      test_ids: [plain.id],
      test_names: [plain.test_name],
      status: "pending",
    });
  }
  const atomic = await rpc("register_patient_atomic", {
    p_registration: {
      invoice_number: invoice,
      umr_number: umr,
      title: "MR",
      patient_name: name,
      gender: "Male",
      dob: "1990-01-15",
      mobile_number: `${MOBILE_BASE}2001`,
      doctor_name: "SELF",
      address: "PARTIALAUDIT SHARED",
      visit_type: "lab_visit",
      tests: bundle.map((t) => ({
        test_id: t.id,
        test_name: t.test_name,
        price: Number(t.price || 0),
        discounted_price: Number(t.price || 0),
        item_type: "test",
      })),
      gross_amount: gross,
      discount_amount: 0,
      net_amount: gross,
      final_amount: gross,
      paid_amount: gross,
      due_amount: 0,
      payments: [{ mode: "Cash", amount: gross }],
      status: "registered",
      registered_by: "PARTIAL_AUDIT",
    },
    p_tubes: tubesPayload,
    p_payment: {
      invoice_number: invoice,
      patient_name: name,
      transaction_type: "registration_payment",
      direction: "in",
      performed_by: "PARTIAL_AUDIT",
      cash_amount: gross,
      gpay_amount: 0,
      paytm_amount: 0,
      credit_card_amount: 0,
      neft_amount: 0,
      total_amount: gross,
      gross_amount: gross,
      discount_amount: 0,
      final_amount: gross,
      paid_amount: gross,
      due_amount: 0,
    },
    p_home_visit_id: null,
    p_home_visit_patch: null,
  });
  const regId = atomic?.id;
  if (!regId) throw new Error("shared tube register failed");
  report.created.registrationIds.push(regId);
  note(`${label}.register`, true, `${regId} tests=${bundle.map((t) => t.test_code).join(",")}`);

  // --- First-time partial: collect+accept shared tube only; leave plain pending ---
  let tubes = await getTubes(regId);
  const sharedTube = tubes.find((t) => (t.test_ids || []).includes(cbc.id) && (t.test_ids || []).includes(esr.id));
  const plainTube = plain ? tubes.find((t) => (t.test_ids || []).includes(plain.id)) : null;
  await collectTubes([sharedTube.id]);
  await acceptTubes([sharedTube.id]);
  await enterResultsForTests(regId, [cbc, esr], "entered");
  await setResultStatus(regId, [cbc.id, esr.id], ["entered"], "verified");
  await setResultStatus(regId, [cbc.id, esr.id], ["verified"], "approved");
  recalcStatus(regId);
  let st = await getReg(regId);
  const notRepeat =
    st.status !== "repeat_collection" &&
    !(Array.isArray(st.repeat_tests) && st.repeat_tests.length > 0);
  note(`${label}.first_time_partial_not_repeat`, notRepeat, `status=${st.status}`);
  if (!notRepeat) {
    flaw("P0", label, "First-time pending sibling marked as repeat_collection", "Only explicit repeat_tests should set REPEAT");
  }

  // Finish plain tube through approve so we can do clean scoped repeats
  if (plainTube) {
    await collectTubes([plainTube.id]);
    await acceptTubes([plainTube.id]);
    await enterResultsForTests(regId, [plain], "entered");
    await setResultStatus(regId, [plain.id], ["entered"], "verified");
    await setResultStatus(regId, [plain.id], ["verified"], "approved");
    recalcStatus(regId);
  }

  // --- Scoped repeat: CBC only — ESR must stay accepted with results ---
  await repeatCollectionScoped(regId, [cbc]);
  tubes = await getTubes(regId);
  const esrAccepted = tubes.some(
    (t) => t.status === "accepted" && (t.test_ids || []).includes(esr.id) && !(t.test_ids || []).includes(cbc.id),
  );
  const cbcPending = tubes.filter((t) => t.status === "pending" && (t.test_ids || []).includes(cbc.id));
  const esrResults = (await getResults(regId)).filter((r) => r.test_id === esr.id);
  note(`${label}.scope_esr_kept`, esrAccepted && esrResults.length > 0, `esrAccepted=${esrAccepted} esrResults=${esrResults.length}`);
  note(`${label}.scope_cbc_pending`, cbcPending.length === 1 && (cbcPending[0].test_ids || []).length === 1, `pending=${cbcPending.length}`);
  if (!esrAccepted || !esrResults.length) {
    flaw("P0", label, "CBC repeat wiped ESR acceptance/results", "Split shared tube; keep siblings accepted");
  }
  if (cbcPending.length !== 1 || (cbcPending[0].test_ids || []).includes(esr.id)) {
    flaw("P0", label, "CBC repeat pending tube not CBC-only", "Pending split tube must contain only CBC");
  }

  // --- Second repeat: ESR — must MERGE into one pending EDTA tube ---
  await repeatCollectionScoped(regId, [esr]);
  tubes = await getTubes(regId);
  const pendingEdta = tubes.filter((t) => {
    if (t.status !== "pending") return false;
    const ids = t.test_ids || [];
    return ids.includes(cbc.id) || ids.includes(esr.id);
  });
  const merged =
    pendingEdta.length === 1 &&
    (pendingEdta[0].test_ids || []).includes(cbc.id) &&
    (pendingEdta[0].test_ids || []).includes(esr.id);
  note(`${label}.merge_one_tube`, merged, `pendingShared=${pendingEdta.length} ids=${JSON.stringify(pendingEdta.map((t) => t.test_ids))}`);
  if (!merged) {
    flaw("P0", label, `Expected 1 merged pending tube for CBC+ESR, got ${pendingEdta.length}`, "consolidatePendingRepeatTubes by physical tube key");
  }

  // --- Re-collect through dispatch ---
  const pendingIds = tubes.filter((t) => t.status === "pending").map((t) => t.id);
  await collectTubes(pendingIds);
  await acceptTubes(pendingIds);
  await enterResultsForTests(regId, [cbc, esr], "entered");
  await setResultStatus(regId, [cbc.id, esr.id], ["entered"], "verified");
  await setResultStatus(regId, [cbc.id, esr.id], ["verified"], "approved");
  if (plain) await setResultStatus(regId, [plain.id], ["approved", "verified"], "approved");
  recalcStatus(regId);
  st = await getReg(regId);
  note(`${label}.after_recollect_cleared`, st.status !== "repeat_collection", `status=${st.status}`);

  await setResultStatus(regId, bundle.map((t) => t.id), ["approved", "verified"], "dispatched");
  const reg = await getReg(regId);
  try {
    await api("POST", "/rest/v1/approved_reports", {
      registration_id: regId,
      invoice_number: reg.invoice_number,
      umr_number: reg.umr_number,
      patient_name: reg.patient_name,
      gender: reg.gender,
      mobile_number: reg.mobile_number,
      approved_by: "PARTIAL_AUDIT",
      registration_date: reg.created_at,
      approval_date: new Date().toISOString(),
      test_results: {},
    });
  } catch {
    await api("PATCH", `/rest/v1/approved_reports?registration_id=eq.${regId}`, {
      approval_date: new Date().toISOString(),
    }).catch(() => {});
  }
  recalcStatus(regId);
  await expectStatus(regId, ["dispatched"], `${label}.full_dispatch`);
  await assertNotStuck(regId, `${label}.after_dispatch`);
  report.scenarios[label] = { regId, invoice: reg.invoice_number, ok: true };
}

async function runBillingAndCash(tests, sjyo) {
  const name = `${MARKER} BILLING`;
  const mobile = `${MOBILE_BASE}9001`;
  const subset = tests.slice(0, 6);
  const gross = subset.reduce((s, t) => s + Number(t.price || 0), 0);
  const partialPaid = Math.round(gross * 0.6);
  const { regId, invoice } = await registerPatient({
    name,
    mobile,
    visitType: "lab_visit",
    channelId: sjyo.id,
    tests: subset,
    paid: partialPaid,
    due: Math.max(0, gross - partialPaid),
  });

  let reg = await getReg(regId);
  note("billing.register", true, `invoice=${invoice} paid=${reg.paid_amount} due=${reg.due_amount} final=${reg.final_amount}`);

  // Collect due payment
  if (Number(reg.due_amount) > 0) {
    const duePay = Number(reg.due_amount);
    const [pt] = await api("POST", "/rest/v1/payment_transactions", {
      registration_id: regId,
      invoice_number: invoice,
      patient_name: name,
      transaction_type: "due_collection",
      direction: "in",
      performed_by: "PARTIAL_AUDIT",
      cash_amount: duePay,
      total_amount: duePay,
      gross_amount: 0,
      discount_amount: 0,
      final_amount: Number(reg.final_amount),
      paid_amount: Number(reg.paid_amount) + duePay,
      due_amount: 0,
      remarks: "PARTIALAUDIT due",
    });
    if (pt?.id) report.created.paymentIds.push(pt.id);
    await api("PATCH", `/rest/v1/patient_registrations?id=eq.${regId}`, {
      paid_amount: Number(reg.paid_amount) + duePay,
      due_amount: 0,
    });
    note("billing.due_collection", true, `₹${duePay}`);
  }

  // Cancel one test + refund
  const cancelTest = subset[subset.length - 1];
  const refundAmt = Number(cancelTest.price || 0);
  reg = await getReg(regId);
  const cancelled_tests = [
    { test_id: cancelTest.id, test_name: cancelTest.test_name, refund_amount: refundAmt },
  ];
  const newFinal = Math.max(0, Number(reg.final_amount) - refundAmt);
  const newPaid = Math.max(0, Number(reg.paid_amount) - refundAmt);
  await api("PATCH", `/rest/v1/patient_registrations?id=eq.${regId}`, {
    cancelled_tests,
    refund_amount: refundAmt,
    refund_mode: "Cash",
    refund_date: new Date().toISOString(),
    final_amount: newFinal,
    paid_amount: newPaid,
    due_amount: Math.max(0, newFinal - newPaid),
  });
  await api("DELETE", `/rest/v1/patient_results?registration_id=eq.${regId}&test_id=eq.${cancelTest.id}`);
  await api("DELETE", `/rest/v1/outsourced_test_snips?registration_id=eq.${regId}&test_id=eq.${cancelTest.id}`);
  // prune tubes
  const tubes = await getTubes(regId);
  for (const tube of tubes) {
    if (!(tube.test_ids || []).includes(cancelTest.id)) continue;
    const remaining = (tube.test_ids || []).filter((id) => id !== cancelTest.id);
    if (!remaining.length) await api("DELETE", `/rest/v1/sample_tubes?id=eq.${tube.id}`);
    else {
      await api("PATCH", `/rest/v1/sample_tubes?id=eq.${tube.id}`, {
        test_ids: remaining,
        test_names: (tube.test_names || []).slice(0, remaining.length),
      });
    }
  }
  const [refundPt] = await api("POST", "/rest/v1/payment_transactions", {
    registration_id: regId,
    invoice_number: invoice,
    patient_name: name,
    transaction_type: "refund",
    direction: "out",
    performed_by: "PARTIAL_AUDIT",
    cash_amount: -refundAmt,
    total_amount: -refundAmt,
    refund_amount: refundAmt,
    final_amount: newFinal,
    paid_amount: newPaid,
    due_amount: 0,
    remarks: `PARTIALAUDIT cancel ${cancelTest.test_code}`,
  });
  if (refundPt?.id) report.created.paymentIds.push(refundPt.id);
  recalcStatus(regId);
  note("billing.test_cancel_refund", true, `cancelled ${cancelTest.test_code} refund=₹${refundAmt}`);

  // Second patient for bill cancel
  const name2 = `${MARKER} BILLCANCEL`;
  const { regId: regId2, invoice: inv2 } = await registerPatient({
    name: name2,
    mobile: `${MOBILE_BASE}9002`,
    visitType: "lab_visit",
    tests: subset.slice(0, 3),
    paid: null,
  });
  reg = await getReg(regId2);
  const billRefund = Number(reg.paid_amount || 0);
  await api("PATCH", `/rest/v1/patient_registrations?id=eq.${regId2}`, {
    bill_cancelled: true,
    status: "cancelled",
    refund_amount: billRefund,
    refund_mode: "Cash",
    refund_date: new Date().toISOString(),
    final_amount: 0,
    paid_amount: 0,
    due_amount: 0,
  });
  if (billRefund > 0) {
    const [br] = await api("POST", "/rest/v1/payment_transactions", {
      registration_id: regId2,
      invoice_number: inv2,
      patient_name: name2,
      transaction_type: "refund",
      direction: "out",
      performed_by: "PARTIAL_AUDIT",
      cash_amount: -billRefund,
      total_amount: -billRefund,
      refund_amount: billRefund,
      remarks: "PARTIALAUDIT bill cancel refund",
    });
    if (br?.id) report.created.paymentIds.push(br.id);
  }
  await api("POST", "/rest/v1/payment_transactions", {
    registration_id: regId2,
    invoice_number: inv2,
    patient_name: name2,
    transaction_type: "bill_cancellation",
    direction: "out",
    performed_by: "PARTIAL_AUDIT",
    cash_amount: 0,
    total_amount: 0,
    remarks: "PARTIALAUDIT bill cancellation marker",
  });
  note("billing.bill_cancel", true, `invoice=${inv2} refunded=₹${billRefund}`);

  // Cash tally for today PARTIALAUDIT payments
  const today = new Date().toISOString().slice(0, 10);
  const txs = await api(
    "GET",
    `/rest/v1/payment_transactions?patient_name=like.PARTIALAUDIT*&transaction_date=gte.${today}&select=*`,
  );
  const rows = txs || [];
  let cash = 0,
    gpay = 0,
    totalIn = 0,
    totalOut = 0;
  for (const t of rows) {
    if (t.transaction_type === "bill_cancellation" || t.transaction_type === "old_bill_cancellation") continue;
    cash += Number(t.cash_amount || 0);
    gpay += Number(t.gpay_amount || 0);
    const tot = Number(t.total_amount || 0);
    if (t.direction === "out" || tot < 0) totalOut += Math.abs(tot);
    else totalIn += tot;
  }
  const net = totalIn - totalOut;
  const modeNet = cash + gpay;
  report.cash = { rows: rows.length, cash, gpay, totalIn, totalOut, net, modeNet };
  const tallyOk = Math.abs(net - modeNet) < 0.01;
  note("billing.daily_cash_tally", tallyOk, `in=${totalIn} out=${totalOut} net=${net} modeNet=${modeNet} rows=${rows.length}`);
  if (!tallyOk) {
    flaw(
      "P0",
      "cash",
      `Daily cash modes (₹${modeNet}) != direction net (₹${net}) for PARTIALAUDIT txs`,
      "Align payment_transactions sign/direction with DailyReport summing",
    );
  }
}

async function main() {
  try {
    const { sjyo, pickup, tests } = await loadFixtureBundle();
    note(
      "bundle.tests",
      true,
      tests.map((t) => `${t.test_code}:${t.paramCount}p${t.is_outsourced ? ":OS" : ""}`).join(", "),
    );

    // A. Lab visit — full partial pipeline
    {
      const name = `${MARKER} LAB`;
      const { regId } = await registerPatient({
        name,
        mobile: `${MOBILE_BASE}1001`,
        visitType: "lab_visit",
        tests,
        paid: null,
      });
      note("scenario.lab.register", true, regId);
      await runPartialClinicalPath("lab", { regId, tests });
    }

    // B. Channel SJYO
    {
      const name = `${MARKER} SJYO`;
      const subset = tests.slice(0, 10);
      const { regId } = await registerPatient({
        name,
        mobile: `${MOBILE_BASE}1002`,
        visitType: "lab_visit",
        channelId: sjyo.id,
        tests: subset,
        paid: null,
      });
      note("scenario.sjyo.register", true, regId);
      await runPartialClinicalPath("sjyo", { regId, tests: subset });
    }

    // C. Pickup point (credit → unpaid ok)
    {
      const name = `${MARKER} PICKUP`;
      const subset = tests.slice(0, 10);
      const isCredit = String(pickup.billing_type || "").toLowerCase() === "credit";
      const { regId } = await registerPatient({
        name,
        mobile: `${MOBILE_BASE}1003`,
        visitType: "pickup_point",
        pickupPointId: pickup.id,
        tests: subset,
        paid: isCredit ? 0 : null,
        due: isCredit ? subset.reduce((s, t) => s + Number(t.price || 0), 0) : undefined,
      });
      note("scenario.pickup.register", true, `${regId} billing=${pickup.billing_type}`);
      await runPartialClinicalPath("pickup", { regId, tests: subset });
    }

    // D. Home visit
    {
      const name = `${MARKER} HV`;
      const subset = tests.slice(0, 10);
      const price = subset.reduce((s, t) => s + Number(t.price || 0), 0);
      const estimateId = uuid();
      await api("POST", "/rest/v1/estimates", {
        id: estimateId,
        patient_name: name,
        whatsapp_number: `${MOBILE_BASE}1004`,
        status: "Estimate Created",
        total_amount: price,
        final_amount: price + 150,
        discount_amount: 0,
        home_visit_charges: 150,
      });
      report.created.estimateIds.push(estimateId);
      for (const t of subset) {
        await api("POST", "/rest/v1/estimate_tests", {
          estimate_id: estimateId,
          test_id: t.id,
          test_name: t.test_name,
          price: Number(t.price || 0),
          discounted_price: Number(t.price || 0),
          fasting_required: false,
        });
      }
      const visitId = uuid();
      await api("POST", "/rest/v1/home_visits", {
        id: visitId,
        estimate_id: estimateId,
        visit_date: new Date().toISOString().slice(0, 10),
        visit_time: "09:30",
        address: "PARTIALAUDIT HV ADDR",
        status: "Completed",
      });
      report.created.visitIds.push(visitId);
      await api("PATCH", `/rest/v1/estimates?id=eq.${estimateId}`, { status: "Home Visit Booked" });

      const { regId } = await registerPatient({
        name,
        mobile: `${MOBILE_BASE}1004`,
        visitType: "home_visit",
        homeVisitId: visitId,
        tests: subset,
        hvCharges: 150,
        paid: null,
      });
      note("scenario.hv.register", true, regId);
      await runPartialClinicalPath("home_visit", { regId, tests: subset });
    }

    // E. Shared-tube scoped repeat + merge + full dispatch
    await runSharedTubeRepeatDispatchAudit(tests);

    // F. Billing + cash
    await runBillingAndCash(tests, sjyo);

    // Final leftover check before cleanup
    const stuckSql = psql(`
      SELECT COUNT(*) FROM patient_registrations
      WHERE patient_name LIKE 'PARTIALAUDIT %'
        AND COALESCE(bill_cancelled,false)=false
        AND status NOT IN ('dispatched','cancelled','approved','verified','processed','sample_accepted','partially_dispatched');
    `);
    note("final.open_statuses", true, `non-terminal regs before cleanup=${stuckSql}`);
  } catch (e) {
    note("fatal", false, e.message);
    flaw("P0", "audit", `Fatal: ${e.message}`, "Investigate failing step in report.steps");
  } finally {
    await cleanup();
    report.finishedAt = new Date().toISOString();
    report.summary = {
      steps_ok: report.steps.filter((s) => s.ok).length,
      steps_fail: report.steps.filter((s) => !s.ok).length,
      flaws: report.flaws.length,
      by_severity: report.flaws.reduce((a, f) => {
        a[f.severity] = (a[f.severity] || 0) + 1;
        return a;
      }, {}),
      cleaned: report.cleaned,
    };
    fs.mkdirSync("data-export", { recursive: true });
    fs.writeFileSync("data-export/partial-pipeline-audit-report.json", JSON.stringify(report, null, 2));
    console.log("\n=== SUMMARY ===");
    console.log(JSON.stringify(report.summary, null, 2));
    if (report.flaws.length) {
      console.log("\n=== FLAWS ===");
      for (const f of report.flaws) {
        console.log(`- [${f.severity}] ${f.area}: ${f.detail}`);
      }
    }
    console.log("Full report → data-export/partial-pipeline-audit-report.json");
  }
}

main();
