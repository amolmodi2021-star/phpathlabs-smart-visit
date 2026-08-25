/**
 * One-shot: merge analytics params missing from approved_reports.historical_trends.
 * Generic for ALL store_for_analytics params (not PP-only).
 *
 * Usage: node scripts/backfill-frozen-trend-gaps.mjs [--apply]
 */
import fs from "fs";

const APPLY = process.argv.includes("--apply");
const env = Object.fromEntries(
  fs.readFileSync(".env", "utf8").split(/\r?\n/).filter((l) => l && !l.startsWith("#") && l.includes("=")).map((l) => {
    const i = l.indexOf("=");
    return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
  }),
);
const API = (env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!API || !KEY) {
  console.error("Need VITE_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const h = {
  apikey: KEY,
  Authorization: "Bearer " + KEY,
  Accept: "application/json",
  "Content-Type": "application/json",
  Prefer: "return=minimal",
};

async function q(path, opts = {}) {
  const r = await fetch(API + "/rest/v1/" + path, {
    method: opts.method || "GET",
    headers: { ...h, ...(opts.headers || {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const t = await r.text();
  if (!r.ok) throw new Error((opts.method || "GET") + " " + path + " " + r.status + " " + t);
  return t ? JSON.parse(t) : null;
}

function parseNumeric(raw) {
  if (raw == null) return null;
  const s = String(raw).trim().replace(/,/g, "");
  if (!s) return null;
  const m = s.match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

function formatTrendDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso).slice(0, 10);
  const dd = String(d.getDate()).padStart(2, "0");
  const mons = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const yy = String(d.getFullYear()).slice(-2);
  return `${dd}-${mons[d.getMonth()]}-${yy}`;
}

function toFiniteNumber(raw) {
  if (raw == null || raw === "") return undefined;
  const n = typeof raw === "number" ? raw : Number(String(raw).trim());
  return Number.isFinite(n) ? n : undefined;
}

function normalizeFlag(raw) {
  const f = String(raw ?? "").trim().toUpperCase();
  if (!f) return undefined;
  if (f === "HIGH") return "H";
  if (f === "LOW") return "L";
  if (f === "H" || f === "L" || f === "N" || f === "X") return f;
  return f;
}

function snapshotWhen(ar) {
  return ar.sample_collection_date || ar.approval_date || ar.registration_date || ar.created_at;
}

function formatShortRange(low, high, unit) {
  const u = unit && String(unit).trim() ? ` ${String(unit).trim()}` : "";
  if (low != null && high != null) return `${low} - ${high}${u}`;
  if (low != null) return `≥ ${low}${u}`;
  if (high != null) return `≤ ${high}${u}`;
  return "—";
}

const analyticsParams = await q(
  "report_test_parameters?select=id,parameter_name,param_code,unit,normal_range_low,normal_range_high,normal_range_text,trend_display_low,trend_display_high,trend_display_label&store_for_analytics=eq.true",
);
const analyticsById = new Map(analyticsParams.map((p) => [p.id, p]));
console.log("Analytics params:", analyticsParams.length, APPLY ? "(APPLY)" : "(dry-run)");

const pageSize = 200;
let offset = 0;
let scanned = 0;
let patched = 0;
const missingCounts = new Map();
const examples = [];

while (true) {
  const batch = await q(
    `approved_reports?select=id,invoice_number,umr_number,registration_id,sample_collection_date,approval_date,registration_date,created_at,test_results,historical_trends&historical_trends=not.is.null&order=id.asc&limit=${pageSize}&offset=${offset}`,
  );
  if (!batch.length) break;

  for (const ar of batch) {
    scanned++;
    const frozen = Array.isArray(ar.historical_trends) ? ar.historical_trends : [];
    if (!frozen.length) continue;
    const frozenIds = new Set(frozen.map((t) => t?.parameter_id).filter(Boolean));
    const rows = Array.isArray(ar.test_results) ? ar.test_results : [];
    const missingIds = [];
    for (const tr of rows) {
      const pid = tr?.parameter_id;
      if (!pid || !analyticsById.has(pid) || frozenIds.has(pid)) continue;
      if (parseNumeric(tr.result_value) == null) continue;
      missingIds.push(pid);
    }
    const uniqMissing = [...new Set(missingIds)];
    if (!uniqMissing.length) continue;

    const hist = await q(
      `approved_reports?select=registration_id,sample_collection_date,approval_date,registration_date,created_at,test_results&umr_number=eq.${encodeURIComponent(ar.umr_number)}&order=approval_date.asc`,
    );

    const toAdd = [];
    for (const pid of uniqMissing) {
      const meta = analyticsById.get(pid);
      const byReg = new Map();
      for (const hrow of hist) {
        const regId = String(hrow.registration_id || "");
        const tr = (hrow.test_results || []).find((x) => x.parameter_id === pid);
        if (!tr) continue;
        const value = parseNumeric(tr.result_value);
        if (value == null) continue;
        const when = snapshotWhen(hrow);
        const sortKey = Date.parse(String(when || "")) || 0;
        const prev = byReg.get(regId);
        if (!prev || sortKey >= prev.sortKey) {
          byReg.set(regId, {
            sortKey,
            date: formatTrendDate(when),
            value,
            low: toFiniteNumber(tr.normal_range_low),
            high: toFiniteNumber(tr.normal_range_high),
            flag: normalizeFlag(tr.flag),
            rangeLabel:
              String(tr.reference_range || "").trim() ||
              formatShortRange(
                toFiniteNumber(tr.normal_range_low),
                toFiniteNumber(tr.normal_range_high),
                tr.unit || meta.unit,
              ),
          });
        }
      }
      // ensure current visit included
      const cur = rows.find((x) => x.parameter_id === pid);
      if (cur) {
        const value = parseNumeric(cur.result_value);
        if (value != null) {
          const when = snapshotWhen(ar);
          const sortKey = Date.parse(String(when || "")) || 0;
          const regId = String(ar.registration_id || "");
          const prev = byReg.get(regId);
          if (!prev || sortKey >= prev.sortKey) {
            byReg.set(regId, {
              sortKey,
              date: formatTrendDate(when),
              value,
              low: toFiniteNumber(cur.normal_range_low),
              high: toFiniteNumber(cur.normal_range_high),
              flag: normalizeFlag(cur.flag),
              rangeLabel:
                String(cur.reference_range || "").trim() ||
                formatShortRange(
                  toFiniteNumber(cur.normal_range_low),
                  toFiniteNumber(cur.normal_range_high),
                  cur.unit || meta.unit,
                ),
            });
          }
        }
      }

      const ordered = [...byReg.values()]
        .sort((a, b) => a.sortKey - b.sortKey)
        .slice(-5)
        .map(({ sortKey, ...rest }) => rest);
      if (!ordered.length) continue;
      const last = ordered[ordered.length - 1];
      toAdd.push({
        parameter_id: pid,
        parameter_name: meta.parameter_name,
        param_code: meta.param_code,
        unit: meta.unit || undefined,
        low: last.low,
        high: last.high,
        rangeLabel: last.rangeLabel || "—",
        data: ordered,
      });
      const name = meta.parameter_name;
      missingCounts.set(name, (missingCounts.get(name) || 0) + 1);
    }

    if (!toAdd.length) continue;
    examples.push({
      invoice: ar.invoice_number,
      added: toAdd.map((t) => t.parameter_name),
    });

    if (APPLY) {
      const merged = [...frozen, ...toAdd];
      await q(`approved_reports?id=eq.${ar.id}`, {
        method: "PATCH",
        body: { historical_trends: merged },
        headers: { Prefer: "return=minimal" },
      });
      patched++;
    }
  }

  if (batch.length < pageSize) break;
  offset += pageSize;
}

console.log("\nScanned:", scanned);
console.log(APPLY ? "Patched:" : "Would patch:", examples.length);
console.log("\nMissing param frequencies:");
for (const [name, n] of [...missingCounts.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${n}\t${name}`);
}
console.log("\nExamples:");
for (const e of examples.slice(0, 20)) {
  console.log(`  ${e.invoice}: + ${e.added.join(" | ")}`);
}
if (!APPLY) console.log("\nRe-run with --apply to write.");
