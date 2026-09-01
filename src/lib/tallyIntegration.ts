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
      tally_host: "http://localhost:9000",
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

/** Receipt: Account = money/bank ledger (Dr), Particulars = sales/mode ledger (Cr). */
export function buildCollectionReceiptLines(opts: {
  mode: TallyModeKey;
  modeLedger: string;
  bankLedger: string;
  amount: number;
}): TallyVoucherLine[] {
  const amount = num(opts.amount);
  const modeLedger = opts.modeLedger.trim();
  const bankLedger = opts.bankLedger.trim();
  if (!modeLedger) throw new Error("Mode ledger is required");
  // Cash: Dr Cash / Cr Cash Sales (mapped). Others: Dr Axis bank / Cr mapped mode ledger.
  const accountLedger = opts.mode === "cash" ? "Cash" : bankLedger;
  const particularsLedger = modeLedger;
  if (!accountLedger) throw new Error("Bank ledger is required for non-cash receipts");
  if (accountLedger.toLowerCase() === particularsLedger.toLowerCase()) {
    throw new Error(`Account and Particulars cannot be the same ledger (${accountLedger})`);
  }
  // Hard guard against the flipped mapping that broke bulk push.
  if (opts.mode === "cash" && accountLedger !== "Cash") {
    throw new Error("Cash receipts must debit Cash");
  }
  if (opts.mode !== "cash" && accountLedger.toLowerCase() === modeLedger.toLowerCase()) {
    throw new Error("Non-cash receipts must debit the bank ledger, not the mode ledger");
  }
  return [
    { ledger: accountLedger, is_debit: true, amount },
    { ledger: particularsLedger, is_debit: false, amount },
  ];
}

function receiptLines(opts: {
  accountLedger: string;
  particularsLedger: string;
  amount: number;
}): TallyVoucherLine[] {
  const amount = num(opts.amount);
  return [
    { ledger: opts.accountLedger, is_debit: true, amount },
    { ledger: opts.particularsLedger, is_debit: false, amount },
  ];
}


/** Queue one receipt voucher per payment mode with amount > 0 for the day. */

export async function queueDayCollectionToTally(row: DayModeAmounts): Promise<{ queued: number; skipped: number }> {
  const [settings, modes] = await Promise.all([getTallySettings(), getTallyModeMap()]);
  const modeByKey = new Map(modes.map((m) => [m.mode_key, m]));
  const who = getCurrentUserName() || "staff";
  let queued = 0;
  let skipped = 0;

  // Allow re-push after amount drift: cancel prior collection jobs for this day.
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
      throw new Error(`Set Tally ledger for ${map.label} in Accounts -> Settings -> Tally`);
    }

    const modeLedger = map.tally_ledger.trim();
    // Cash: Account = Cash, Particulars = Cash Sales (mapped).
    // Other modes: Account = bank ledger (Axis Bank Ltd.), Particulars = mode ledger.
    const bankLedger =
      settings.default_settlement_bank_ledger.trim() || settings.income_ledger.trim();
    if (mode !== "cash" && !bankLedger) {
      throw new Error("Set bank ledger (Axis Bank Ltd.) in Accounts -> Settings -> Tally");
    }
    const narration = `LIMS daily collection ${row.dayKey} - ${map.label}`;
    const lines = buildCollectionReceiptLines({
      mode,
      modeLedger,
      bankLedger,
      amount,
    });

    const { error } = await supabase.from("accounts_tally_voucher_outbox" as any).insert({
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
    } as any);

    if (error) {
      if (String(error.message || "").toLowerCase().includes("duplicate") || error.code === "23505") {
        skipped++;
        continue;
      }
      throw error;
    }
    queued++;
  }

  if (queued === 0 && skipped > 0) {
    throw new Error("Nothing new to queue (already pushed or zero amounts)");
  }

  // Snapshot as Entered once vouchers are queued (bridge will post asynchronously).
  const now = new Date().toISOString();
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

  return { queued, skipped };
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
