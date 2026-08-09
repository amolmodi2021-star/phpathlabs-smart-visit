/**
 * One-off / ops: split colliding lims_test_orders that share a bare invoice sample_id
 * across unsuffixed tubes (EDTA/PLAIN/URINE). Uses tube_type-derived suffixes.
 *
 * Usage: node scripts/repair-colliding-sample-ids.mjs [invoice...]
 * Env: VITE_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (from .env)
 */
import fs from "node:fs";
import path from "node:path";

function loadEnv() {
  const p = path.resolve(".env");
  const raw = fs.readFileSync(p, "utf8");
  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return env;
}

function tubeTypeSuffix(tubeType) {
  const t = String(tubeType || "");
  if (/fluoride/i.test(t)) return "-F";
  if (/\bedta\b/i.test(t)) return "-E";
  if (/\bplain\b|\bserum\b|clot/i.test(t)) return "-P";
  if (/urine/i.test(t)) return "-U";
  if (/citrate/i.test(t)) return "-C";
  if (/heparin/i.test(t)) return "-H";
  if (/esr/i.test(t)) return "-R";
  const compact = t.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  return compact ? `-${compact.slice(0, 3)}` : null;
}

function scoreOrderToTube(orderNames, tubeNames) {
  const joined = orderNames.join(" ").toLowerCase();
  const names = tubeNames.map((n) => String(n).toLowerCase());
  let score = 0;
  if (names.includes("cbc") || names.some((n) => n.includes("cbc"))) {
    for (const h of ["haemoglobin", "mch", "mcv", "platelet", "neutrophil", "lymphocyte", "rdw", "mpv", "pcv", "r.b.c", "w.b.c"]) {
      if (joined.includes(h)) score++;
    }
  } else if (names.some((n) => n.includes("urine"))) {
    for (const h of ["protein", "bilirubin", "ketone", "nitrite", "appearance", "specific gravity", "glucose", "blood (urine)"]) {
      if (joined.includes(h)) score++;
    }
  } else {
    for (const h of ["iron", "creatinine", "uric", "urea", "calcium", "phosphorus", "sodium", "potassium", "chloride", "psa"]) {
      if (joined.includes(h)) score++;
    }
  }
  return score;
}

async function rest(url, key, method, pathAndQuery, body) {
  const res = await fetch(`${url}/rest/v1/${pathAndQuery}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: method === "GET" ? "count=exact" : "return=representation",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${pathAndQuery} -> ${res.status} ${await res.text()}`);
  return res.json();
}

const env = loadEnv();
const url = env.VITE_SUPABASE_URL || env.SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const onlyInvoices = new Set(process.argv.slice(2));

const bareOrders = await rest(url, key, "GET", "lims_test_orders?select=id,sample_id,tests,status&sample_id=not.like.*-*&limit=2000");
const bySample = new Map();
for (const o of bareOrders) {
  if (!bySample.has(o.sample_id)) bySample.set(o.sample_id, []);
  bySample.get(o.sample_id).push(o);
}

const colliding = [...bySample.entries()].filter(([, rows]) => rows.length > 1);
console.log(`Found ${colliding.length} colliding bare sample_id groups`);

let fixed = 0;
for (const [sampleId, orders] of colliding) {
  if (onlyInvoices.size && !onlyInvoices.has(sampleId)) continue;
  const regs = await rest(url, key, "GET", `patient_registrations?invoice_number=eq.${sampleId}&select=id`);
  const regId = regs[0]?.id;
  if (!regId) {
    console.log(`skip ${sampleId}: no registration`);
    continue;
  }
  const tubes = await rest(url, key, "GET", `sample_tubes?registration_id=eq.${regId}&select=id,sample_uid,suffix,tube_type,test_names`);
  const unsuffixed = tubes.filter((t) => !(t.suffix || "").trim());
  for (const order of orders) {
    const orderNames = (order.tests || []).map((t) => t.name || t.code || "");
    let best = null;
    let bestScore = -1;
    for (const tube of unsuffixed) {
      const score = scoreOrderToTube(orderNames, tube.test_names || []);
      if (score > bestScore) {
        bestScore = score;
        best = tube;
      }
    }
    if (!best || bestScore <= 0) {
      console.log(`  NO MATCH ${sampleId} order=${order.id} params=${orderNames.length}`);
      continue;
    }
    const sfx = tubeTypeSuffix(best.tube_type) || `-${String(best.sample_uid).slice(-4)}`;
    const newId = `${sampleId}${sfx}`;
    await rest(url, key, "PATCH", `lims_test_orders?id=eq.${order.id}`, { sample_id: newId });
    console.log(`  ${sampleId} -> ${newId} (${best.tube_type}, score=${bestScore})`);
    fixed++;
  }
}

console.log(`Repaired ${fixed} order(s)`);