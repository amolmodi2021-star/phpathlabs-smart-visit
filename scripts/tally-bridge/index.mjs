/**
 * TallyPrime bridge (button-driven — NO polling).
 * Run on the PC where TallyPrime is open with XML/HTTP enabled.
 *
 * Usage:
 *   set DESKTOP_API_URL=https://gqpqnfvihjjkmbcdzate.supabase.co/functions/v1/desktop-api
 *   set DESKTOP_API_KEY=your_desktop_api_key
 *   set TALLY_HOST=http://localhost:9000
 *   set TALLY_COMPANY=Your Company Name
 *   node scripts/tally-bridge/index.mjs
 *
 * Open http://127.0.0.1:8787 and click "Download & Push to Tally".
 */
import http from "node:http";
import { URL } from "node:url";

const API_URL = (process.env.DESKTOP_API_URL || "").replace(/\/$/, "");
const API_KEY = process.env.DESKTOP_API_KEY || "";
const TALLY_HOST = (process.env.TALLY_HOST || "http://localhost:9000").replace(/\/$/, "");
const TALLY_COMPANY = process.env.TALLY_COMPANY || "";
const PORT = Number(process.env.TALLY_BRIDGE_PORT || 8787);

if (!API_URL || !API_KEY) {
  console.error("Set DESKTOP_API_URL and DESKTOP_API_KEY");
  process.exit(1);
}

function xmlEscape(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function tallyDate(isoDate) {
  return String(isoDate || "").replace(/-/g, "");
}

function buildVoucherXml(job) {
  const lines = Array.isArray(job.lines) ? job.lines : [];
  const entries = lines
    .map((line) => {
      const amt = Number(line.amount || 0).toFixed(2);
      const deemed = line.is_debit ? "Yes" : "No";
      const signed = line.is_debit ? `-${amt}` : amt;
      return `<ALLLEDGERENTRIES.LIST>
        <LEDGERNAME>${xmlEscape(line.ledger)}</LEDGERNAME>
        <ISDEEMEDPOSITIVE>${deemed}</ISDEEMEDPOSITIVE>
        <AMOUNT>${signed}</AMOUNT>
      </ALLLEDGERENTRIES.LIST>`;
    })
    .join("\n");

  const companyBlock = TALLY_COMPANY
    ? `<STATICVARIABLES><SVCURRENTCOMPANY>${xmlEscape(TALLY_COMPANY)}</SVCURRENTCOMPANY></STATICVARIABLES>`
    : "";

  return `<?xml version="1.0" encoding="utf-8"?>
<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Import Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>Vouchers</REPORTNAME>
        ${companyBlock}
      </REQUESTDESC>
      <REQUESTDATA>
        <TALLYMESSAGE xmlns:UDF="TallyUDF">
          <VOUCHER VCHTYPE="${xmlEscape(job.voucher_type || "Receipt")}" ACTION="Create" OBJVIEW="Accounting Voucher View">
            <DATE>${tallyDate(job.voucher_date)}</DATE>
            <NARRATION>${xmlEscape(job.narration)}</NARRATION>
            <VOUCHERTYPENAME>${xmlEscape(job.voucher_type || "Receipt")}</VOUCHERTYPENAME>
            ${entries}
          </VOUCHER>
        </TALLYMESSAGE>
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>`;
}

async function api(action, body = {}) {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": API_KEY,
    },
    body: JSON.stringify({ action, ...body }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `API ${res.status}`);
  return json;
}

async function postToTally(xml) {
  const res = await fetch(TALLY_HOST, {
    method: "POST",
    headers: { "Content-Type": "application/xml" },
    body: xml,
  });
  const text = await res.text();
  const hasLineError = /<LINEERROR>([^<]+)/i.test(text);
  if (hasLineError) {
    const m = text.match(/<LINEERROR>([^<]+)/i);
    throw new Error(m?.[1] || "Tally LINEERROR");
  }
  if (/ERROR|FAILED/i.test(text) && !/<CREATED>/i.test(text) && !/<ALTERED>/i.test(text)) {
    throw new Error(text.slice(0, 400));
  }
  return text;
}

async function peek() {
  const res = await api("peek_tally_outbox");
  return res.data || [];
}

async function pushAll() {
  const claimed = await api("claim_tally_outbox", { limit: 50, claimed_by: "tally-bridge-ui" });
  const jobs = claimed.data || [];
  const results = [];
  for (const job of jobs) {
    try {
      const xml = buildVoucherXml(job);
      const tallyResponse = await postToTally(xml);
      await api("complete_tally_outbox", {
        id: job.id,
        status: "sent",
        tally_response: tallyResponse.slice(0, 2000),
      });
      results.push({
        id: job.id,
        ok: true,
        label: `${job.kind} ${job.day_key || ""} ${job.mode_key || ""}`.trim(),
        amount: job.amount,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await api("complete_tally_outbox", {
        id: job.id,
        status: "failed",
        error: msg.slice(0, 500),
      }).catch(() => {});
      results.push({
        id: job.id,
        ok: false,
        label: `${job.kind} ${job.day_key || ""} ${job.mode_key || ""}`.trim(),
        amount: job.amount,
        error: msg,
      });
    }
  }
  return { claimed: jobs.length, results };
}

function pageHtml() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>PH PathLabs — Tally Bridge</title>
  <style>
    :root { color-scheme: light; font-family: Segoe UI, system-ui, sans-serif; }
    body { margin: 0; background: #f4f6f8; color: #1a1a1a; }
    main { max-width: 720px; margin: 40px auto; padding: 0 16px; }
    h1 { font-size: 1.35rem; margin: 0 0 8px; }
    p { color: #555; line-height: 1.45; }
    .card { background: #fff; border: 1px solid #dde3ea; border-radius: 10px; padding: 20px; }
    .row { display: flex; gap: 12px; flex-wrap: wrap; align-items: center; margin-top: 16px; }
    button {
      appearance: none; border: 0; border-radius: 8px; padding: 12px 18px;
      font-size: 1rem; font-weight: 600; cursor: pointer;
    }
    button.primary { background: #0b6bcb; color: #fff; }
    button.secondary { background: #e8eef5; color: #123; }
    button:disabled { opacity: 0.55; cursor: not-allowed; }
    .meta { font-size: 0.9rem; color: #666; }
    #log { margin-top: 16px; white-space: pre-wrap; font-family: Consolas, monospace; font-size: 0.85rem; background: #0f172a; color: #e2e8f0; padding: 12px; border-radius: 8px; min-height: 120px; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 0.9rem; }
    th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #e5eaf0; }
    .ok { color: #067a3a; } .bad { color: #b42318; }
  </style>
</head>
<body>
  <main>
    <div class="card">
      <h1>TallyPrime bridge</h1>
      <p>No polling. Click the button to download unclaimed / failed / re-queued vouchers from LIMS and push them into TallyPrime on this PC.</p>
      <p class="meta">API: ${API_URL}<br/>Tally: ${TALLY_HOST}${TALLY_COMPANY ? `<br/>Company: ${xmlEscape(TALLY_COMPANY)}` : ""}</p>
      <div class="row">
        <button class="primary" id="pushBtn" type="button">Download &amp; Push to Tally</button>
        <button class="secondary" id="refreshBtn" type="button">Refresh queue</button>
        <span class="meta" id="count">—</span>
      </div>
      <div id="queue"></div>
      <div id="log">Ready.</div>
    </div>
  </main>
  <script>
    const logEl = document.getElementById('log');
    const countEl = document.getElementById('count');
    const queueEl = document.getElementById('queue');
    const pushBtn = document.getElementById('pushBtn');
    const refreshBtn = document.getElementById('refreshBtn');
    function log(msg) { logEl.textContent = msg; }
    async function refresh() {
      const res = await fetch('/api/peek');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'peek failed');
      const rows = json.data || [];
      countEl.textContent = rows.length ? (rows.length + ' waiting') : 'Queue empty';
      if (!rows.length) { queueEl.innerHTML = ''; return; }
      queueEl.innerHTML = '<table><thead><tr><th>Status</th><th>Kind</th><th>Day</th><th>Mode</th><th>Amount</th></tr></thead><tbody>' +
        rows.map(r => '<tr><td>' + (r.status||'') + '</td><td>' + (r.kind||'') + '</td><td>' + (r.day_key||'') + '</td><td>' + (r.mode_key||'') + '</td><td>' + Number(r.amount||0).toFixed(2) + '</td></tr>').join('') +
        '</tbody></table>';
    }
    refreshBtn.onclick = async () => {
      try { await refresh(); log('Queue refreshed.'); } catch (e) { log('Refresh error: ' + e.message); }
    };
    pushBtn.onclick = async () => {
      pushBtn.disabled = true; refreshBtn.disabled = true;
      log('Claiming and pushing…');
      try {
        const res = await fetch('/api/push', { method: 'POST' });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'push failed');
        const lines = (json.results || []).map(r => (r.ok ? '[OK] ' : '[FAIL] ') + r.label + ' Rs ' + Number(r.amount||0).toFixed(2) + (r.error ? (' — ' + r.error) : ''));
        log((json.claimed ? ('Claimed ' + json.claimed + '\\n') : 'Nothing to claim\\n') + (lines.join('\\n') || 'Done.'));
        await refresh();
      } catch (e) {
        log('Push error: ' + e.message);
      } finally {
        pushBtn.disabled = false; refreshBtn.disabled = false;
      }
    };
    refresh().catch(e => log('Startup peek error: ' + e.message));
  </script>
</body>
</html>`;
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url || "/", `http://127.0.0.1:${PORT}`);
    if (req.method === "GET" && u.pathname === "/") {
      const html = pageHtml();
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }
    if (req.method === "GET" && u.pathname === "/api/peek") {
      const data = await peek();
      sendJson(res, 200, { ok: true, count: data.length, data });
      return;
    }
    if (req.method === "POST" && u.pathname === "/api/push") {
      const out = await pushAll();
      sendJson(res, 200, { ok: true, ...out });
      return;
    }
    sendJson(res, 404, { error: "not found" });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    sendJson(res, 500, { error: msg });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Tally bridge UI (no polling) http://127.0.0.1:${PORT}`);
  console.log(`LIMS API ${API_URL} -> Tally ${TALLY_HOST}`);
});
