/**
 * Import data-export/ into a running LOCAL Supabase.
 * Usage (after `npx supabase start`):
 *   node scripts/import-production-data.mjs
 *
 * Reads keys from `npx supabase status -o env` automatically when possible,
 * or from .env.local if present.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const EXPORT = process.env.DATA_EXPORT_DIR
  ? path.resolve(process.env.DATA_EXPORT_DIR)
  : path.join(root, "data-export");
const TABLES_DIR = path.join(EXPORT, "tables");
const STORAGE_DIR = path.join(EXPORT, "storage");

function loadLocalKeys() {
  // Allow cloud/remote import without touching local Docker.
  if (process.env.TARGET_SUPABASE_URL && process.env.TARGET_SERVICE_ROLE_KEY) {
    return {
      url: process.env.TARGET_SUPABASE_URL.replace(/\/$/, ""),
      key: process.env.TARGET_SERVICE_ROLE_KEY,
      source: "TARGET_* env",
    };
  }

  // Prefer supabase status env output
  try {
    const out = execSync("npx supabase status -o env", {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const env = {};
    for (const line of out.split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m) env[m[1]] = m[2].replace(/^"|"$/g, "");
    }
    if (env.API_URL && env.SERVICE_ROLE_KEY) {
      return {
        url: env.API_URL.replace(/\/$/, ""),
        key: env.SERVICE_ROLE_KEY,
        source: "supabase status",
      };
    }
  } catch {
    // fall through
  }

  const localEnvPath = path.join(root, ".env.local");
  if (fs.existsSync(localEnvPath)) {
    const text = fs.readFileSync(localEnvPath, "utf8");
    const env = {};
    for (const line of text.split(/\r?\n/)) {
      const m =
        line.match(/^([A-Z0-9_]+)\s*=\s*"(.*)"\s*$/) ||
        line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (m) env[m[1]] = m[2];
    }
    return {
      url: (env.VITE_SUPABASE_URL || "").replace(/\/$/, ""),
      key: env.SUPABASE_SERVICE_ROLE_KEY || env.VITE_SUPABASE_PUBLISHABLE_KEY,
      source: ".env.local",
    };
  }

  throw new Error("Local Supabase keys not found. Start Docker + `npx supabase start` first.");
}

/** FK-safe import order (parents before children). */
const IMPORT_ORDER = [
  "app_roles",
  "app_users",
  "app_settings",
  "app_user_login_history",
  "master_lookup",
  "message_templates",
  "marketing_templates",
  "cloudinary_accounts",
  "loyalty_card_templates",
  "abnormal_card_templates",
  "report_departments",
  "report_profiles",
  "report_test_parameters",
  "parameter_normal_ranges",
  "profile_parameters",
  "report_layout_settings",
  "report_templates",
  "pathologist_signatures",
  "tests",
  "test_parameters",
  "test_sample_tubes",
  "billing_profiles",
  "billing_profile_tests",
  "combos",
  "combo_tests",
  "combo_profiles",
  "health_checkups",
  "health_checkup_tests",
  "health_checkup_profiles",
  "channels",
  "channel_prices",
  "pickup_points",
  "pickup_point_prices",
  "standard_price_lists",
  "standard_price_list_items",
  "doctors",
  "phlebotomists",
  "phlebotomist_leaves",
  "patient_master",
  "estimates",
  "estimate_tests",
  "home_visits",
  "patient_registrations",
  "sample_tubes",
  "patient_results",
  "outsourced_test_snips",
  "approved_reports",
  "payment_transactions",
  "pickup_point_invoices",
  "pickup_point_invoice_items",
  "pickup_point_invoice_payments",
  "lims_code_mapping",
  "lims_no_map_required",
  "lims_test_orders",
  "lims_unmapped_results",
  "lims_interface_logs",
  "report_share_links",
  "report_link_events",
  "report_link_sessions",
  "webhook_messages",
  "invoice_counter",
  "sample_tube_counter",
  "umr_counter",
];

const CHUNK = 200;

const CONFLICT_KEYS = {
  invoice_counter: "date_key",
  sample_tube_counter: "date_key",
  umr_counter: "counter_key",
  app_settings: "setting_key",
};

async function upsertChunk(url, key, table, rows) {
  if (!rows.length) return;
  const conflict = CONFLICT_KEYS[table] || "id";
  const res = await fetch(`${url}/rest/v1/${table}?on_conflict=${conflict}`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${table} insert failed: ${res.status} ${body}`);
  }
}

async function countTable(url, key, table) {
  const res = await fetch(`${url}/rest/v1/${table}?select=*&limit=1`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Prefer: "count=exact",
      Range: "0-0",
    },
  });
  const cr = res.headers.get("content-range") || "";
  return cr.includes("/") ? Number(cr.split("/")[1]) : NaN;
}

async function ensureBucket(url, key, bucket) {
  const res = await fetch(`${url}/storage/v1/bucket`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ id: bucket, name: bucket, public: true }),
  });
  // 200/201 created, 409 already exists
  if (!res.ok && res.status !== 409) {
    const body = await res.text();
    console.warn(`  bucket ${bucket}: ${res.status} ${body}`);
  }
}

async function uploadFile(url, key, bucket, objectPath, filePath) {
  const buf = fs.readFileSync(filePath);
  const res = await fetch(
    `${url}/storage/v1/object/${bucket}/${objectPath.split("/").map(encodeURIComponent).join("/")}`,
    {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/octet-stream",
        "x-upsert": "true",
      },
      body: buf,
    },
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${bucket}/${objectPath}: ${res.status} ${body}`);
  }
}

function walkFiles(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(full));
    else if (entry.name !== "manifest.json") out.push(full);
  }
  return out;
}

async function main() {
  const summary = JSON.parse(fs.readFileSync(path.join(EXPORT, "summary.json"), "utf8"));
  const { url, key, source } = loadLocalKeys();
  console.log(`Importing into ${url} (keys from ${source})`);
  console.log(`Source export: ${summary.exportedAt} from ${summary.source}`);

  const exportedTables = Object.keys(summary.tables);
  const missingOrder = exportedTables.filter((t) => !IMPORT_ORDER.includes(t));
  const order = [...IMPORT_ORDER, ...missingOrder];

  const report = { importedAt: new Date().toISOString(), tables: {}, storage: {} };

  console.log("\n=== TABLES ===");
  for (const table of order) {
    const file = path.join(TABLES_DIR, `${table}.json`);
    if (!fs.existsSync(file)) {
      console.warn(`  skip missing file: ${table}`);
      continue;
    }
    const rows = JSON.parse(fs.readFileSync(file, "utf8"));
    const expected = summary.tables[table]?.rows ?? rows.length;
    for (let i = 0; i < rows.length; i += CHUNK) {
      await upsertChunk(url, key, table, rows.slice(i, i + CHUNK));
      process.stdout.write(`\r  ${table}: ${Math.min(i + CHUNK, rows.length)}/${rows.length}`);
    }
    const actual = await countTable(url, key, table);
    const ok = actual === expected;
    console.log(`\r  ${table}: imported ${rows.length}, local count ${actual}, expected ${expected} ${ok ? "OK" : "MISMATCH"}`);
    report.tables[table] = { expected, imported: rows.length, localCount: actual, ok };
    if (!ok) throw new Error(`Count mismatch on ${table}`);
  }

  console.log("\n=== STORAGE ===");
  const buckets = fs
    .readdirSync(STORAGE_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  for (const bucket of buckets) {
    await ensureBucket(url, key, bucket);
    const bucketPath = path.join(STORAGE_DIR, bucket);
    const files = walkFiles(bucketPath);
    let okCount = 0;
    for (const full of files) {
      const objectPath = path.relative(bucketPath, full).split(path.sep).join("/");
      try {
        await uploadFile(url, key, bucket, objectPath, full);
        okCount++;
      } catch (e) {
        console.warn(`  fail ${bucket}/${objectPath}: ${e.message}`);
      }
    }
    console.log(`  ${bucket}: ${okCount}/${files.length} files`);
    report.storage[bucket] = { uploaded: okCount, total: files.length };
  }

  fs.writeFileSync(path.join(EXPORT, "import-report.json"), JSON.stringify(report, null, 2));
  const bad = Object.values(report.tables).filter((t) => !t.ok);
  if (bad.length) {
    console.error("\nImport finished with mismatches.");
    process.exit(1);
  }
  console.log("\nALL DATA IMPORTED AND VERIFIED. Report → data-export/import-report.json");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
