/**
 * Fast cloud import for ~20k+ legacy patient Excel rows.
 * Uses RPC import_legacy_patients_batch (500/chunk). Safe to re-run.
 *
 *   node scripts/import-legacy-patients.mjs "C:\path\to\patients.xlsx"
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as XLSX from "@e965/xlsx";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const CHUNK = 500;

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const env = {};
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const m = t.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    env[m[1]] = m[2].replace(/^['"]|['"]$/g, "").trim();
  }
  return env;
}

function cloudKeys() {
  const preferCloud = process.argv.includes("--local") === false;
  const files = preferCloud
    ? [".env.cloud-phpl", ".env"]
    : [".env.local", ".env"];
  let env = {};
  for (const name of files) {
    env = { ...env, ...loadEnvFile(path.join(root, name)) };
  }
  let url = (env.VITE_SUPABASE_URL || env.SUPABASE_URL || "").replace(/\/$/, "");
  let key = env.SUPABASE_SERVICE_ROLE_KEY || env.VITE_SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_PUBLISHABLE_KEY;
  if (preferCloud && /127\.0\.0\.1|localhost/i.test(url)) {
    const cloud = loadEnvFile(path.join(root, ".env.cloud-phpl"));
    url = (cloud.VITE_SUPABASE_URL || cloud.SUPABASE_URL || "").replace(/\/$/, "");
    key = cloud.SUPABASE_SERVICE_ROLE_KEY || key;
  }
  if (!url || !key) throw new Error("Missing VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env");
  if (/127\.0\.0\.1|localhost/i.test(url) && preferCloud) {
    throw new Error(`Refusing local URL ${url}. This script targets cloud. Pass --local to override.`);
  }
  console.log("Target host:", new URL(url).host);
  return { url, key };
}

const norm = (v) => String(v ?? "").replace(/\s+/g, " ").trim();
const upper = (v) => norm(v).toUpperCase();
const mob10 = (v) => String(v ?? "").replace(/\D/g, "").slice(-10);

function normalizeGender(v) {
  const g = norm(v).toLowerCase();
  if (!g) return "";
  if (g.startsWith("m")) return "Male";
  if (g.startsWith("f")) return "Female";
  return "Unspecified";
}

function pick(row, ...keys) {
  for (const k of keys) {
    const found = Object.keys(row).find(
      (rk) => rk.toLowerCase().replace(/\s+|_/g, "") === k.toLowerCase().replace(/\s+|_/g, ""),
    );
    if (found && row[found] !== undefined && row[found] !== "") return row[found];
  }
  return "";
}

function parseRows(filePath) {
  const buf = fs.readFileSync(filePath);
  const wb = XLSX.read(buf, { type: "buffer", cellDates: true, cellNF: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: "", raw: false });
  const ready = [];
  const skipped = [];
  const seen = new Set();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const umr = norm(pick(r, "umr_number", "umr", "umrid", "umrno"));
    const mobile = mob10(pick(r, "mobile_number", "mobile", "mobileno", "phone"));
    const name = upper(pick(r, "patient_name", "name", "patientname"));
    const title = upper(pick(r, "title"));
    const gender = normalizeGender(pick(r, "gender", "sex"));
    const address = upper(pick(r, "address"));
    if (!umr) {
      skipped.push({ row: i + 2, reason: "Missing UMR" });
      continue;
    }
    if (!mobile || mobile.length !== 10) {
      skipped.push({ row: i + 2, reason: "Invalid mobile" });
      continue;
    }
    if (!name) {
      skipped.push({ row: i + 2, reason: "Missing patient name" });
      continue;
    }
    if (seen.has(umr)) {
      skipped.push({ row: i + 2, reason: "Duplicate UMR in file" });
      continue;
    }
    seen.add(umr);
    ready.push({
      umr_id: umr,
      patient_name: name,
      title,
      gender,
      mobile_number: mobile,
      address,
    });
  }
  return { total: rows.length, ready, skipped };
}

async function rpc(url, key, chunk) {
  const res = await fetch(`${url}/rest/v1/rpc/import_legacy_patients_batch`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify({ p_rows: chunk }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`RPC ${res.status}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : {};
}

const filePath = process.argv[2];
if (!filePath) {
  console.error('Usage: node scripts/import-legacy-patients.mjs "C:\\path\\to\\file.xlsx"');
  process.exit(1);
}
const abs = path.resolve(filePath);
if (!fs.existsSync(abs)) {
  console.error("File not found:", abs);
  process.exit(1);
}

const { url, key } = cloudKeys();
console.log("Reading", abs);
const { total, ready, skipped } = parseRows(abs);
console.log(`Excel rows ${total.toLocaleString()} · valid ${ready.length.toLocaleString()} · skipped ${skipped.length.toLocaleString()}`);

let inserted = 0;
let updated = 0;
const t0 = Date.now();
for (let i = 0; i < ready.length; i += CHUNK) {
  const chunk = ready.slice(i, i + CHUNK);
  const data = await rpc(url, key, chunk);
  inserted += Number(data?.inserted || 0);
  updated += Number(data?.updated || 0);
  const done = Math.min(i + chunk.length, ready.length);
  const pct = Math.round((done / ready.length) * 100);
  const sec = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`  ${done.toLocaleString()}/${ready.length.toLocaleString()} (${pct}%)  +${inserted} new  ~${updated} updated  ${sec}s`);
}

console.log("Done.");
console.log(`Inserted ${inserted.toLocaleString()} · updated ${updated.toLocaleString()} · skipped ${skipped.length.toLocaleString()}`);
if (skipped.length) {
  const out = path.join(root, "legacy-import-skipped.json");
  fs.writeFileSync(out, JSON.stringify(skipped, null, 2));
  console.log("Skipped detail:", out);
}
