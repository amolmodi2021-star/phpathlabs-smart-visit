/**
 * Pipeline audit (PHPL cloud) — NO WhatsApp.
 *
 * One patient, many tests, leave work pending at every stage, then assert the
 * same registration is visible in Collection / Acceptance / Results /
 * Verification / Approval / (Dispatch if approved). Always cleans up.
 *
 *   node scripts/cloud-pipeline-audit.mjs
 * Report → data-export/cloud-pipeline-audit-report.json
 */
import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

function loadDotEnv() {
  const env = {};
  const p = path.join(root, ".env");
  if (!fs.existsSync(p)) return env;
  for (const line of fs.readFileSync(p, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)\s*=\s*"(.*)"\s*$/) || line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) env[m[1]] = m[2].trim();
  }
  return env;
}

function loadSecrets() {
  const out = {};
  const p = path.join(root, "supabase", ".env.cloud-phpl-secrets");
  if (!fs.existsSync(p)) return out;
  for (const line of fs.readFileSync(p, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

const fileEnv = loadDotEnv();
const secrets = loadSecrets();
const API = (process.env.AUDIT_SUPABASE_URL || fileEnv.VITE_SUPABASE_URL || "").replace(/\/$/, "");
const SVC = process.env.AUDIT_SERVICE_ROLE_KEY || fileEnv.SUPABASE_SERVICE_ROLE_KEY || secrets.SUPABASE_SERVICE_ROLE_KEY || "";
const ANON =
  process.env.AUDIT_ANON_KEY ||
  fileEnv.VITE_SUPABASE_PUBLISHABLE_KEY ||
  fileEnv.SUPABASE_PUBLISHABLE_KEY ||
  "";

if (!API || !SVC || !ANON) {
  console.error("Need URL + service_role + anon key in .env / secrets");
  process.exit(1);
}
if (/127\.0\.0\.1|localhost/.test(API)) {
  console.error("Refusing pipeline audit against local URL:", API);
  process.exit(1);
}

const MARKER = `PIPELINEAUDIT ${Date.now()}`;
const MOBILE = "9999911001"; // audit-only; never WA

const report = {
  startedAt: new Date().toISOString(),
  target: API,
  marker: MARKER,
  whatsapp: "disabled_by_policy",
  steps: [],
  flaws: [],
  plan: {},
  tabAudit: {},
  created: {
    registrationIds: [],
    tubeIds: [],
    resultIds: [],
    umrNumbers: [],
    invoiceNumbers: [],
  },
  cleaned: false,
};

function note(step, ok, detail) {
  report.steps.push({ step, ok, detail, at: new Date().toISOString() });
  console.log(`${ok ? "OK  " : "FAIL"} ${step}${detail ? " — " + detail : ""}`);
}
function flaw(severity, area, detail) {
  report.flaws.push({ severity, area, detail });
  console.log(`FLAW[${severity}] [${area}] ${detail}`);
}
function uuid() {
  return crypto.randomUUID();
}

async function api(method, pathName, body, key = SVC, extraHeaders = {}) {
  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    Prefer: "return=representation",
    ...extraHeaders,
  };
  if (body !== undefined && body !== null && method !== "GET" && method !== "DELETE" && method !== "HEAD") {
    headers["Content-Type"] = "application/json";
  }
  if (method === "DELETE") headers.Prefer = extraHeaders.Prefer || "return=minimal";
  const res = await fetch(`${API}${pathName}`, {
    method,
    headers,
    body:
      body !== undefined && body !== null && method !== "GET" && method !== "DELETE" && method !== "HEAD"
        ? JSON.stringify(body)
        : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const err = new Error(`${method} ${pathName} → ${res.status}: ${String(text).slice(0, 600)}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

async function rpc(fn, args = {}, key = SVC) {
  return api("POST", `/rest/v1/rpc/${fn}`, args, key);
}

async function del(table, filter) {
  await api("DELETE", `/rest/v1/${table}?${filter}`, null, SVC, { Prefer: "return=minimal" });
}

async function cleanup() {
  try {
    const regs = await api(
      "GET",
      "/rest/v1/patient_registrations?patient_name=like.PIPELINEAUDIT*&select=id,invoice_number,umr_number",
      null,
      SVC,
    );
    for (const r of regs || []) {
      const inv = r.invoice_number;
      await del("lims_result_notify", `registration_id=eq.${r.id}`);
      await del("report_share_links", `registration_id=eq.${r.id}`);
      await del("approved_reports", `registration_id=eq.${r.id}`);
      await del("patient_results", `registration_id=eq.${r.id}`);
      await del("outsourced_test_snips", `registration_id=eq.${r.id}`);
      if (inv) {
        await del("lims_test_orders", `sample_id=eq.${encodeURIComponent(inv)}`);
        // suffix sample ids (invoice + suffix)
        const orders = await api(
          "GET",
          `/rest/v1/lims_test_orders?sample_id=like.${encodeURIComponent(inv)}*&select=id`,
          null,
          SVC,
        );
        for (const o of orders || []) await del("lims_test_orders", `id=eq.${o.id}`);
      }
      await del("sample_tubes", `registration_id=eq.${r.id}`);
      await del("payment_transactions", `registration_id=eq.${r.id}`);
      await del("patient_registrations", `id=eq.${r.id}`);
      if (r.umr_number) await del("patient_master", `umr_id=eq.${encodeURIComponent(r.umr_number)}`);
    }
    await del("patient_master", `patient_name=like.PIPELINEAUDIT*`);
    await del("payment_transactions", `patient_name=like.PIPELINEAUDIT*`);

    const left = await api(
      "GET",
      "/rest/v1/patient_registrations?patient_name=like.PIPELINEAUDIT*&select=id",
      null,
      SVC,
    );
    report.cleaned = !left?.length;
    note("cleanup", report.cleaned, `leftover_regs=${left?.length || 0}`);
    if (!report.cleaned) flaw("P0", "cleanup", `Leftover registrations: ${(left || []).map((x) => x.id).join(",")}`);
  } catch (e) {
    note("cleanup", false, e.message);
    flaw("P0", "cleanup", e.message);
  }
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
  // Distinct suffixes if only one group (force multi-tube for partial stages)
  const arr = Array.from(groups.values());
  if (arr.length === 1 && (arr[0].test_ids || []).length >= 4) {
    const g = arr[0];
    const chunks = [];
    const ids = g.test_ids;
    const names = g.test_names;
    const size = Math.max(1, Math.ceil(ids.length / 4));
    for (let i = 0, n = 0; i < ids.length; i += size, n++) {
      chunks.push({
        tube_type: g.tube_type,
        tube_color: g.tube_color,
        sample_type: g.sample_type,
        suffix: n === 0 ? "" : String.fromCharCode(65 + n - 1), // A,B,C…
        test_ids: ids.slice(i, i + size),
        test_names: names.slice(i, i + size),
        status: "pending",
      });
    }
    return chunks;
  }
  return arr;
}

/** Mirror of src/lib/limsStatus.ts recalculateRegistrationStatus via REST. */
async function recalcStatus(regId) {
  const [tubes, results, snips, regs] = await Promise.all([
    api("GET", `/rest/v1/sample_tubes?registration_id=eq.${regId}&select=status,test_ids`, null, SVC),
    api("GET", `/rest/v1/patient_results?registration_id=eq.${regId}&select=status,result_value,test_id`, null, SVC),
    api(
      "GET",
      `/rest/v1/outsourced_test_snips?registration_id=eq.${regId}&select=outsource_status,test_id`,
      null,
      SVC,
    ),
    api(
      "GET",
      `/rest/v1/patient_registrations?id=eq.${regId}&select=cancelled_tests,status,repeat_tests`,
      null,
      SVC,
    ),
  ]);
  const t = tubes || [];
  const r = results || [];
  const s = snips || [];
  const reg = regs?.[0] || {};
  const currentStatus = String(reg.status || "");
  const cancelledTestIds = new Set(
    (Array.isArray(reg.cancelled_tests) ? reg.cancelled_tests : [])
      .map((x) => (typeof x === "string" ? x : x?.test_id || x?.id))
      .filter(Boolean),
  );
  const repeatTestsRaw = Array.isArray(reg.repeat_tests) ? reg.repeat_tests : [];
  const pendingRepeatTests = repeatTestsRaw.filter((rt) => {
    const tid = rt?.test_id;
    if (!tid || cancelledTestIds.has(tid)) return false;
    return t.some((tube) => tube.status === "pending" && Array.isArray(tube.test_ids) && tube.test_ids.includes(tid));
  });
  const repeatTestsChanged = pendingRepeatTests.length !== repeatTestsRaw.length;

  if (t.length === 0) {
    await api("PATCH", `/rest/v1/patient_registrations?id=eq.${regId}`, { status: "registered" }, SVC);
    return "registered";
  }

  const trackedTestIds = new Set();
  r.forEach((x) => {
    if (!x.test_id || cancelledTestIds.has(x.test_id)) return;
    if (["entered", "results_entered", "verified", "approved", "dispatched"].includes(x.status)) {
      trackedTestIds.add(x.test_id);
    }
  });
  s.forEach((x) => {
    if (!x.test_id || cancelledTestIds.has(x.test_id)) return;
    if (["results_entered", "entered", "verified", "approved", "dispatched"].includes(x.outsource_status)) {
      trackedTestIds.add(x.test_id);
    }
  });

  const acceptedTubeTestIds = new Set();
  t.forEach((tube) => {
    if (tube.status === "accepted") {
      (Array.isArray(tube.test_ids) ? tube.test_ids : []).forEach((id) => {
        if (id && !cancelledTestIds.has(id)) acceptedTubeTestIds.add(id);
      });
    }
  });
  let hasUntrackedAcceptedTest = false;
  acceptedTubeTestIds.forEach((id) => {
    if (!trackedTestIds.has(id)) hasUntrackedAcceptedTest = true;
  });

  const tubeTestIds = new Set();
  t.forEach((tube) => {
    (Array.isArray(tube.test_ids) ? tube.test_ids : []).forEach((id) => {
      if (id && !cancelledTestIds.has(id)) tubeTestIds.add(id);
    });
  });
  const downstream = [
    ...r
      .filter((x) => x.test_id && tubeTestIds.has(x.test_id) && !cancelledTestIds.has(x.test_id))
      .map((x) => x.status),
    ...s
      .filter((x) => x.test_id && !cancelledTestIds.has(x.test_id))
      .map((x) => x.outsource_status)
      .filter((st) => ["entered", "results_entered", "verified", "approved", "dispatched"].includes(st)),
  ];

  const hasPendingTube = t.some((tube) => tube.status === "pending" || tube.status === "deferred");
  const hasCollectedTube = t.some((tube) => tube.status === "collected");
  const hasActiveRepeat = pendingRepeatTests.length > 0;
  if (hasActiveRepeat) {
    const patch = { status: "repeat_collection" };
    if (repeatTestsChanged) patch.repeat_tests = pendingRepeatTests;
    await api("PATCH", `/rest/v1/patient_registrations?id=eq.${regId}`, patch, SVC);
    return "repeat_collection";
  }

  let newStatus = "registered";
  if (downstream.length > 0 && downstream.every((st) => st === "dispatched")) newStatus = "dispatched";
  else if (downstream.some((st) => st === "dispatched")) newStatus = "partially_dispatched";
  else if (downstream.length > 0 && downstream.every((st) => st === "approved")) newStatus = "approved";
  else if (downstream.some((st) => st === "approved")) newStatus = "partially_approved";
  else if (downstream.length > 0 && downstream.every((st) => st === "verified")) newStatus = "verified";
  else if (downstream.some((st) => st === "verified")) newStatus = "partial_verified";
  else if (downstream.length > 0 && downstream.every((st) => ["entered", "results_entered"].includes(st)))
    newStatus = "processed";
  else if (downstream.some((st) => ["entered", "results_entered"].includes(st))) newStatus = "partial_processing";
  else if (
    r.some(
      (x) =>
        x.test_id &&
        tubeTestIds.has(x.test_id) &&
        !cancelledTestIds.has(x.test_id) &&
        x.result_value &&
        String(x.result_value).trim() !== "",
    )
  ) {
    newStatus = "processing";
  } else {
    const tubeStatuses = t.map((x) => x.status);
    if (tubeStatuses.every((st) => st === "accepted")) newStatus = "sample_accepted";
    else if (tubeStatuses.some((st) => st === "accepted")) newStatus = "partially_accepted";
    else if (tubeStatuses.every((st) => st === "collected" || st === "accepted")) newStatus = "sample_collected";
    else if (tubeStatuses.some((st) => st === "collected")) newStatus = "partially_collected";
    else if (tubeStatuses.some((st) => st === "deferred")) newStatus = "partially_collected";
    else newStatus = "registered";
  }

  if (hasUntrackedAcceptedTest) {
    if (newStatus === "dispatched") newStatus = "partially_dispatched";
    else if (newStatus === "approved") newStatus = "partially_approved";
    else if (newStatus === "verified") newStatus = "partial_verified";
    else if (newStatus === "processed") newStatus = "partial_processing";
  }
  if (hasPendingTube) {
    if (newStatus === "dispatched") newStatus = "partially_dispatched";
    else if (newStatus === "approved") newStatus = "partially_approved";
    else if (newStatus === "verified") newStatus = "partial_verified";
    else if (newStatus === "processed") newStatus = "partial_processing";
    else if (newStatus === "sample_accepted") newStatus = "partially_accepted";
    else if (newStatus === "sample_collected") newStatus = "partially_collected";
    else if (newStatus === "registered" && hasCollectedTube) newStatus = "partially_collected";
  }
  if (hasCollectedTube) {
    if (newStatus === "dispatched") newStatus = "partially_dispatched";
    else if (newStatus === "approved") newStatus = "partially_approved";
    else if (newStatus === "verified") newStatus = "partial_verified";
    else if (newStatus === "processed") newStatus = "partial_processing";
    else if (newStatus === "sample_accepted") newStatus = "partially_accepted";
  }

  const patch = { status: newStatus };
  if (repeatTestsChanged || (currentStatus === "repeat_collection" && !hasActiveRepeat)) {
    patch.repeat_tests = pendingRepeatTests;
  }
  await api("PATCH", `/rest/v1/patient_registrations?id=eq.${regId}`, patch, SVC);
  return newStatus;
}

async function getTubes(regId) {
  return (
    (await api(
      "GET",
      `/rest/v1/sample_tubes?registration_id=eq.${regId}&select=*&order=created_at.asc`,
      null,
      SVC,
    )) || []
  );
}

async function getResults(regId) {
  return (
    (await api("GET", `/rest/v1/patient_results?registration_id=eq.${regId}&select=*`, null, SVC)) || []
  );
}

async function getReg(regId) {
  const rows = await api(
    "GET",
    `/rest/v1/patient_registrations?id=eq.${regId}&select=*`,
    null,
    SVC,
  );
  return rows?.[0] || null;
}

async function loadParamsForTest(testId) {
  const junc = await api(
    "GET",
    `/rest/v1/test_parameters?test_id=eq.${testId}&parameter_id=not.is.null&is_subheader=eq.false&select=parameter_id,report_test_parameters(id,param_code,parameter_name,unit)`,
    null,
    ANON,
  );
  return (junc || [])
    .map((j) => j.report_test_parameters)
    .filter(Boolean)
    .map((p) => ({
      id: p.id,
      param_code: p.param_code,
      parameter_name: p.parameter_name,
      unit: p.unit || "",
    }));
}

async function enterResultsForTests(regId, tests, status = "entered") {
  const now = new Date().toISOString();
  const rows = [];
  for (const t of tests) {
    const params = t.params?.length ? t.params : await loadParamsForTest(t.id);
    t.params = params;
    for (const p of params.slice(0, 8)) {
      rows.push({
        registration_id: regId,
        test_id: t.id,
        parameter_id: p.id,
        param_code: p.param_code,
        parameter_name: p.parameter_name,
        result_value: "11.2",
        unit: p.unit || "",
        status,
        entered_at: now,
        entered_by: "PIPELINE_AUDIT",
      });
    }
  }
  if (!rows.length) throw new Error("No parameter rows to enter");
  // Upsert-ish: delete pending/empty then insert
  for (const t of tests) {
    await del("patient_results", `registration_id=eq.${regId}&test_id=eq.${t.id}`);
  }
  const inserted = await api("POST", "/rest/v1/patient_results", rows, SVC);
  report.created.resultIds.push(...(inserted || []).map((r) => r.id));
  return inserted || [];
}

async function setResultStatus(regId, testIds, fromStatuses, toStatus) {
  const now = new Date().toISOString();
  const patch = { status: toStatus };
  if (toStatus === "verified") {
    patch.verified_at = now;
    patch.verified_by = "PIPELINE_AUDIT";
  }
  if (toStatus === "approved") {
    patch.approved_at = now;
    patch.approved_by = "PIPELINE_AUDIT";
  }
  for (const tid of testIds) {
    let filter = `registration_id=eq.${regId}&test_id=eq.${tid}`;
    if (fromStatuses?.length) filter += `&status=in.(${fromStatuses.join(",")})`;
    await api("PATCH", `/rest/v1/patient_results?${filter}`, patch, SVC);
  }
}

function assert(cond, severity, area, detail) {
  note(`assert.${area}`, !!cond, detail);
  if (!cond) flaw(severity, area, detail);
  return !!cond;
}

async function main() {
  note("target", true, API);
  note("policy.whatsapp", true, "sends disabled");

  try {
    // ---- Pick ≥8 in-house tests with params across as many tubes as possible ----
    const testsRaw =
      (await api(
        "GET",
        "/rest/v1/tests?select=id,test_name,test_code,price,is_outsourced,sample_tube,tube_color,sample_type&is_active=eq.true&is_outsourced=eq.false&order=test_name.asc&limit=200",
        null,
        ANON,
      )) || [];

    const enriched = [];
    for (const t of testsRaw) {
      if (enriched.length >= 12) break;
      const params = await loadParamsForTest(t.id);
      if (params.length === 0) continue;
      enriched.push({ ...t, params, paramCount: params.length });
    }
    if (enriched.length < 8) throw new Error(`Need ≥8 in-house tests with params, got ${enriched.length}`);

    // Prefer distinct sample_tube values
    const byTube = new Map();
    for (const t of enriched) {
      const k = `${t.sample_tube || "DEFAULT"}||${t.tube_color || ""}`;
      if (!byTube.has(k)) byTube.set(k, []);
      byTube.get(k).push(t);
    }
    const picked = [];
    for (const list of byTube.values()) {
      if (picked.length >= 12) break;
      picked.push(list[0]);
    }
    for (const t of enriched) {
      if (picked.length >= 12) break;
      if (!picked.find((x) => x.id === t.id)) picked.push(t);
    }

    const tubesPlan = buildTubesFromTests(picked);
    if (tubesPlan.length < 4) {
      // Force split already handled in buildTubesFromTests; still require ≥4
      throw new Error(`Need ≥4 tubes for partial stages, got ${tubesPlan.length}`);
    }
    report.plan = {
      testCount: picked.length,
      tubeCount: tubesPlan.length,
      tests: picked.map((t) => ({ code: t.test_code, name: t.test_name, tube: t.sample_tube })),
      tubes: tubesPlan.map((g) => ({
        tube_type: g.tube_type,
        suffix: g.suffix,
        tests: g.test_names,
      })),
    };
    note("plan.tests", true, `${picked.length} tests on ${tubesPlan.length} tubes`);

    // ---- Register (lab visit) ----
    const gross = picked.reduce((s, t) => s + Number(t.price || 0), 0);
    const atomic = await rpc(
      "register_patient_atomic",
      {
        p_registration: {
          title: "MR",
          patient_name: MARKER,
          gender: "Male",
          dob: "1990-01-15",
          mobile_number: MOBILE,
          doctor_name: "SELF",
          address: "PIPELINE AUDIT ADDR",
          visit_type: "lab",
          tests: picked.map((t) => ({
            test_id: t.id,
            test_name: t.test_name,
            price: Number(t.price || 0),
            discounted_price: Number(t.price || 0),
            item_type: "test",
          })),
          gross_amount: gross,
          discount_amount: 0,
          home_visit_charges: 0,
          net_amount: gross,
          final_amount: gross,
          paid_amount: gross,
          due_amount: 0,
          status: "registered",
          registered_by: "PIPELINE_AUDIT",
        },
        p_tubes: tubesPlan,
        p_payment: {
          patient_name: MARKER,
          transaction_type: "registration_payment",
          direction: "in",
          performed_by: "PIPELINE_AUDIT",
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
          remarks: "PIPELINEAUDIT — no WA",
        },
        p_home_visit_id: null,
        p_home_visit_patch: null,
      },
      ANON,
    );
    const regId = atomic?.id;
    if (!regId) throw new Error(`register_patient_atomic failed: ${JSON.stringify(atomic)}`);
    report.created.registrationIds.push(regId);
    if (atomic.umr_number) report.created.umrNumbers.push(atomic.umr_number);
    if (atomic.invoice_number) report.created.invoiceNumbers.push(atomic.invoice_number);
    note("register", true, `invoice=${atomic.invoice_number} umr=${atomic.umr_number} id=${regId}`);

    let tubes = await getTubes(regId);
    report.created.tubeIds.push(...tubes.map((t) => t.id));
    note("tubes.created", tubes.length >= 4, `${tubes.length} tubes`);
    if (tubes.length < 4) throw new Error(`Expected ≥4 tubes, got ${tubes.length}`);

    // Assign stage buckets by tube index
    // T0: stay pending (collection)
    // T1: collect only (acceptance)
    // T2+: collect+accept; among accepted tests:
    //   - some unentered (results)
    //   - some entered only (verification)
    //   - some verified only (approval)
    //   - some approved (dispatch)
    const pendingTube = tubes[0];
    const acceptanceTube = tubes[1];
    const acceptedTubes = tubes.slice(2);

    const now = new Date().toISOString();

    // ---- Partial collect ----
    for (const tube of [acceptanceTube, ...acceptedTubes]) {
      await api(
        "PATCH",
        `/rest/v1/sample_tubes?id=eq.${tube.id}&status=eq.pending`,
        { status: "collected", collected_at: now, collected_by: "PIPELINE_AUDIT" },
        SVC,
      );
    }
    let status = await recalcStatus(regId);
    note("stage.partial_collect", true, `left pending=${pendingTube.id.slice(0, 8)} status=${status}`);
    assert(
      ["partially_collected", "sample_collected", "partially_accepted"].includes(status) || status.includes("partial"),
      "P0",
      "status_after_partial_collect",
      `status=${status}`,
    );

    // ---- Partial accept ----
    for (const tube of acceptedTubes) {
      await api(
        "PATCH",
        `/rest/v1/sample_tubes?id=eq.${tube.id}&status=eq.collected`,
        { status: "accepted", accepted_at: now, accepted_by: "PIPELINE_AUDIT" },
        SVC,
      );
    }
    status = await recalcStatus(regId);
    note(
      "stage.partial_accept",
      true,
      `left collected=${acceptanceTube.id.slice(0, 8)} accepted=${acceptedTubes.length} status=${status}`,
    );

    tubes = await getTubes(regId);
    const acceptedNow = tubes.filter((t) => t.status === "accepted");
    const acceptedTestIds = [];
    for (const tube of acceptedNow) {
      for (const id of tube.test_ids || []) acceptedTestIds.push(id);
    }
    const acceptedTests = picked.filter((t) => acceptedTestIds.includes(t.id));
    if (acceptedTests.length < 4) throw new Error(`Need ≥4 accepted tests for partial entry path, got ${acceptedTests.length}`);

    // Split accepted tests into 4 buckets
    const n = acceptedTests.length;
    const unentered = acceptedTests.slice(0, Math.max(1, Math.floor(n / 4)));
    const enterOnly = acceptedTests.slice(unentered.length, unentered.length + Math.max(1, Math.floor(n / 4)));
    const verifyOnly = acceptedTests.slice(
      unentered.length + enterOnly.length,
      unentered.length + enterOnly.length + Math.max(1, Math.floor(n / 4)),
    );
    const approveSome = acceptedTests.slice(unentered.length + enterOnly.length + verifyOnly.length);
    if (approveSome.length === 0 && verifyOnly.length > 1) {
      approveSome.push(verifyOnly.pop());
    }
    if (approveSome.length === 0 && enterOnly.length > 1) {
      approveSome.push(enterOnly.pop());
    }

    report.plan.buckets = {
      collection_pending_tube: {
        id: pendingTube.id,
        tests: pendingTube.test_names || pendingTube.test_ids,
      },
      acceptance_collected_tube: {
        id: acceptanceTube.id,
        tests: acceptanceTube.test_names || acceptanceTube.test_ids,
      },
      results_unentered: unentered.map((t) => t.test_code || t.test_name),
      verification_entered: enterOnly.map((t) => t.test_code || t.test_name),
      approval_verified: verifyOnly.map((t) => t.test_code || t.test_name),
      dispatch_approved: approveSome.map((t) => t.test_code || t.test_name),
    };
    note(
      "plan.buckets",
      true,
      `unentered=${unentered.length} entered=${enterOnly.length} verified=${verifyOnly.length} approved=${approveSome.length}`,
    );

    // ---- Partial results (enter enterOnly + verifyOnly + approveSome; leave unentered) ----
    const toEnter = [...enterOnly, ...verifyOnly, ...approveSome];
    await enterResultsForTests(regId, toEnter, "entered");
    status = await recalcStatus(regId);
    note("stage.partial_results", true, `entered=${toEnter.length} left_unentered=${unentered.length} status=${status}`);

    // ---- Partial verify (verify verifyOnly + approveSome; leave enterOnly as entered) ----
    await setResultStatus(
      regId,
      [...verifyOnly, ...approveSome].map((t) => t.id),
      ["entered", "results_entered"],
      "verified",
    );
    status = await recalcStatus(regId);
    note("stage.partial_verify", true, `verified=${verifyOnly.length + approveSome.length} left_entered=${enterOnly.length} status=${status}`);

    // ---- Partial approve (approve approveSome only) ----
    if (approveSome.length) {
      await setResultStatus(regId, approveSome.map((t) => t.id), ["verified"], "approved");
      // approved_reports row (optional for queue — dispatch uses patient_results status)
      await api(
        "POST",
        "/rest/v1/approved_reports",
        {
          registration_id: regId,
          test_results: approveSome.map((t) => ({ test_id: t.id, test_name: t.test_name })),
          approved_by: "PIPELINE_AUDIT",
          is_held: false,
        },
        SVC,
      );
    }
    status = await recalcStatus(regId);
    note("stage.partial_approve", true, `approved=${approveSome.length} left_verified=${verifyOnly.length} status=${status}`);

    const finalReg = await getReg(regId);
    report.tabAudit.registration_status = finalReg?.status;
    report.tabAudit.invoice = finalReg?.invoice_number;

    // ========== TAB / QUEUE AUDIT (frozen multi-pending state) ==========
    tubes = await getTubes(regId);
    const results = await getResults(regId);

    const pendingTubes = tubes.filter((t) => t.status === "pending" || t.status === "deferred");
    const collectedTubes = tubes.filter((t) => t.status === "collected");
    const acceptedTubesFinal = tubes.filter((t) => t.status === "accepted");

    const enteredTestIds = new Set(
      results.filter((r) => r.status === "entered").map((r) => r.test_id),
    );
    const verifiedTestIds = new Set(
      results.filter((r) => r.status === "verified").map((r) => r.test_id),
    );
    const approvedTestIds = new Set(
      results.filter((r) => r.status === "approved").map((r) => r.test_id),
    );

    const entryCandidates = (await rpc("lims_results_entry_candidate_ids", {}, SVC)) || [];
    const verifyCandidates = (await rpc("lims_verification_candidate_ids", {}, SVC)) || [];
    const approveCandidates = (await rpc("lims_doctor_approval_candidate_ids", {}, SVC)) || [];
    const dispatchCandidates = (await rpc("lims_dispatch_candidate_ids", {}, SVC)) || [];

    const inArr = (arr, id) => (arr || []).map(String).includes(String(id));

    // Sample Collection
    const collectionOk = pendingTubes.length >= 1;
    report.tabAudit.sample_collection = {
      visible: collectionOk,
      pending_tubes: pendingTubes.map((t) => ({
        id: t.id,
        tests: t.test_names || t.test_ids,
      })),
    };
    assert(collectionOk, "P0", "tab.sample_collection", `pending_tubes=${pendingTubes.length}`);

    // Sample Acceptance
    const acceptanceOk = collectedTubes.length >= 1;
    report.tabAudit.sample_acceptance = {
      visible: acceptanceOk,
      collected_tubes: collectedTubes.map((t) => ({
        id: t.id,
        tests: t.test_names || t.test_ids,
      })),
    };
    assert(acceptanceOk, "P0", "tab.sample_acceptance", `collected_tubes=${collectedTubes.length}`);

    // Results Entry
    const unenteredPresent = unentered.every((t) => {
      const onAccepted = acceptedTubesFinal.some((tube) => (tube.test_ids || []).includes(t.id));
      const tracked = results.some(
        (r) =>
          r.test_id === t.id &&
          ["entered", "results_entered", "verified", "approved", "dispatched"].includes(r.status),
      );
      return onAccepted && !tracked;
    });
    const resultsQueueOk = inArr(entryCandidates, regId) && unenteredPresent;
    report.tabAudit.results_entry = {
      in_candidate_rpc: inArr(entryCandidates, regId),
      unentered_tests: unentered.map((t) => t.test_code || t.test_name),
      ok: resultsQueueOk,
    };
    assert(resultsQueueOk, "P0", "tab.results_entry", `in_rpc=${inArr(entryCandidates, regId)} unentered_ok=${unenteredPresent}`);

    // Verification
    const enteredPresent = enterOnly.every((t) => enteredTestIds.has(t.id));
    const verifyQueueOk = inArr(verifyCandidates, regId) && enteredPresent;
    report.tabAudit.verification = {
      in_candidate_rpc: inArr(verifyCandidates, regId),
      entered_tests: enterOnly.map((t) => t.test_code || t.test_name),
      ok: verifyQueueOk,
    };
    assert(verifyQueueOk, "P0", "tab.verification", `in_rpc=${inArr(verifyCandidates, regId)} entered_ok=${enteredPresent}`);

    // Doctor Approval
    const verifiedPresent = verifyOnly.every((t) => verifiedTestIds.has(t.id));
    const approveQueueOk = inArr(approveCandidates, regId) && verifiedPresent;
    report.tabAudit.doctor_approval = {
      in_candidate_rpc: inArr(approveCandidates, regId),
      verified_tests: verifyOnly.map((t) => t.test_code || t.test_name),
      ok: approveQueueOk,
    };
    assert(approveQueueOk, "P0", "tab.doctor_approval", `in_rpc=${inArr(approveCandidates, regId)} verified_ok=${verifiedPresent}`);

    // Dispatch (if we approved some)
    if (approveSome.length) {
      const approvedPresent = approveSome.every((t) => approvedTestIds.has(t.id));
      const dispatchQueueOk = inArr(dispatchCandidates, regId) && approvedPresent;
      report.tabAudit.dispatch = {
        in_candidate_rpc: inArr(dispatchCandidates, regId),
        approved_tests: approveSome.map((t) => t.test_code || t.test_name),
        ok: dispatchQueueOk,
      };
      assert(dispatchQueueOk, "P0", "tab.dispatch", `in_rpc=${inArr(dispatchCandidates, regId)} approved_ok=${approvedPresent}`);
    } else {
      report.tabAudit.dispatch = { skipped: true, reason: "no approved tests in plan" };
      note("assert.tab.dispatch", true, "skipped — no approved bucket");
    }

    // Same patient must be simultaneously relevant to all early tabs
    const simultaneous =
      collectionOk && acceptanceOk && resultsQueueOk && verifyQueueOk && approveQueueOk;
    report.tabAudit.simultaneous_all_early_tabs = simultaneous;
    assert(simultaneous, "P0", "simultaneous_tabs", `status=${finalReg?.status}`);

    // Sanity: must NOT be marked repeat_collection for first-time partials
    assert(
      finalReg?.status !== "repeat_collection",
      "P0",
      "no_false_repeat",
      `status=${finalReg?.status}`,
    );

    note(
      "audit.summary",
      report.flaws.length === 0,
      `invoice=${finalReg?.invoice_number} status=${finalReg?.status} flaws=${report.flaws.length}`,
    );
  } catch (e) {
    note("audit.aborted", false, e.message);
    flaw("P0", "audit", `Aborted: ${e.message}`);
  } finally {
    await cleanup();
    report.finishedAt = new Date().toISOString();
    const outDir = path.join(root, "data-export");
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    const out = path.join(outDir, "cloud-pipeline-audit-report.json");
    fs.writeFileSync(out, JSON.stringify(report, null, 2));
    console.log("\n—— Pipeline audit complete ——");
    console.log(`Flaws: ${report.flaws.length} | Cleaned: ${report.cleaned}`);
    console.log(`Report → ${out}`);
    if (report.flaws.length) {
      for (const f of report.flaws) console.log(`  [${f.severity}] ${f.area}: ${f.detail}`);
      process.exitCode = 1;
    }
  }
}

main();
