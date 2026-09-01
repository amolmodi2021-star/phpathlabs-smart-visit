import { supabase } from "@/integrations/supabase/client";
import { getCurrentUserName } from "@/lib/auth";

export type TallyModeKey = "cash" | "gpay" | "paytm" | "neft" | "credit_card";

export type TallyModeMapRow = {
  mode_key: TallyModeKey;
  label: string;
  tally_ledger: string;
  uses_clearing: boolean;
  is_active: boolean;
  sort_order: number;
};

export type TallySettings = {
  id: number;
  company_name: string;
  income_ledger: string;
  mdr_expense_ledger: string;
  default_settlement_bank_ledger: string;
  tally_host: string;
};

export type TallyVoucherLine = {
  ledger: string;
  /** true = debit (ISDEEMEDPOSITIVE Yes in Tally) */
  is_debit: boolean;
  amount: number;
};

export type DayModeAmounts = {
  dayKey: string;
  cash: number;
  gpay: number;
  paytm: number;
  neft: number;
  creditCard: number;
  paid: number;
};

export type CardSettlementRow = {
  id: string;
  day_key: string | null;
  gross: number;
  bank_received: number;
  mdr: number;
  bank_ledger: string;
  settlement_date: string;
  reference_no: string | null;
  notes: string | null;
  status: string;
  outbox_id: string | null;
  created_by: string | null;
  created_at: string;
};

type OutboxJob = {
  id?: string;
  kind: string;
  voucher_type: string;
  voucher_date: string;
  narration: string;
  amount: number;
  lines: TallyVoucherLine[];
  day_key?: string | null;
  mode_key?: string | null;
};

const num = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export const TALLY_MODE_KEYS: TallyModeKey[] = ["cash", "gpay", "paytm", "neft", "credit_card"];

export function amountForMode(row: DayModeAmounts, mode: TallyModeKey): number {
  switch (mode) {
    case "cash":
      return num(row.cash);
    case "gpay":
      return num(row.gpay);
    case "paytm":
      return num(row.paytm);
    case "neft":
      return num(row.neft);
    case "credit_card":
      return num(row.creditCard);
  }
}

export async function getTallySettings(): Promise<TallySettings> {
  const { data, error } = await supabase
    .from("accounts_tally_settings" as any)
    .select("*")
    .eq("id", 1)
    .maybeSingle();
  if (error) throw error;
  return (
    (data as TallySettings) || {
      id: 1,
      company_name: "",
      income_ledger: "Lab Collection",
      mdr_expense_ledger: "Bank Charges",
      default_settlement_bank_ledger: "",
      tally_host: "",
    }
  );
}

export async function saveTallySettings(patch: Partial<TallySettings>) {
  const { error } = await supabase
    .from("accounts_tally_settings" as any)
    .upsert(
      {
        id: 1,
        ...patch,
        updated_at: new Date().toISOString(),
      } as any,
      { onConflict: "id" },
    );
  if (error) throw error;
}

export async function getTallyModeMap(): Promise<TallyModeMapRow[]> {
  const { data, error } = await supabase
    .from("accounts_tally_mode_map" as any)
    .select("*")
    .order("sort_order");
  if (error) throw error;
  return (data || []) as TallyModeMapRow[];
}

export async function saveTallyModeMapRow(row: Partial<TallyModeMapRow> & { mode_key: TallyModeKey }) {
  const { error } = await supabase
    .from("accounts_tally_mode_map" as any)
    .upsert(
      {
        ...row,
        updated_at: new Date().toISOString(),
      } as any,
      { onConflict: "mode_key" },
    );
  if (error) throw error;
}

function receiptLines(opts: {
  moneyLedger: string;
  incomeLedger: string;
  amount: number;
}): TallyVoucherLine[] {
  const amount = num(opts.amount);
  return [
    { ledger: opts.moneyLedger, is_debit: true, amount },
    { ledger: opts.incomeLedger, is_debit: false, amount },
  ];
}

function settlementLines(opts: {
  bankLedger: string;
  mdrLedger: string;
  clearingLedger: string;
  bankReceived: number;
  mdr: number;
  gross: number;
}): TallyVoucherLine[] {
  const lines: TallyVoucherLine[] = [
    { ledger: opts.bankLedger, is_debit: true, amount: num(opts.bankReceived) },
  ];
  if (num(opts.mdr) > 0) {
    lines.push({ ledger: opts.mdrLedger, is_debit: true, amount: num(opts.mdr) });
  }
  lines.push({ ledger: opts.clearingLedger, is_debit: false, amount: num(opts.gross) });
  return lines;
}

function xmlEscape(s: string) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function tallyDate(isoDate: string) {
  return String(isoDate || "").replace(/-/g, "");
}

/** Build TallyPrime Import Data XML for one or more vouchers (no bridge/polling). */
export function buildTallyImportXml(jobs: OutboxJob[], companyName = ""): string {
  const companyBlock = companyName.trim()
    ? `<STATICVARIABLES><SVCURRENTCOMPANY>${xmlEscape(companyName.trim())}</SVCURRENTCOMPANY></STATICVARIABLES>`
    : "";

  const messages = jobs
    .map((job) => {
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

      return `<TALLYMESSAGE xmlns:UDF="TallyUDF">
          <VOUCHER VCHTYPE="${xmlEscape(job.voucher_type || "Receipt")}" ACTION="Create" OBJVIEW="Accounting Voucher View">
            <DATE>${tallyDate(job.voucher_date)}</DATE>
            <NARRATION>${xmlEscape(job.narration)}</NARRATION>
            <VOUCHERTYPENAME>${xmlEscape(job.voucher_type || "Receipt")}</VOUCHERTYPENAME>
            ${entries}
          </VOUCHER>
        </TALLYMESSAGE>`;
    })
    .join("\n");

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
        ${messages}
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>`;
}

function downloadTextFile(filename: string, content: string, mime = "application/xml") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Create day vouchers, download Tally XML for import, mark exported. No polling service. */
export async function queueDayCollectionToTally(
  row: DayModeAmounts,
): Promise<{ queued: number; skipped: number; filename: string }> {
  const [settings, modes] = await Promise.all([getTallySettings(), getTallyModeMap()]);
  if (!settings.income_ledger.trim()) throw new Error("Set Income ledger in Accounts → Settings → Tally");

  const modeByKey = new Map(modes.map((m) => [m.mode_key, m]));
  const who = getCurrentUserName() || "staff";
  let queued = 0;
  let skipped = 0;
  const jobs: OutboxJob[] = [];
  const outboxIds: string[] = [];

  await supabase
    .from("accounts_tally_voucher_outbox" as any)
    .update({
      status: "cancelled",
      last_error: "superseded_by_repush",
      updated_at: new Date().toISOString(),
      claimed_at: null,
      claimed_by: null,
      next_retry_at: null,
    } as any)
    .eq("kind", "collection_receipt")
    .eq("day_key", row.dayKey)
    .in("status", ["pending", "claimed", "sent", "failed"]);

  for (const mode of TALLY_MODE_KEYS) {
    const amount = amountForMode(row, mode);
    if (amount <= 0) {
      skipped++;
      continue;
    }
    const map = modeByKey.get(mode);
    if (!map?.is_active) {
      skipped++;
      continue;
    }
    if (!map.tally_ledger.trim()) {
      throw new Error(`Set Tally ledger for ${map.label} in Accounts → Settings → Tally`);
    }

    const narration = `LIMS daily collection ${row.dayKey} — ${map.label}`;
    const lines = receiptLines({
      moneyLedger: map.tally_ledger.trim(),
      incomeLedger: settings.income_ledger.trim(),
      amount,
    });

    const { data, error } = await supabase
      .from("accounts_tally_voucher_outbox" as any)
      .insert({
        kind: "collection_receipt",
        day_key: row.dayKey,
        mode_key: mode,
        voucher_type: "Receipt",
        voucher_date: row.dayKey,
        narration,
        amount,
        lines,
        status: "pending",
        created_by: who,
      } as any)
      .select("id")
      .single();

    if (error) {
      if (String(error.message || "").toLowerCase().includes("duplicate") || error.code === "23505") {
        skipped++;
        continue;
      }
      throw error;
    }

    jobs.push({
      id: (data as any).id,
      kind: "collection_receipt",
      voucher_type: "Receipt",
      voucher_date: row.dayKey,
      narration,
      amount,
      lines,
      day_key: row.dayKey,
      mode_key: mode,
    });
    outboxIds.push((data as any).id);
    queued++;
  }

  if (queued === 0) {
    throw new Error("Nothing to export (zero amounts or already handled)");
  }

  const filename = `Tally_Collection_${row.dayKey}.xml`;
  const xml = buildTallyImportXml(jobs, settings.company_name);
  downloadTextFile(filename, xml);

  const now = new Date().toISOString();
  if (outboxIds.length) {
    await supabase
      .from("accounts_tally_voucher_outbox" as any)
      .update({
        status: "sent",
        last_error: null,
        tally_response: "exported_xml_download",
        updated_at: now,
        claimed_at: null,
        claimed_by: null,
      } as any)
      .in("id", outboxIds);
  }

  const { data: existing } = await supabase
    .from("accounts_tally_day_status" as any)
    .select("entered_at, entered_by, verify_count")
    .eq("day_key", row.dayKey)
    .maybeSingle();
  const ex = existing as { entered_at?: string; entered_by?: string; verify_count?: number } | null;
  await supabase.from("accounts_tally_day_status" as any).upsert(
    {
      day_key: row.dayKey,
      paid: row.paid,
      cash: row.cash,
      gpay: row.gpay,
      paytm: row.paytm,
      neft: row.neft,
      credit_card: row.creditCard,
      entered_at: ex?.entered_at || now,
      entered_by: ex?.entered_by || who,
      last_verified_at: now,
      last_verified_by: who,
      verify_count: (ex?.verify_count || 0) + 1,
      updated_at: now,
    } as any,
    { onConflict: "day_key" },
  );

  return { queued, skipped, filename };
}

export async function listCardSettlements(): Promise<CardSettlementRow[]> {
  const { data, error } = await supabase
    .from("accounts_tally_card_settlements" as any)
    .select("*")
    .order("settlement_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  return (data || []) as CardSettlementRow[];
}

export async function getOpenCardClearingBalance(): Promise<{
  pushedGross: number;
  settledGross: number;
  openGross: number;
}> {
  const { data: pushed, error: e1 } = await supabase
    .from("accounts_tally_voucher_outbox" as any)
    .select("amount")
    .eq("kind", "collection_receipt")
    .eq("mode_key", "credit_card")
    .in("status", ["pending", "claimed", "sent"]);
  if (e1) throw e1;

  const { data: settled, error: e2 } = await supabase
    .from("accounts_tally_card_settlements" as any)
    .select("gross")
    .in("status", ["saved", "queued", "posted"]);
  if (e2) throw e2;

  const pushedGross = num((pushed || []).reduce((s: number, r: any) => s + Number(r.amount || 0), 0));
  const settledGross = num((settled || []).reduce((s: number, r: any) => s + Number(r.gross || 0), 0));
  return {
    pushedGross,
    settledGross,
    openGross: num(Math.max(0, pushedGross - settledGross)),
  };
}

export async function saveCardSettlement(input: {
  dayKey?: string | null;
  gross: number;
  bankReceived: number;
  bankLedger: string;
  settlementDate: string;
  referenceNo?: string;
  notes?: string;
}): Promise<CardSettlementRow> {
  const gross = num(input.gross);
  const bankReceived = num(input.bankReceived);
  if (gross <= 0) throw new Error("Gross must be greater than 0");
  if (bankReceived < 0) throw new Error("Bank received cannot be negative");
  if (bankReceived > gross) throw new Error("Bank received cannot exceed gross");
  if (!input.bankLedger.trim()) throw new Error("Bank ledger is required");

  const open = await getOpenCardClearingBalance();
  if (gross > open.openGross + 0.005) {
    throw new Error(`Gross exceeds open clearing (\u20b9${open.openGross.toFixed(2)})`);
  }

  const mdr = num(gross - bankReceived);
  const who = getCurrentUserName() || "staff";
  const { data, error } = await supabase
    .from("accounts_tally_card_settlements" as any)
    .insert({
      day_key: input.dayKey || null,
      gross,
      bank_received: bankReceived,
      mdr,
      bank_ledger: input.bankLedger.trim(),
      settlement_date: input.settlementDate,
      reference_no: input.referenceNo?.trim() || null,
      notes: input.notes?.trim() || null,
      status: "saved",
      created_by: who,
    } as any)
    .select("*")
    .single();
  if (error) throw error;
  return data as CardSettlementRow;
}

/** Export settlement journal XML for Tally import. No polling service. */
export async function pushCardSettlementToTally(settlementId: string): Promise<{ filename: string }> {
  const [settings, modes] = await Promise.all([getTallySettings(), getTallyModeMap()]);
  const clearing = modes.find((m) => m.mode_key === "credit_card");
  if (!clearing?.tally_ledger.trim()) throw new Error("Set Credit Card clearing ledger in Tally settings");
  if (!settings.mdr_expense_ledger.trim()) throw new Error("Set MDR / Bank Charges ledger in Tally settings");

  const { data: row, error } = await supabase
    .from("accounts_tally_card_settlements" as any)
    .select("*")
    .eq("id", settlementId)
    .single();
  if (error) throw error;
  const s = row as CardSettlementRow;
  if (s.status === "queued" || s.status === "posted") {
    throw new Error("Settlement already exported");
  }

  const who = getCurrentUserName() || "staff";
  const lines = settlementLines({
    bankLedger: s.bank_ledger,
    mdrLedger: settings.mdr_expense_ledger.trim(),
    clearingLedger: clearing.tally_ledger.trim(),
    bankReceived: Number(s.bank_received),
    mdr: Number(s.mdr),
    gross: Number(s.gross),
  });

  const narration =
    `LIMS card settlement ${s.settlement_date}` +
    (s.reference_no ? ` — ${s.reference_no}` : "") +
    (s.day_key ? ` (collection ${s.day_key})` : "");

  const { data: outbox, error: oErr } = await supabase
    .from("accounts_tally_voucher_outbox" as any)
    .insert({
      kind: "card_settlement",
      day_key: s.day_key,
      mode_key: "credit_card",
      settlement_id: s.id,
      voucher_type: "Journal",
      voucher_date: s.settlement_date,
      narration,
      amount: Number(s.gross),
      lines,
      status: "sent",
      tally_response: "exported_xml_download",
      created_by: who,
    } as any)
    .select("id")
    .single();
  if (oErr) throw oErr;

  const job: OutboxJob = {
    id: (outbox as any).id,
    kind: "card_settlement",
    voucher_type: "Journal",
    voucher_date: s.settlement_date,
    narration,
    amount: Number(s.gross),
    lines,
    day_key: s.day_key,
    mode_key: "credit_card",
  };
  const filename = `Tally_CardSettlement_${s.settlement_date}_${s.id.slice(0, 8)}.xml`;
  downloadTextFile(filename, buildTallyImportXml([job], settings.company_name));

  const { error: uErr } = await supabase
    .from("accounts_tally_card_settlements" as any)
    .update({
      status: "posted",
      outbox_id: (outbox as any).id,
      updated_at: new Date().toISOString(),
    } as any)
    .eq("id", settlementId);
  if (uErr) throw uErr;

  return { filename };
}

export async function listRecentTallyOutbox(limit = 50) {
  const { data, error } = await supabase
    .from("accounts_tally_voucher_outbox" as any)
    .select("id, kind, day_key, mode_key, voucher_type, voucher_date, amount, status, last_error, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}
