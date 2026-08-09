import fs from "node:fs";

function loadEnv() {
  const text = fs.readFileSync(".env", "utf8");
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)\s*=\s*"(.*)"\s*$/) || line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) env[m[1]] = m[2];
  }
  return env;
}

const env = loadEnv();
const url = env.VITE_SUPABASE_URL.replace(/\/$/, "");
const key = env.VITE_SUPABASE_PUBLISHABLE_KEY;
const summary = JSON.parse(fs.readFileSync("data-export/summary.json", "utf8"));

const mismatches = [];
for (const t of Object.keys(summary.tables)) {
  const res = await fetch(`${url}/rest/v1/${t}?select=*&limit=1`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Prefer: "count=exact",
      Range: "0-0",
    },
  });
  const cr = res.headers.get("content-range") || "";
  const live = cr.includes("/") ? cr.split("/")[1] : `http_${res.status}`;
  const exp = String(summary.tables[t].rows ?? summary.tables[t].error);
  if (live !== exp) mismatches.push(`${t}: live=${live} export=${exp}`);
}

if (mismatches.length) {
  console.log("MISMATCHES:");
  mismatches.forEach((m) => console.log(" ", m));
} else {
  console.log("ALL 63 TABLE COUNTS MATCH LIVE PRODUCTION");
}

const snips = JSON.parse(fs.readFileSync("data-export/tables/outsourced_test_snips.json", "utf8"));
const keys = snips[0] ? Object.keys(snips[0]) : [];
console.log("outsourced_test_snips columns:", keys.join(", "));
const urlFields = keys.filter((k) => /url|path|snip|image|file|cloud/i.test(k));
const urls = [];
for (const row of snips) {
  for (const f of urlFields) {
    if (row[f]) urls.push(String(row[f]));
  }
}
const unique = [...new Set(urls)];
console.log("url-like fields:", urlFields.join(", "));
console.log("unique url values:", unique.length);
unique.slice(0, 10).forEach((u) => console.log(" ", u.slice(0, 160)));

// also check approved_reports for embedded data richness
const ar = JSON.parse(fs.readFileSync("data-export/tables/approved_reports.json", "utf8"));
console.log("approved_reports rows:", ar.length, "sample keys:", ar[0] ? Object.keys(ar[0]).join(", ") : "none");
