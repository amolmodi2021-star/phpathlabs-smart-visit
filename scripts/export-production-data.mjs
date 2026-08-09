/**
 * One-time production data export via anon key (RLS is open on this project).
 * Does NOT need service_role or DB password.
 * Writes JSON dumps under ./data-export/ for later import into local Supabase.
 *
 * Run: node scripts/export-production-data.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

function loadEnv() {
  const envPath = path.join(root, ".env");
  const text = fs.readFileSync(envPath, "utf8");
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)\s*=\s*"(.*)"\s*$/) || line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) env[m[1]] = m[2];
  }
  return env;
}

const env = loadEnv();
const SUPABASE_URL = (process.env.EXPORT_SUPABASE_URL || env.VITE_SUPABASE_URL || env.SUPABASE_URL || "").replace(/\/$/, "");
const ANON_KEY =
  process.env.EXPORT_SERVICE_ROLE_KEY ||
  env.SUPABASE_SERVICE_ROLE_KEY ||
  env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  env.SUPABASE_PUBLISHABLE_KEY;

if (!SUPABASE_URL || !ANON_KEY) {
  console.error("Missing VITE_SUPABASE_URL / anon or service key in .env");
  process.exit(1);
}

const OUT_DIR = process.env.DATA_EXPORT_DIR
  ? path.resolve(process.env.DATA_EXPORT_DIR)
  : path.join(root, "data-export");
const TABLES_DIR = path.join(OUT_DIR, "tables");
const STORAGE_DIR = path.join(OUT_DIR, "storage");

const TABLES = [
  "abnormal_card_templates",
  "app_roles",
  "app_settings",
  "app_user_login_history",
  "app_users",
  "approved_reports",
  "billing_profile_tests",
  "billing_profiles",
  "channel_prices",
  "channels",
  "cloudinary_accounts",
  "combo_profiles",
  "combo_tests",
  "combos",
  "doctors",
  "estimate_tests",
  "estimates",
  "health_checkup_profiles",
  "health_checkup_tests",
  "health_checkups",
  "home_visits",
  "invoice_counter",
  "lims_code_mapping",
  "lims_interface_logs",
  "lims_no_map_required",
  "lims_test_orders",
  "lims_unmapped_results",
  "loyalty_card_templates",
  "marketing_templates",
  "master_lookup",
  "message_templates",
  "outsourced_test_snips",
  "parameter_normal_ranges",
  "pathologist_signatures",
  "patient_master",
  "patient_registrations",
  "patient_results",
  "payment_transactions",
  "phlebotomist_leaves",
  "phlebotomists",
  "pickup_point_invoice_items",
  "pickup_point_invoice_payments",
  "pickup_point_invoices",
  "pickup_point_prices",
  "pickup_points",
  "profile_parameters",
  "report_departments",
  "report_layout_settings",
  "report_link_events",
  "report_link_sessions",
  "report_profiles",
  "report_share_links",
  "report_templates",
  "report_test_parameters",
  "sample_tube_counter",
  "sample_tubes",
  "standard_price_list_items",
  "standard_price_lists",
  "test_parameters",
  "test_sample_tubes",
  "tests",
  "umr_counter",
  "webhook_messages",
  "whatsapp_console_outbox",
];

const STORAGE_BUCKETS = [
  "report-uploads",
  "signatures",
  "letterheads",
  "loyalty-cards",
  "outsourced-snips",
  "chat-attachments",
  "invoice-assets",
];

const PAGE = 1000;

fs.mkdirSync(TABLES_DIR, { recursive: true });
fs.mkdirSync(STORAGE_DIR, { recursive: true });

async function fetchPage(table, from) {
  // Prefer id order; some counter tables use other keys — fall back gracefully.
  const orderCols = ["id", "created_at", "date_key", "counter_key", "setting_key"];
  let lastErr = null;
  for (const col of orderCols) {
    const url = `${SUPABASE_URL}/rest/v1/${table}?select=*&order=${col}.asc&offset=${from}&limit=${PAGE}`;
    const res = await fetch(url, {
      headers: {
        apikey: ANON_KEY,
        Authorization: `Bearer ${ANON_KEY}`,
        Prefer: "count=exact",
      },
    });
    if (res.ok) {
      return { rows: await res.json() };
    }
    lastErr = `${table} ${res.status}: ${await res.text()}`;
    // column missing → try next order key
    if (!/column|does not exist|42703/i.test(lastErr)) break;
  }
  // last resort: no order
  const url = `${SUPABASE_URL}/rest/v1/${table}?select=*&offset=${from}&limit=${PAGE}`;
  const res = await fetch(url, {
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${ANON_KEY}`,
    },
  });
  if (!res.ok) throw new Error(lastErr || `${table} ${res.status}: ${await res.text()}`);
  return { rows: await res.json() };
}

async function exportTable(table) {
  const all = [];
  let from = 0;
  while (true) {
    const { rows } = await fetchPage(table, from);
    all.push(...rows);
    process.stdout.write(`\r  ${table}: ${all.length} rows`);
    if (rows.length < PAGE) break;
    from += PAGE;
  }
  const outFile = path.join(TABLES_DIR, `${table}.json`);
  fs.writeFileSync(outFile, JSON.stringify(all, null, 0));
  console.log(`\r  ${table}: ${all.length} rows → tables/${table}.json`);
  return all.length;
}

async function listBucket(bucket, prefix = "") {
  const url = `${SUPABASE_URL}/storage/v1/object/list/${bucket}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${ANON_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ prefix, limit: 1000, offset: 0 }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`list ${bucket}: ${res.status} ${body}`);
  }
  return res.json();
}

async function listAllFiles(bucket, prefix = "") {
  const items = await listBucket(bucket, prefix);
  const files = [];
  for (const item of items || []) {
    const name = item.name;
    const full = prefix ? `${prefix}/${name}` : name;
    // folders often have id null and metadata null
    if (item.id == null && (item.metadata == null || item.metadata === undefined)) {
      const nested = await listAllFiles(bucket, full);
      files.push(...nested);
    } else {
      files.push(full);
    }
  }
  return files;
}

async function downloadFile(bucket, objectPath) {
  const url = `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${objectPath.split("/").map(encodeURIComponent).join("/")}`;
  const res = await fetch(url);
  if (!res.ok) {
    // try authenticated download
    const authUrl = `${SUPABASE_URL}/storage/v1/object/${bucket}/${objectPath.split("/").map(encodeURIComponent).join("/")}`;
    const res2 = await fetch(authUrl, {
      headers: {
        apikey: ANON_KEY,
        Authorization: `Bearer ${ANON_KEY}`,
      },
    });
    if (!res2.ok) throw new Error(`download ${bucket}/${objectPath}: ${res2.status}`);
    return Buffer.from(await res2.arrayBuffer());
  }
  return Buffer.from(await res.arrayBuffer());
}

async function exportStorage() {
  const manifest = {};
  for (const bucket of STORAGE_BUCKETS) {
    const bucketDir = path.join(STORAGE_DIR, bucket);
    fs.mkdirSync(bucketDir, { recursive: true });
    let files = [];
    try {
      files = await listAllFiles(bucket);
    } catch (e) {
      console.warn(`  skip bucket ${bucket}: ${e.message}`);
      manifest[bucket] = { error: e.message, files: [] };
      continue;
    }
    console.log(`  ${bucket}: ${files.length} files`);
    const saved = [];
    for (const file of files) {
      try {
        const buf = await downloadFile(bucket, file);
        const dest = path.join(bucketDir, file);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, buf);
        saved.push({ path: file, bytes: buf.length });
      } catch (e) {
        saved.push({ path: file, error: e.message });
        console.warn(`    fail ${file}: ${e.message}`);
      }
    }
    manifest[bucket] = { count: files.length, files: saved };
  }
  fs.writeFileSync(path.join(STORAGE_DIR, "manifest.json"), JSON.stringify(manifest, null, 2));
}

async function main() {
  console.log("Exporting from", SUPABASE_URL);
  console.log("Output →", OUT_DIR);
  const summary = { exportedAt: new Date().toISOString(), source: SUPABASE_URL, tables: {} };

  console.log("\n=== TABLES ===");
  for (const table of TABLES) {
    try {
      summary.tables[table] = { rows: await exportTable(table) };
    } catch (e) {
      console.error(`\n  FAIL ${table}: ${e.message}`);
      summary.tables[table] = { error: e.message };
    }
  }

  console.log("\n=== STORAGE ===");
  try {
    await exportStorage();
    summary.storage = "done";
  } catch (e) {
    console.error("Storage export error:", e.message);
    summary.storage = { error: e.message };
  }

  fs.writeFileSync(path.join(OUT_DIR, "summary.json"), JSON.stringify(summary, null, 2));
  console.log("\nDone. Summary → data-export/summary.json");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
