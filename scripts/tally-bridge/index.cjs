/**
 * PH PathLabs — TallyPrime bridge (button-driven, no polling)
 * Packaged as Windows EXE for the PC where TallyPrime is open.
 */
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { URL } = require("node:url");
const { exec } = require("node:child_process");

function appDir() {
  // When packaged with pkg, use the folder containing the EXE.
  if (process.pkg) return path.dirname(process.execPath);
  return __dirname;
}

function configPath() {
  return path.join(appDir(), "tally-bridge.config.json");
}

function defaultConfig() {
  return {
    desktop_api_url: "https://gqpqnfvihjjkmbcdzate.supabase.co/functions/v1/desktop-api",
    desktop_api_key: "",
    tally_host: "http://localhost:9000",
    tally_company: "",
    bridge_port: 8787,
  };
}

function loadConfig() {
  const file = configPath();
  let cfg = defaultConfig();
  try {
    if (fs.existsSync(file)) {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
      cfg = { ...cfg, ...parsed };
    } else {
      fs.writeFileSync(file, JSON.stringify(cfg, null, 2), "utf8");
    }
  } catch (e) {
    console.error("Config read failed:", e.message || e);
  }
  // Env overrides (optional)
  if (process.env.DESKTOP_API_URL) cfg.desktop_api_url = process.env.DESKTOP_API_URL;
  if (process.env.DESKTOP_API_KEY) cfg.desktop_api_key = process.env.DESKTOP_API_KEY;
  if (process.env.TALLY_HOST) cfg.tally_host = process.env.TALLY_HOST;
  if (process.env.TALLY_COMPANY) cfg.tally_company = process.env.TALLY_COMPANY;
  if (process.env.TALLY_BRIDGE_PORT) cfg.bridge_port = Number(process.env.TALLY_BRIDGE_PORT);
  cfg.desktop_api_url = String(cfg.desktop_api_url || "").replace(/\/$/, "");
  cfg.tally_host = String(cfg.tally_host || "http://localhost:9000").replace(/\/$/, "");
  cfg.bridge_port = Number(cfg.bridge_port || 8787);
  return cfg;
}

function saveConfig(patch) {
  const cfg = { ...loadConfig(), ...patch };
  fs.writeFileSync(configPath(), JSON.stringify(cfg, null, 2), "utf8");
  return loadConfig();
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

function buildVoucherXml(job, company) {
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

  const companyBlock = company
    ? `<STATICVARIABLES><SVCURRENTCOMPANY>${xmlEscape(company)}</SVCURRENTCOMPANY></STATICVARIABLES>`
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
            <PARTYLEDGERNAME>${xmlEscape((lines.find((l) => l.is_debit) || lines[0] || {}).ledger || "")}</PARTYLEDGERNAME>
            <PERSISTEDVIEW>Accounting Voucher View</PERSISTEDVIEW>
            ${entries}
          </VOUCHER>
        </TALLYMESSAGE>
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>`;
}

async function api(cfg, action, body = {}) {
  if (!cfg.desktop_api_url || !cfg.desktop_api_key) {
    throw new Error("Set Desktop API URL and API Key in Settings (or tally-bridge.config.json)");
  }
  const res = await fetch(cfg.desktop_api_url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": cfg.desktop_api_key,
    },
    body: JSON.stringify({ action, ...body }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `API ${res.status}`);
  return json;
}

async function postToTally(cfg, xml) {
  const res = await fetch(cfg.tally_host, {
    method: "POST",
    headers: { "Content-Type": "application/xml" },
    body: xml,
  });
  const text = await res.text();
  const lineErr = text.match(/<LINEERROR>([^<]+)<\/LINEERROR>/i);
  if (lineErr && lineErr[1].trim()) {
    throw new Error(lineErr[1].trim());
  }
  const created = Number((text.match(/<CREATED>(\d+)<\/CREATED>/i) || [])[1] || 0);
  const altered = Number((text.match(/<ALTERED>(\d+)<\/ALTERED>/i) || [])[1] || 0);
  const errors = Number((text.match(/<ERRORS>(\d+)<\/ERRORS>/i) || [])[1] || 0);
  const exceptions = Number((text.match(/<EXCEPTIONS>(\d+)<\/EXCEPTIONS>/i) || [])[1] || 0);
  if (errors > 0 || exceptions > 0 || (created + altered) < 1) {
    throw new Error(
      `Tally did not create voucher (CREATED=${created}, ALTERED=${altered}, ERRORS=${errors}). ` +
        `Create missing ledgers in Tally (Cash, GPay, Paytm, NEFT, Credit Card Clearing, Lab Collection) then push again. ` +
        `Also check Import > Exceptions in Tally.`,
    );
  }
  return text;
}

async function peek(cfg) {
  const res = await api(cfg, "peek_tally_outbox");
  return res.data || [];
}

async function pushAll(cfg) {
  const claimed = await api(cfg, "claim_tally_outbox", { limit: 50, claimed_by: "tally-bridge-exe" });
  const jobs = claimed.data || [];
  const results = [];
  for (const job of jobs) {
    try {
      const xml = buildVoucherXml(job, cfg.tally_company);
      const tallyResponse = await postToTally(cfg, xml);
      await api(cfg, "complete_tally_outbox", {
        id: job.id,
        status: "sent",
        tally_response: String(tallyResponse).slice(0, 2000),
      });
      results.push({
        id: job.id,
        ok: true,
        label: `${job.kind} ${job.day_key || ""} ${job.mode_key || ""}`.trim(),
        amount: job.amount,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await api(cfg, "complete_tally_outbox", {
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

function pageHtml(cfg) {
  const keySet = cfg.desktop_api_key ? "Yes (hidden)" : "Missing — open Settings";
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>PH PathLabs - Tally Bridge</title>
  <style>
    :root { color-scheme: light; font-family: Segoe UI, system-ui, sans-serif; }
    body { margin: 0; background: #f4f6f8; color: #1a1a1a; }
    main { max-width: 780px; margin: 36px auto; padding: 0 16px; }
    h1 { font-size: 1.35rem; margin: 0 0 8px; }
    p { color: #555; line-height: 1.45; }
    .card { background: #fff; border: 1px solid #dde3ea; border-radius: 10px; padding: 20px; margin-bottom: 14px; }
    .row { display: flex; gap: 12px; flex-wrap: wrap; align-items: center; margin-top: 16px; }
    button, .btn {
      appearance: none; border: 0; border-radius: 8px; padding: 12px 18px;
      font-size: 1rem; font-weight: 600; cursor: pointer; text-decoration: none; display: inline-block;
    }
    button.primary, .btn.primary { background: #0b6bcb; color: #fff; }
    button.secondary, .btn.secondary { background: #e8eef5; color: #123; }
    button:disabled { opacity: 0.55; cursor: not-allowed; }
    .meta { font-size: 0.9rem; color: #666; }
    label { display:block; font-size: 0.85rem; margin: 10px 0 4px; color: #333; }
    input { width: 100%; box-sizing: border-box; padding: 10px 12px; border: 1px solid #c9d4e0; border-radius: 8px; font-size: 0.95rem; }
    #log { margin-top: 16px; white-space: pre-wrap; font-family: Consolas, monospace; font-size: 0.85rem; background: #0f172a; color: #e2e8f0; padding: 12px; border-radius: 8px; min-height: 120px; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 0.9rem; }
    th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #e5eaf0; }
    .warn { color: #9a3412; background: #ffedd5; padding: 8px 10px; border-radius: 8px; font-size: 0.9rem; }
  </style>
</head>
<body>
  <main>
    <div class="card">
      <h1>TallyPrime bridge</h1>
      <p>No polling. Click the button to download unclaimed / failed / re-queued vouchers from LIMS and push them into TallyPrime on this PC.</p>
      <p class="meta">API: ${xmlEscape(cfg.desktop_api_url)}<br/>Tally: ${xmlEscape(cfg.tally_host)}${cfg.tally_company ? `<br/>Company: ${xmlEscape(cfg.tally_company)}` : ""}<br/>API key: ${keySet}</p>
      ${!cfg.desktop_api_key ? '<p class="warn">API key is missing. Open Settings below, paste DESKTOP_API_KEY, Save, then push.</p>' : ""}
      <div class="row">
        <button class="primary" id="pushBtn" type="button">Download &amp; Push to Tally</button>
        <button class="secondary" id="refreshBtn" type="button">Refresh queue</button>
        <a class="btn secondary" href="#settings">Settings</a>
        <span class="meta" id="count">-</span>
      </div>
      <div id="queue"></div>
      <div id="log">Ready.</div>
    </div>

    <div class="card" id="settings">
      <h1>Settings</h1>
      <p class="meta">Saved next to the EXE as <code>tally-bridge.config.json</code>.</p>
      <label>Desktop API URL</label>
      <input id="apiUrl" value="${xmlEscape(cfg.desktop_api_url)}" />
      <label>Desktop API Key</label>
      <input id="apiKey" type="password" value="${xmlEscape(cfg.desktop_api_key)}" placeholder="paste DESKTOP_API_KEY" />
      <label>Tally host</label>
      <input id="tallyHost" value="${xmlEscape(cfg.tally_host)}" />
      <label>Tally company name (exact)</label>
      <input id="tallyCompany" value="${xmlEscape(cfg.tally_company)}" />
      <label>Bridge port</label>
      <input id="bridgePort" value="${xmlEscape(String(cfg.bridge_port))}" />
      <div class="row">
        <button class="primary" id="saveBtn" type="button">Save settings</button>
      </div>
    </div>
  </main>
  <script>
    const logEl = document.getElementById('log');
    const countEl = document.getElementById('count');
    const queueEl = document.getElementById('queue');
    const pushBtn = document.getElementById('pushBtn');
    const refreshBtn = document.getElementById('refreshBtn');
    const saveBtn = document.getElementById('saveBtn');
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
      log('Claiming and pushing...');
      try {
        const res = await fetch('/api/push', { method: 'POST' });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'push failed');
        const lines = (json.results || []).map(r => (r.ok ? '[OK] ' : '[FAIL] ') + r.label + ' Rs ' + Number(r.amount||0).toFixed(2) + (r.error ? (' - ' + r.error) : ''));
        log((json.claimed ? ('Claimed ' + json.claimed + '\\n') : 'Nothing to claim\\n') + (lines.join('\\n') || 'Done.'));
        await refresh();
      } catch (e) {
        log('Push error: ' + e.message);
      } finally {
        pushBtn.disabled = false; refreshBtn.disabled = false;
      }
    };
    saveBtn.onclick = async () => {
      const body = {
        desktop_api_url: document.getElementById('apiUrl').value.trim(),
        desktop_api_key: document.getElementById('apiKey').value.trim(),
        tally_host: document.getElementById('tallyHost').value.trim(),
        tally_company: document.getElementById('tallyCompany').value.trim(),
        bridge_port: Number(document.getElementById('bridgePort').value || 8787),
      };
      const res = await fetch('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const json = await res.json();
      if (!res.ok) { log('Save error: ' + (json.error || 'failed')); return; }
      log('Settings saved. If you changed the port, restart the bridge EXE.');
      location.reload();
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

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function openBrowser(url) {
  exec(`cmd /c start "" "${url}"`, () => {});
}

function startServer() {
  const cfg0 = loadConfig();
  const PORT = cfg0.bridge_port || 8787;

  const server = http.createServer(async (req, res) => {
    try {
      const u = new URL(req.url || "/", `http://127.0.0.1:${PORT}`);
      const cfg = loadConfig();

      if (req.method === "GET" && u.pathname === "/") {
        const html = pageHtml(cfg);
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(html);
        return;
      }
      if (req.method === "GET" && u.pathname === "/api/peek") {
        const data = await peek(cfg);
        sendJson(res, 200, { ok: true, count: data.length, data });
        return;
      }
      if (req.method === "POST" && u.pathname === "/api/push") {
        const out = await pushAll(cfg);
        sendJson(res, 200, { ok: true, ...out });
        return;
      }
      if (req.method === "GET" && u.pathname === "/api/config") {
        sendJson(res, 200, {
          ok: true,
          data: {
            ...cfg,
            desktop_api_key: cfg.desktop_api_key ? "********" : "",
          },
        });
        return;
      }
      if (req.method === "POST" && u.pathname === "/api/config") {
        const body = await readBody(req);
        const saved = saveConfig({
          desktop_api_url: String(body.desktop_api_url || "").trim(),
          desktop_api_key: String(body.desktop_api_key || "").trim(),
          tally_host: String(body.tally_host || "").trim() || "http://localhost:9000",
          tally_company: String(body.tally_company || "").trim(),
          bridge_port: Number(body.bridge_port || 8787),
        });
        sendJson(res, 200, { ok: true, data: { ...saved, desktop_api_key: saved.desktop_api_key ? "********" : "" } });
        return;
      }
      sendJson(res, 404, { error: "not found" });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      sendJson(res, 500, { error: msg });
    }
  });

  server.listen(PORT, "127.0.0.1", () => {
    const url = `http://127.0.0.1:${PORT}`;
    console.log(`Tally bridge UI (no polling) ${url}`);
    console.log(`Config: ${configPath()}`);
    console.log(`LIMS API ${cfg0.desktop_api_url} -> Tally ${cfg0.tally_host}`);
    openBrowser(url);
  });
}

startServer();
