/**
 * Cloud E2E workflow audit for PHPL — NO WhatsApp sends.
 * Uses register_patient_atomic + REST; cleans up via REST (no docker/psql).
 *
 * Env:
 *   AUDIT_SUPABASE_URL
 *   AUDIT_SERVICE_ROLE_KEY
 * Optional: AUDIT_ANON_KEY (for user-auth login check)
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

const fileEnv = loadDotEnv();
const API = (process.env.AUDIT_SUPABASE_URL || fileEnv.VITE_SUPABASE_URL || "").replace(/\/$/, "");
const SVC = process.env.AUDIT_SERVICE_ROLE_KEY || fileEnv.SUPABASE_SERVICE_ROLE_KEY || "";
const ANON = process.env.AUDIT_ANON_KEY || fileEnv.VITE_SUPABASE_PUBLISHABLE_KEY || fileEnv.SUPABASE_PUBLISHABLE_KEY || "";

if (!API || !SVC) {
  console.error("Set AUDIT_SUPABASE_URL + AUDIT_SERVICE_ROLE_KEY (or cloud .env)");
  process.exit(1);
}
if (/127\.0\.0\.1|localhost/.test(API)) {
  console.error("Refusing to run cloud audit against local URL:", API);
  process.exit(1);
}

const report = {
  startedAt: new Date().toISOString(),
  target: API,
  steps: [],
  issues: [],
  created: {},
  cleaned: false,
  whatsapp: "disabled_by_policy",
};

function note(step, ok, detail) {
  report.steps.push({ step, ok, detail, at: new Date().toISOString() });
  console.log(`${ok ? "OK" : "FAIL"}  ${step}${detail ? " — " + detail : ""}`);
}
function issue(severity, detail) {
  report.issues.push({ severity, detail });
  console.log(`ISSUE[${severity}] ${detail}`);
}
function uuid() {
  return crypto.randomUUID();
}

async function api(method, pathName, body, key = SVC) {
  const res = await fetch(`${API}${pathName}`, {
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
    const err = new Error(`${method} ${pathName} → ${res.status}: ${text.slice(0, 500)}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

async function rpc(fn, args = {}) {
  return api("POST", `/rest/v1/rpc/${fn}`, args);
}

async function cleanup(created) {
  const id = created.registrationId;
  const del = async (table, filter) => {
    await api("DELETE", `/rest/v1/${table}?${filter}`, null);
  };
  try {
    if (created.shareLinkId) await del("report_share_links", `id=eq.${created.shareLinkId}`);
    if (id) {
      await del("report_share_links", `registration_id=eq.${id}`);
      await del("approved_reports", `registration_id=eq.${id}`);
      await del("patient_results", `registration_id=eq.${id}`);
      await del("outsourced_test_snips", `registration_id=eq.${id}`);
      const tubes = await api("GET", `/rest/v1/sample_tubes?registration_id=eq.${id}&select=sample_uid`);
      for (const t of tubes || []) {
        await del("lims_test_orders", `sample_id=eq.${encodeURIComponent(t.sample_uid)}`);
      }
      await del("sample_tubes", `registration_id=eq.${id}`);
      await del("payment_transactions", `registration_id=eq.${id}`);
      await del("patient_registrations", `id=eq.${id}`);
    }
    if (created.umrNumber) await del("patient_master", `umr_id=eq.${encodeURIComponent(created.umrNumber)}`);
    if (created.homeVisitId) await del("home_visits", `id=eq.${created.homeVisitId}`);
    if (created.estimateId) {
      await del("estimate_tests", `estimate_id=eq.${created.estimateId}`);
      await del("estimates", `id=eq.${created.estimateId}`);
    }
    report.cleaned = true;
  } catch (e) {
    report.cleanupError = e.message;
    throw e;
  }
}

async function main() {
  note("target", true, API);

  // Login check (no WhatsApp)
  if (ANON) {
    try {
      const res = await fetch(`${API}/functions/v1/user-auth`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ANON}`,
          apikey: ANON,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action: "login", username: "PHPATHLABS", password: "admin123" }),
      });
      const text = await res.text();
      let json = null;
      try {
        json = JSON.parse(text);
      } catch {
        /* ignore */
      }
      const ok = res.ok && (json?.access_token || json?.token || json?.ok);
      note("auth.login", !!ok, `HTTP ${res.status}`);
      if (!ok) issue("high", `user-auth login failed: ${text.slice(0, 200)}`);
    } catch (e) {
      note("auth.login", false, e.message);
      issue("high", `user-auth unreachable: ${e.message}`);
    }
  }

  // Masters present
  const tests = await api(
    "GET",
    "/rest/v1/tests?select=id,test_name,test_code,price&is_active=eq.true&order=test_name.asc&limit=50",
  );
  if (!tests?.length) throw new Error("No active tests on cloud — import may have failed");
  let test = tests[0];
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
  note("precheck.tests", true, `${tests.length}+ active; using ${test.test_code || test.test_name}`);

  const regsCount = await api("GET", "/rest/v1/patient_registrations?select=id&limit=1", null);
  note("precheck.patient_data", true, `patient_registrations reachable (${Array.isArray(regsCount) ? "ok" : "?"})`);

  // Concurrent invoice uniqueness
  const [a, b, c] = await Promise.all([
    rpc("generate_invoice_number"),
    rpc("generate_invoice_number"),
    rpc("generate_invoice_number"),
  ]);
  const invs = [a, b, c].map(String);
  const uniqInv = new Set(invs).size === 3;
  note("invoice.concurrent", uniqInv, invs.join(", "));
  if (!uniqInv) issue("critical", `duplicate invoices under concurrency: ${invs.join(",")}`);

  // Concurrent UMR uniqueness
  const [u1, u2, u3] = await Promise.all([rpc("generate_umr_number"), rpc("generate_umr_number"), rpc("generate_umr_number")]);
  const umrs = [u1, u2, u3].map(String);
  const uniqUmr = new Set(umrs).size === 3;
  note("umr.concurrent", uniqUmr, umrs.join(", "));
  if (!uniqUmr) issue("critical", `duplicate UMRs under concurrency: ${umrs.join(",")}`);

  // Full registration via atomic RPC (server assigns invoice+umr)
  const patientName = "CLOUD AUDIT PATIENT";
  const mobile = "9999900001"; // audit-only; no WhatsApp send
  const price = Number(test.price) || 100;
  const reg = await rpc("register_patient_atomic", {
    p_registration: {
      patient_name: patientName,
      mobile_number: mobile,
      title: "Mr.",
      gender: "Male",
      dob: "1990-01-01",
      doctor_name: "SELF",
      visit_type: "lab_visit",
      tests: [{ test_id: test.id, test_name: test.test_name, price, discount: 0, discounted_price: price }],
      gross_amount: price,
      discount_amount: 0,
      net_amount: price,
      home_visit_charges: 0,
      final_amount: price,
      payments: [{ mode: "Cash", amount: price }],
      paid_amount: price,
      due_amount: 0,
      status: "registered",
      registered_by: "CLOUD_AUDIT",
      report_language: "ENGLISH",
      is_stat: false,
    },
    p_tubes: [
      {
        tube_type: "EDTA",
        tube_color: "Purple",
        sample_type: "Blood",
        suffix: "",
        test_ids: [test.id],
        test_names: [test.test_name],
        status: "pending",
      },
    ],
    p_payment: {
      transaction_type: "registration_payment",
      direction: "in",
      performed_by: "CLOUD_AUDIT",
      cash_amount: price,
      total_amount: price,
      gross_amount: price,
      discount_amount: 0,
      final_amount: price,
      paid_amount: price,
      due_amount: 0,
    },
  });
  report.created.registrationId = reg.id;
  report.created.umrNumber = reg.umr_number;
  report.created.invoiceNumber = reg.invoice_number;
  note(
    "register.atomic",
    !!(reg?.id && reg?.invoice_number && reg?.umr_number),
    `invoice=${reg.invoice_number} umr=${reg.umr_number}`,
  );

  // Tubes created
  const tubes = await api("GET", `/rest/v1/sample_tubes?registration_id=eq.${reg.id}&select=*`);
  note("register.tubes", tubes?.length > 0, `${tubes?.length || 0} tube(s)`);

  // Collect → accept status path (minimal)
  if (tubes?.[0]) {
    await api("PATCH", `/rest/v1/sample_tubes?id=eq.${tubes[0].id}`, {
      status: "collected",
      collected_at: new Date().toISOString(),
      collected_by: "CLOUD_AUDIT",
    });
    await api("PATCH", `/rest/v1/sample_tubes?id=eq.${tubes[0].id}`, {
      status: "accepted",
      accepted_at: new Date().toISOString(),
      accepted_by: "CLOUD_AUDIT",
    });
    note("sample.collect_accept", true, tubes[0].sample_uid || tubes[0].id);
  }

  // desktop-api health (no outbound WhatsApp — just auth check / claim empty)
  try {
    const secretsPath = path.join(root, "supabase", ".env.cloud-phpl-secrets");
    let desktopKey = process.env.DESKTOP_API_KEY || "";
    if (!desktopKey && fs.existsSync(secretsPath)) {
      const raw = fs.readFileSync(secretsPath, "utf8").replace(/^\uFEFF/, "");
      for (const line of raw.split(/\r?\n/)) {
        const m = line.match(/^DESKTOP_API_KEY=(.*)$/);
        if (m) desktopKey = m[1].trim();
      }
    }
    if (desktopKey) {
      const res = await fetch(`${API}/functions/v1/desktop-api`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": desktopKey,
          apikey: ANON || SVC,
          Authorization: `Bearer ${ANON || SVC}`,
        },
        body: JSON.stringify({ action: "claim_outbox", limit: 1, claimed_by: "cloud-e2e-audit" }),
      });
      const text = await res.text();
      note("desktop_api.claim_outbox", res.ok, `HTTP ${res.status} (no WA send)`);
      if (!res.ok) issue("medium", `desktop-api: ${text.slice(0, 200)}`);
    } else {
      note("desktop_api.claim_outbox", false, "DESKTOP_API_KEY file missing");
    }
  } catch (e) {
    note("desktop_api.claim_outbox", false, e.message);
  }

  await cleanup(report.created);
  note("cleanup", true, "audit rows removed");

  report.finishedAt = new Date().toISOString();
  report.ok = report.issues.filter((i) => i.severity === "critical" || i.severity === "high").length === 0;
  fs.mkdirSync(path.join(root, "data-export-local-fresh"), { recursive: true });
  const out = path.join(root, "data-export-local-fresh", "cloud-e2e-audit-report.json");
  fs.writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(report.ok ? "\nCLOUD E2E PASSED" : "\nCLOUD E2E HAS ISSUES");
  console.log("Report →", out);
  process.exit(report.ok ? 0 : 1);
}

main().catch(async (e) => {
  console.error("AUDIT ABORTED:", e.message);
  report.fatal = e.message;
  try {
    if (report.created?.registrationId || report.created?.estimateId) await cleanup(report.created);
  } catch (ce) {
    report.cleanupError = ce.message;
  }
  fs.writeFileSync(
    path.join(root, "data-export-local-fresh", "cloud-e2e-audit-report.json"),
    JSON.stringify(report, null, 2),
  );
  process.exit(1);
});
