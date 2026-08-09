/**
 * Import data-export JSON into local Postgres via docker exec + psql.
 * Bypasses PostgREST permissions entirely.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const EXPORT = path.join(root, "data-export");
const TABLES_DIR = path.join(EXPORT, "tables");
const STORAGE_DIR = path.join(EXPORT, "storage");
const DB_CONTAINER = "supabase_db_phpathlabs-local";

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

function psql(sql) {
  return execFileSync(
    "docker",
    ["exec", "-i", DB_CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-t", "-A"],
    { input: sql, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  ).trim();
}

function sqlLiteral(value, pgType) {
  if (value === null || value === undefined) return "NULL";

  const t = (pgType || "").toLowerCase();

  if (Array.isArray(value)) {
    if (t === "jsonb" || t === "json") {
      // Postgres standard_conforming_strings: only escape single quotes in literals
      return `'${JSON.stringify(value).replace(/'/g, "''")}'::jsonb`;
    }
    // postgres array types: integer[], text[], uuid[], etc.
    const base = t.endsWith("[]") ? t : null;
    if (base) {
      const inner = value
        .map((v) => {
          if (v === null || v === undefined) return "NULL";
          if (typeof v === "number") return String(v);
          if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
          return `'${String(v).replace(/'/g, "''")}'`;
        })
        .join(",");
      return `ARRAY[${inner}]::${base}`;
    }
    return `'${JSON.stringify(value).replace(/'/g, "''")}'::jsonb`;
  }

  if (typeof value === "object") {
    return `'${JSON.stringify(value).replace(/'/g, "''")}'::jsonb`;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "NULL";
    return String(value);
  }
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";

  const s = String(value).replace(/'/g, "''");
  if (t === "jsonb" || t === "json") return `'${s}'::jsonb`;
  return `'${s}'`;
}

function getColumnTypes(table) {
  const raw = psql(`
    SELECT column_name || '=' || udt_name
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name='${table}'
    ORDER BY ordinal_position;
  `);
  const map = {};
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const [name, udt] = line.split("=");
    // udt_name for arrays is _int4, _text — convert to int4[], text[]
    let pgType = udt;
    if (udt.startsWith("_")) pgType = udt.slice(1) + "[]";
    if (udt === "int4") pgType = "integer";
    if (udt === "int8") pgType = "bigint";
    if (udt === "bool") pgType = "boolean";
    if (udt === "varchar" || udt === "text" || udt === "bpchar") pgType = "text";
    map[name] = pgType;
  }
  return map;
}

function insertTable(table, rows) {
  if (!rows.length) return 0;
  const types = getColumnTypes(table);
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))].filter((c) => c in types);
  const colList = cols.map((c) => `"${c}"`).join(", ");
  const CHUNK = 100;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const values = slice
      .map((row) => {
        const vals = cols.map((c) => {
          if (!(c in row) || row[c] === undefined) return "NULL";
          return sqlLiteral(row[c], types[c]);
        });
        return `(${vals.join(",")})`;
      })
      .join(",\n");
    const sql = `INSERT INTO public."${table}" (${colList}) VALUES\n${values};`;
    psql(sql);
    inserted += slice.length;
    process.stdout.write(`\r  ${table}: ${inserted}/${rows.length}`);
  }
  return inserted;
}

function countTable(table) {
  return Number(psql(`SELECT COUNT(*) FROM public."${table}";`));
}

async function main() {
  const summary = JSON.parse(fs.readFileSync(path.join(EXPORT, "summary.json"), "utf8"));
  console.log("Importing via docker/psql into", DB_CONTAINER);
  console.log("Source export:", summary.exportedAt);

  // disable triggers that auto-mutate during bulk load where possible
  psql("SET session_replication_role = replica;");

  const exported = Object.keys(summary.tables);
  const missing = exported.filter((t) => !IMPORT_ORDER.includes(t));
  const order = [...IMPORT_ORDER, ...missing];
  const report = { importedAt: new Date().toISOString(), tables: {} };

  console.log("\n=== TABLES ===");
  for (const table of order) {
    const file = path.join(TABLES_DIR, `${table}.json`);
    if (!fs.existsSync(file)) {
      console.warn(`  skip missing file ${table}`);
      continue;
    }
    const rows = JSON.parse(fs.readFileSync(file, "utf8"));
    const expected = summary.tables[table]?.rows ?? rows.length;
    try {
      // briefly enable writes with triggers off at session level already set
      const imported = insertTable(table, rows);
      const actual = countTable(table);
      const ok = actual === expected;
      console.log(
        `\r  ${table}: imported ${imported}, local ${actual}, expected ${expected} ${ok ? "OK" : "MISMATCH"}`,
      );
      report.tables[table] = { expected, imported, localCount: actual, ok };
      if (!ok) throw new Error(`Count mismatch on ${table}`);
    } catch (e) {
      console.error(`\n  FAIL ${table}: ${e.message}`);
      report.tables[table] = { expected, error: e.message, ok: false };
      fs.writeFileSync(path.join(EXPORT, "import-report.json"), JSON.stringify(report, null, 2));
      throw e;
    }
  }

  psql("SET session_replication_role = DEFAULT;");

  // Storage upload via local API with service role JWT
  const API = "http://127.0.0.1:54421";
  const SERVICE =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

  console.log("\n=== STORAGE ===");
  const buckets = fs.existsSync(STORAGE_DIR)
    ? fs.readdirSync(STORAGE_DIR, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
    : [];

  report.storage = {};
  for (const bucket of buckets) {
    await fetch(`${API}/storage/v1/bucket`, {
      method: "POST",
      headers: {
        apikey: SERVICE,
        Authorization: `Bearer ${SERVICE}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ id: bucket, name: bucket, public: true }),
    });

    const bucketPath = path.join(STORAGE_DIR, bucket);
    const files = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name !== "manifest.json") files.push(full);
      }
    };
    walk(bucketPath);

    let ok = 0;
    for (const full of files) {
      const objectPath = path.relative(bucketPath, full).split(path.sep).join("/");
      const buf = fs.readFileSync(full);
      const res = await fetch(
        `${API}/storage/v1/object/${bucket}/${objectPath.split("/").map(encodeURIComponent).join("/")}`,
        {
          method: "POST",
          headers: {
            apikey: SERVICE,
            Authorization: `Bearer ${SERVICE}`,
            "Content-Type": "application/octet-stream",
            "x-upsert": "true",
          },
          body: buf,
        },
      );
      if (res.ok) ok++;
      else console.warn(`  fail ${bucket}/${objectPath}: ${res.status} ${await res.text()}`);
    }
    console.log(`  ${bucket}: ${ok}/${files.length}`);
    report.storage[bucket] = { uploaded: ok, total: files.length };
  }

  fs.writeFileSync(path.join(EXPORT, "import-report.json"), JSON.stringify(report, null, 2));
  const bad = Object.values(report.tables).filter((t) => !t.ok);
  if (bad.length) {
    console.error("Import finished with mismatches");
    process.exit(1);
  }
  console.log("\nALL DATA IMPORTED AND VERIFIED → data-export/import-report.json");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
