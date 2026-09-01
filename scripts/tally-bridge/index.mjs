/**
 * Windows TallyPrime bridge — run on the PC where TallyPrime is open.
 *
 * Usage:
 *   set DESKTOP_API_URL=https://gqpqnfvihjjkmbcdzate.supabase.co/functions/v1/desktop-api
 *   set DESKTOP_API_KEY=your_desktop_api_key
 *   set TALLY_HOST=http://localhost:9000
 *   set TALLY_COMPANY=Your Company Name
 *   node scripts/tally-bridge/index.mjs
 */
const API_URL = (process.env.DESKTOP_API_URL || "").replace(/\/$/, "");
const API_KEY = process.env.DESKTOP_API_KEY || "";
const TALLY_HOST = (process.env.TALLY_HOST || "http://localhost:9000").replace(/\/$/, "");
const TALLY_COMPANY = process.env.TALLY_COMPANY || "";
const POLL_MS = Number(process.env.TALLY_POLL_MS || 5000);

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

async function tick() {
  const claimed = await api("claim_tally_outbox", { limit: 5, claimed_by: "tally-bridge" });
  const jobs = claimed.data || [];
  if (!jobs.length) return;

  for (const job of jobs) {
    try {
      const xml = buildVoucherXml(job);
      const tallyResponse = await postToTally(xml);
      await api("complete_tally_outbox", {
        id: job.id,
        status: "sent",
        tally_response: tallyResponse.slice(0, 2000),
      });
      console.log(`[sent] ${job.kind} ${job.day_key || ""} ${job.mode_key || ""} Rs ${job.amount}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await api("complete_tally_outbox", {
        id: job.id,
        status: "failed",
        error: msg.slice(0, 500),
      });
      console.error(`[failed] ${job.id}: ${msg}`);
    }
  }
}

console.log(`Tally bridge polling ${API_URL} -> ${TALLY_HOST}`);
setInterval(() => {
  tick().catch((e) => console.error("tick error", e));
}, POLL_MS);
tick().catch((e) => console.error("tick error", e));
