/**
 * Full cloud LIMS feature audit for PHPL — NO WhatsApp sends.
 *
 * Covers: auth, masters (anon staff-UI path), concurrency, estimate→HV→register,
 * sample collect/accept, results→verify→approve→dispatch, portal RPCs,
 * outsourced snip queue, due queue, LIMS candidate RPCs, edge function reachability,
 * desktop-api claim (no send), storage buckets.
 *
 * Env from .env (or AUDIT_* overrides):
 *   VITE_SUPABASE_URL / AUDIT_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY / AUDIT_SERVICE_ROLE_KEY
 *   VITE_SUPABASE_PUBLISHABLE_KEY / AUDIT_ANON_KEY
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
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)\s*=\s*"(.*)"\s*$/) || line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) env[m[1]] = m[2];
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
const SVC = process.env.AUDIT_SERVICE_ROLE_KEY || fileEnv.SUPABASE_SERVICE_ROLE_KEY || "";
const ANON =
  process.env.AUDIT_ANON_KEY ||
  fileEnv.VITE_SUPABASE_PUBLISHABLE_KEY ||
  fileEnv.SUPABASE_PUBLISHABLE_KEY ||
  "";
const DESKTOP_KEY = process.env.DESKTOP_API_KEY || secrets.DESKTOP_API_KEY || "";
const LIMS_INTERFACE_SECRET = process.env.LIMS_INTERFACE_SECRET || secrets.LIMS_INTERFACE_SECRET || "";

if (!API || !SVC || !ANON) {
  console.error("Need URL + service_role + anon key in .env (or AUDIT_* overrides)");
  process.exit(1);
}
if (/127\.0\.0\.1|localhost/.test(API)) {
  console.error("Refusing to run cloud audit against local URL:", API);
  process.exit(1);
}

const report = {
  startedAt: new Date().toISOString(),
  target: API,
  whatsapp: "disabled_by_policy",
  steps: [],
  issues: [],
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
    umrNumbers: [],
  },
  cleaned: false,
  workload: {},
  masters: {},
  edge: {},
};

function note(step, ok, detail) {
  report.steps.push({ step, ok, detail, at: new Date().toISOString() });
  console.log(`${ok ? "OK  " : "FAIL"} ${step}${detail ? " — " + detail : ""}`);
}
function issue(severity, area, detail) {
  report.issues.push({ severity, area, detail });
  console.log(`ISSUE[${severity}] [${area}] ${detail}`);
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
  const res = await fetch(`${API}${pathName}`, {
    method,
    headers,
    body: body !== undefined && body !== null && method !== "GET" && method !== "DELETE" ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const err = new Error(`${method} ${pathName} → ${res.status}: ${String(text).slice(0, 500)}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

async function rpc(fn, args = {}, key = SVC) {
  return api("POST", `/rest/v1/rpc/${fn}`, args, key);
}

async function countExact(table, filter = "", key = ANON) {
  const q = filter ? `?${filter}&select=id&limit=1` : `?select=id&limit=1`;
  const res = await fetch(`${API}/rest/v1/${table}${q}`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Prefer: "count=exact",
      Range: "0-0",
    },
  });
  const cr = res.headers.get("content-range") || "";
  const n = cr.includes("/") ? Number(cr.split("/")[1]) : NaN;
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${table} count → ${res.status}: ${text.slice(0, 200)}`);
  }
  return n;
}

async function cleanup() {
  const c = report.created;
  const del = async (table, filter) => {
    await api("DELETE", `/rest/v1/${table}?${filter}`, null, SVC, { Prefer: "return=minimal" });
  };
  try {
    for (const id of c.notifyIds || []) await del("lims_result_notify", `id=eq.${id}`);
    for (const id of c.shareIds || []) await del("report_share_links", `id=eq.${id}`);
    for (const id of c.reportIds || []) await del("approved_reports", `id=eq.${id}`);
    for (const id of c.resultIds || []) await del("patient_results", `id=eq.${id}`);
    for (const id of c.snipIds || []) await del("outsourced_test_snips", `id=eq.${id}`);
    for (const id of c.tubeIds || []) await del("sample_tubes", `id=eq.${id}`);
    for (const id of c.paymentIds || []) await del("payment_transactions", `id=eq.${id}`);
    for (const id of c.registrationIds || []) {
      await del("lims_result_notify", `registration_id=eq.${id}`);
      await del("report_share_links", `registration_id=eq.${id}`);
      await del("approved_reports", `registration_id=eq.${id}`);
      await del("patient_results", `registration_id=eq.${id}`);
      await del("outsourced_test_snips", `registration_id=eq.${id}`);
      await del("sample_tubes", `registration_id=eq.${id}`);
      await del("payment_transactions", `registration_id=eq.${id}`);
      await del("patient_registrations", `id=eq.${id}`);
    }
    for (const id of c.visitIds || []) await del("home_visits", `id=eq.${id}`);
    for (const id of c.estimateIds || []) {
      await del("estimate_tests", `estimate_id=eq.${id}`);
      await del("estimates", `id=eq.${id}`);
    }
    for (const umr of c.umrNumbers || []) {
      await del("patient_master", `umr_id=eq.${encodeURIComponent(umr)}`);
    }
    // Marker sweep (names from this audit)
    const leftovers = await api(
      "GET",
      "/rest/v1/patient_registrations?patient_name=like.CLOUDFULLAUDIT*&select=id",
      null,
      SVC,
    );
    for (const r of leftovers || []) {
      await del("patient_results", `registration_id=eq.${r.id}`);
      await del("outsourced_test_snips", `registration_id=eq.${r.id}`);
      await del("sample_tubes", `registration_id=eq.${r.id}`);
      await del("approved_reports", `registration_id=eq.${r.id}`);
      await del("report_share_links", `registration_id=eq.${r.id}`);
      await del("payment_transactions", `registration_id=eq.${r.id}`);
      await del("lims_result_notify", `registration_id=eq.${r.id}`);
      await del("patient_registrations", `id=eq.${r.id}`);
    }
    const estLeft = await api("GET", "/rest/v1/estimates?patient_name=like.CLOUDFULLAUDIT*&select=id", null, SVC);
    for (const e of estLeft || []) {
      await del("estimate_tests", `estimate_id=eq.${e.id}`);
      await del("home_visits", `estimate_id=eq.${e.id}`);
      await del("estimates", `id=eq.${e.id}`);
    }
    report.cleaned = true;
    note("cleanup", true, "audit rows removed");
  } catch (e) {
    note("cleanup", false, e.message);
    issue("high", "audit", `Cleanup failed: ${e.message}`);
  }
}

async function pickTestWithParams() {
  const tests = await api(
    "GET",
    "/rest/v1/tests?select=id,test_name,test_code,price,is_outsourced&is_active=eq.true&order=test_name.asc&limit=80",
    null,
    ANON,
  );
  for (const t of tests || []) {
    const junc = await api(
      "GET",
      `/rest/v1/test_parameters?test_id=eq.${t.id}&parameter_id=not.is.null&select=parameter_id,report_test_parameters(id,param_code,parameter_name,unit)&limit=5`,
      null,
      ANON,
    );
    if (junc?.length) {
      return { test: t, params: junc.map((j) => j.report_test_parameters).filter(Boolean) };
    }
  }
  throw new Error("No active test with linked parameters (anon path)");
}

async function edgeProbe(name, pathName, init) {
  try {
    const res = await fetch(`${API}${pathName}`, init);
    const text = await res.text();
    report.edge[name] = { status: res.status, ok: res.ok || res.status === 401 || res.status === 400 };
    note(`edge.${name}`, report.edge[name].ok, `HTTP ${res.status}`);
    if (!report.edge[name].ok) issue("medium", "edge", `${name}: ${text.slice(0, 160)}`);
    return { res, text };
  } catch (e) {
    report.edge[name] = { ok: false, error: e.message };
    note(`edge.${name}`, false, e.message);
    issue("high", "edge", `${name} unreachable: ${e.message}`);
    return null;
  }
}

async function main() {
  const marker = `CLOUDFULLAUDIT ${Date.now()}`;
  const mobile = "9999900001"; // audit-only; never send WA
  note("target", true, API);
  note("policy.whatsapp", true, "sends disabled");

  try {
    // ---- Auth ----
    {
      const res = await fetch(`${API}/functions/v1/user-auth`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ANON}`,
          apikey: ANON,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action: "login", username: "PHPATHLABS", password: "admin123" }),
      });
      const json = await res.json().catch(() => ({}));
      const token = json?.access_token || json?.token;
      const ok = res.ok && !!token;
      note("auth.login", ok, `HTTP ${res.status}`);
      if (!ok) issue("critical", "auth", `login failed: ${JSON.stringify(json).slice(0, 200)}`);
      report.staffToken = token ? "present" : null;

      // Staff UI path: anon Authorization + staff token header (matches live client)
      if (token) {
        const rows = await api(
          "GET",
          "/rest/v1/tests?select=id&limit=1",
          null,
          ANON,
          { "x-ph-access-token": token },
        );
        note("auth.staff_ui_rest", Array.isArray(rows), "anon+x-ph-access-token");
      }
    }

    // ---- Masters via ANON (live staff UI path) ----
    const masterSpecs = [
      ["tests", "is_active=eq.true"],
      ["health_checkups", ""],
      ["combos", ""],
      ["report_profiles", ""],
      ["report_test_parameters", ""],
      ["test_parameters", ""],
      ["parameter_normal_ranges", ""],
      ["profile_parameters", ""],
      ["report_departments", ""],
      ["master_lookup", ""],
      ["doctors", ""],
      ["phlebotomists", ""],
      ["message_templates", ""],
      ["marketing_templates", ""],
      ["channels", ""],
      ["pickup_points", ""],
      ["billing_profiles", ""],
      ["patient_registrations", ""],
      ["app_settings", ""],
      ["app_users", ""],
    ];
    for (const [table, filter] of masterSpecs) {
      try {
        const n = await countExact(table, filter, ANON);
        report.masters[table] = n;
        const ok = Number.isFinite(n) && n > 0;
        note(`masters.${table}`, ok, `anon_count=${n}`);
        if (!ok) issue("high", "masters", `${table} empty or invisible to anon (count=${n})`);
      } catch (e) {
        report.masters[table] = null;
        note(`masters.${table}`, false, e.message);
        issue("high", "masters", `${table}: ${e.message}`);
      }
    }

    // ---- Workload / queue RPCs ----
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
      "queues.sizes",
      true,
      `entry=${report.workload.results_entry} verify=${report.workload.verification} approve=${report.workload.doctor_approval} dispatch=${report.workload.dispatch} outsourced=${report.workload.outsourced}`,
    );

    // ---- Concurrent invoice / UMR ----
    const invs = await Promise.all([rpc("generate_invoice_number"), rpc("generate_invoice_number"), rpc("generate_invoice_number")]);
    const invStr = invs.map(String);
    const uniqInv = new Set(invStr).size === 3;
    note("invoice.concurrent", uniqInv, invStr.join(", "));
    if (!uniqInv) issue("critical", "billing", `duplicate invoices: ${invStr.join(",")}`);

    const umrs = await Promise.all([rpc("generate_umr_number"), rpc("generate_umr_number"), rpc("generate_umr_number")]);
    const umrStr = umrs.map(String);
    const uniqUmr = new Set(umrStr).size === 3;
    note("umr.concurrent", uniqUmr, umrStr.join(", "));
    if (!uniqUmr) issue("critical", "billing", `duplicate UMRs: ${umrStr.join(",")}`);

    // ---- Clinical path (anon writes like staff UI) ----
    const { test, params } = await pickTestWithParams();
    note("precheck.test_params", true, `${test.test_code || test.test_name} params=${params.length}`);
    const price = Number(test.price) || 100;
    const today = new Date().toISOString().slice(0, 10);

    const estimateId = uuid();
    await api(
      "POST",
      "/rest/v1/estimates",
      {
        id: estimateId,
        patient_name: marker,
        whatsapp_number: mobile,
        status: "Estimate Created",
        total_amount: price,
        final_amount: price,
        discount_amount: 0,
        home_visit_charges: 150,
      },
      ANON,
    );
    report.created.estimateIds.push(estimateId);
    await api(
      "POST",
      "/rest/v1/estimate_tests",
      {
        estimate_id: estimateId,
        test_id: test.id,
        test_name: test.test_name,
        price,
        fasting_required: false,
        discounted_price: price,
      },
      ANON,
    );
    note("flow.estimate", true, estimateId);

    const visitId = uuid();
    await api(
      "POST",
      "/rest/v1/home_visits",
      {
        id: visitId,
        estimate_id: estimateId,
        visit_date: today,
        visit_time: "10:00",
        address: "CLOUD AUDIT ADDRESS",
        status: "Completed",
      },
      ANON,
    );
    report.created.visitIds.push(visitId);
    await api(
      "PATCH",
      `/rest/v1/estimates?id=eq.${estimateId}`,
      { status: "Home Visit Booked", home_visit_charges: 150, final_amount: price + 150 },
      ANON,
    );
    note("flow.home_visit", true, visitId);

    const atomicReg = await rpc(
      "register_patient_atomic",
      {
        p_registration: {
          title: "MR",
          patient_name: marker,
          gender: "Male",
          mobile_number: mobile,
          doctor_name: "SELF",
          address: "CLOUD AUDIT ADDRESS",
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
          registered_by: "CLOUD_FULL_AUDIT",
        },
        p_tubes: [
          {
            tube_type: "EDTA",
            tube_color: "PURPLE",
            sample_type: "WHOLE BLOOD",
            suffix: "",
            test_ids: [test.id],
            test_names: [test.test_name],
            status: "pending",
          },
        ],
        p_payment: null,
        p_home_visit_id: visitId,
        p_home_visit_patch: { status: "Registered" },
      },
      ANON,
    );
    const regId = atomicReg?.id;
    if (!regId) throw new Error(`register_patient_atomic failed: ${JSON.stringify(atomicReg)}`);
    report.created.registrationIds.push(regId);
    if (atomicReg.umr_number) report.created.umrNumbers.push(atomicReg.umr_number);
    note("flow.register_atomic", true, `invoice=${atomicReg.invoice_number} umr=${atomicReg.umr_number}`);

    const tubes = await api("GET", `/rest/v1/sample_tubes?registration_id=eq.${regId}&select=*`, null, ANON);
    if (!tubes?.length) throw new Error("no tubes after register");
    report.created.tubeIds.push(...tubes.map((t) => t.id));
    note("flow.tubes", true, `${tubes.length}`);

    await api(
      "PATCH",
      `/rest/v1/sample_tubes?id=eq.${tubes[0].id}`,
      { status: "collected", collected_at: new Date().toISOString(), collected_by: "CLOUD_AUDIT" },
      ANON,
    );
    await api(
      "PATCH",
      `/rest/v1/sample_tubes?id=eq.${tubes[0].id}`,
      { status: "accepted", accepted_at: new Date().toISOString(), accepted_by: "CLOUD_AUDIT" },
      ANON,
    );
    note("flow.collect_accept", true, tubes[0].sample_uid || tubes[0].id);

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
      entered_by: "CLOUD_AUDIT",
    }));
    const inserted = await api("POST", "/rest/v1/patient_results", resultRows, ANON);
    report.created.resultIds.push(...(inserted || []).map((r) => r.id));
    note("flow.results_entered", (inserted?.length || 0) > 0, `${inserted?.length || 0}`);

    await api(
      "PATCH",
      `/rest/v1/patient_results?registration_id=eq.${regId}&status=eq.entered`,
      { status: "verified", verified_at: now, verified_by: "CLOUD_AUDIT" },
      ANON,
    );
    note("flow.verified", true);

    await api(
      "PATCH",
      `/rest/v1/patient_results?registration_id=eq.${regId}&status=eq.verified`,
      { status: "approved", approved_at: now, approved_by: "CLOUD_AUDIT" },
      ANON,
    );
    const apr = await api(
      "POST",
      "/rest/v1/approved_reports",
      {
        registration_id: regId,
        test_results: resultRows,
        approved_by: "CLOUD_AUDIT",
        is_held: false,
      },
      ANON,
    );
    const aprId = Array.isArray(apr) ? apr[0]?.id : apr?.id;
    if (aprId) report.created.reportIds.push(aprId);
    note("flow.approved", !!aprId, aprId);

    await api(
      "PATCH",
      `/rest/v1/patient_results?registration_id=eq.${regId}&status=eq.approved`,
      { status: "dispatched", dispatched_at: now, dispatched_by: "CLOUD_AUDIT" },
      ANON,
    );
    await api("PATCH", `/rest/v1/patient_registrations?id=eq.${regId}`, { status: "dispatched" }, ANON);
    const shareToken = crypto.randomBytes(16).toString("hex");
    const share = await api(
      "POST",
      "/rest/v1/report_share_links",
      {
        registration_id: regId,
        invoice_number: atomicReg.invoice_number,
        token: shareToken,
        expires_at: new Date(Date.now() + 7 * 864e5).toISOString(),
      },
      ANON,
    );
    const shareId = Array.isArray(share) ? share[0]?.id : share?.id;
    if (shareId) report.created.shareIds.push(shareId);
    note("flow.dispatch_share", !!shareId, shareToken.slice(0, 8));

    // Portal RPCs
    try {
      const lookup = await rpc("portal_lookup", { p_token: shareToken }, ANON);
      const bundle = await rpc("portal_bundle", { p_token: shareToken }, ANON);
      const lookupOk = lookup && lookup.expired !== true;
      note("portal.lookup", !!lookupOk, lookupOk ? "ok" : JSON.stringify(lookup)?.slice(0, 120));
      note("portal.bundle", !!bundle, bundle ? "ok" : "empty");
      if (!lookupOk) issue("high", "portal", "portal_lookup failed for fresh share token");
    } catch (e) {
      note("portal.lookup", false, e.message);
      issue("high", "portal", e.message);
    }

    // Due payment still true for unpaid first reg — register a paid second for payment path
    const dueRegs = await api(
      "GET",
      "/rest/v1/patient_registrations?due_amount=gt.0&is_bad_debt=eq.false&bill_cancelled=eq.false&select=id&limit=1",
      null,
      ANON,
    );
    note("billing.due_queue", true, `open_dues_sample=${dueRegs?.length || 0}`);

    // ---- Outsourced snip path ----
    const reg2 = await rpc(
      "register_patient_atomic",
      {
        p_registration: {
          title: "MR",
          patient_name: `${marker} OS`,
          gender: "Male",
          mobile_number: mobile,
          doctor_name: "SELF",
          visit_type: "lab_visit",
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
          registered_by: "CLOUD_FULL_AUDIT",
        },
        p_tubes: [
          {
            tube_type: "EDTA",
            tube_color: "PURPLE",
            sample_type: "WHOLE BLOOD",
            suffix: "",
            test_ids: [test.id],
            test_names: [test.test_name],
            status: "pending",
          },
        ],
        p_payment: {
          transaction_type: "registration_payment",
          direction: "in",
          performed_by: "CLOUD_FULL_AUDIT",
          cash_amount: price,
          total_amount: price,
          gross_amount: price,
          final_amount: price,
          paid_amount: price,
          due_amount: 0,
        },
      },
      ANON,
    );
    const regId2 = reg2?.id;
    if (!regId2) throw new Error(`OS register failed: ${JSON.stringify(reg2)}`);
    report.created.registrationIds.push(regId2);
    if (reg2.umr_number) report.created.umrNumbers.push(reg2.umr_number);
    note("flow.os_register", true, regId2);

    const tubes2 = await api("GET", `/rest/v1/sample_tubes?registration_id=eq.${regId2}&select=id`, null, ANON);
    report.created.tubeIds.push(...(tubes2 || []).map((t) => t.id));
    if (tubes2?.[0]) {
      await api(
        "PATCH",
        `/rest/v1/sample_tubes?id=eq.${tubes2[0].id}`,
        { status: "accepted", accepted_at: now, collected_at: now, collected_by: "CLOUD_AUDIT", accepted_by: "CLOUD_AUDIT" },
        ANON,
      );
    }
    const snip = await api(
      "POST",
      "/rest/v1/outsourced_test_snips",
      {
        registration_id: regId2,
        test_id: test.id,
        outsource_status: "sent",
        outsourced_lab_name: "CLOUD AUDIT LAB",
        result_mode: "manual",
        sent_at: now,
      },
      ANON,
    );
    const snipId = Array.isArray(snip) ? snip[0]?.id : snip?.id;
    if (snipId) report.created.snipIds.push(snipId);
    const osCandidates = await rpc("lims_outsourced_candidate_ids");
    const osHas = (osCandidates || []).includes(regId2);
    note("flow.outsourced_snip", !!snipId && osHas, `snip=${snipId} in_candidates=${osHas}`);
    if (!osHas) issue("medium", "outsourced", "sent snip registration not in lims_outsourced_candidate_ids");

    const notify = await api(
      "POST",
      "/rest/v1/lims_result_notify",
      { registration_id: regId2, source: "cloud_audit" },
      ANON,
    );
    const notifyId = Array.isArray(notify) ? notify[0]?.id : notify?.id;
    if (notifyId) report.created.notifyIds.push(notifyId);
    note("flow.notify_insert", !!notifyId, notifyId);

    // ---- Edge functions (no outbound WhatsApp) ----
    await edgeProbe("user_auth_bad_login", "/functions/v1/user-auth", {
      method: "POST",
      headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "login", username: "nope", password: "nope" }),
    });

    if (DESKTOP_KEY) {
      const desk = await edgeProbe("desktop_api_claim", "/functions/v1/desktop-api", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": DESKTOP_KEY,
          apikey: ANON,
          Authorization: `Bearer ${ANON}`,
        },
        body: JSON.stringify({ action: "claim_outbox", limit: 1, claimed_by: "cloud-full-audit" }),
      });
      // With a real key, only 2xx counts as success (401 means secret mismatch).
      if (desk && desk.res && desk.res.status !== 200) {
        report.edge.desktop_api_claim = { status: desk.res.status, ok: false };
        const last = report.steps[report.steps.length - 1];
        if (last?.step === "edge.desktop_api_claim") last.ok = false;
        issue("high", "edge", `desktop-api claim expected 200, got ${desk.res.status} (DESKTOP_API_KEY mismatch?)`);
      }
    } else {
      note("edge.desktop_api_claim", false, "DESKTOP_API_KEY missing");
      issue("medium", "edge", "DESKTOP_API_KEY not found in secrets file");
    }

    // lims-interface: expect auth rejection without correct secret, proves deploy
    await edgeProbe("lims_interface", "/functions/v1/lims-interface", {
      method: "POST",
      headers: {
        apikey: ANON,
        Authorization: `Bearer ${ANON}`,
        "Content-Type": "application/json",
        ...(LIMS_INTERFACE_SECRET ? { "x-lims-secret": "wrong" } : {}),
      },
      body: JSON.stringify({ ping: true }),
    });

    await edgeProbe("whatsapp_webhook_get", "/functions/v1/whatsapp-webhook", {
      method: "GET",
      headers: { apikey: ANON, Authorization: `Bearer ${ANON}` },
    });

    await edgeProbe("parse_prescription", "/functions/v1/parse-prescription", {
      method: "POST",
      headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    await edgeProbe("export_crm_contacts", "/functions/v1/export-crm-contacts", {
      method: "POST",
      headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    // Explicitly do NOT call send-marketing-message / whatsapp-proxy send paths
    note("edge.whatsapp_send_skipped", true, "send-marketing-message & whatsapp-proxy send not invoked");

    // ---- Storage buckets list ----
    try {
      const buckets = await fetch(`${API}/storage/v1/bucket`, {
        headers: { apikey: SVC, Authorization: `Bearer ${SVC}` },
      });
      const list = await buckets.json();
      const names = Array.isArray(list) ? list.map((b) => b.name || b.id) : [];
      note("storage.buckets", buckets.ok && names.length > 0, names.slice(0, 12).join(", ") || String(buckets.status));
      if (!buckets.ok) issue("medium", "storage", `bucket list failed: ${buckets.status}`);
    } catch (e) {
      note("storage.buckets", false, e.message);
      issue("medium", "storage", e.message);
    }
  } catch (e) {
    note("fatal", false, e.message);
    issue("critical", "audit", `Aborted: ${e.message}`);
  } finally {
    await cleanup();
    report.finishedAt = new Date().toISOString();
    const criticalHigh = report.issues.filter((i) => i.severity === "critical" || i.severity === "high");
    report.ok = criticalHigh.length === 0 && !report.steps.some((s) => s.step === "fatal" && !s.ok);
    report.summary = {
      steps_ok: report.steps.filter((s) => s.ok).length,
      steps_fail: report.steps.filter((s) => !s.ok).length,
      issues: report.issues.length,
      by_severity: {
        critical: report.issues.filter((i) => i.severity === "critical").length,
        high: report.issues.filter((i) => i.severity === "high").length,
        medium: report.issues.filter((i) => i.severity === "medium").length,
      },
      cleaned: report.cleaned,
      workload: report.workload,
      masters: report.masters,
      ok: report.ok,
    };
    const outDir = path.join(root, "data-export-local-fresh");
    fs.mkdirSync(outDir, { recursive: true });
    const out = path.join(outDir, "cloud-e2e-audit-report.json");
    fs.writeFileSync(out, JSON.stringify(report, null, 2));
    console.log("\n=== CLOUD FULL FEATURE AUDIT ===");
    console.log(JSON.stringify(report.summary, null, 2));
    console.log(report.ok ? "\nCLOUD FULL E2E PASSED" : "\nCLOUD FULL E2E HAS ISSUES");
    console.log("Report →", out);
    process.exit(report.ok ? 0 : 1);
  }
}

main();
