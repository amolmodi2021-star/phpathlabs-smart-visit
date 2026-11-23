/** One visit in the selected dates for a patient who has booked COMBO99 at least once. */
export type Combo99BillRow = {
  registrationId: string;
  invoiceNumber: string;
  patientName: string;
  title: string | null;
  /** Blank when this bill has no UMR. */
  umrNumber: string;
  createdAt: string;
  /** Calendar date in Asia/Kolkata, yyyy-MM-dd. */
  bookedOn: string;
  comboQty: number;
  otherTestCount: number;
  /** Billed amount of the COMBO99 lines on this visit. Zero on a return visit. */
  comboAmount: number;
  /** This visit's test bill after discount, excluding home visit charges. */
  billAmount: number;
  /** Every test bill for this UMR. Same value on each of that patient's visits. */
  lifetimeBill: number;
  lifetimeVisits: number;
  /** Later bill for the same UMR, whether or not this bill includes COMBO99. */
  isReturn: boolean;
};

export type Combo99DateRow = {
  bookedOn: string;
  comboQty: number;
  visits: number;
  patients: number;
  comboBills: number;
  returnBills: number;
  comboValue: number;
  extraRevenue: number;
  totalRevenue: number;
};

export type Combo99Summary = {
  comboQty: number;
  patients: number;
  visits: number;
  /** Bills in the selected dates that include COMBO99. */
  comboBills: number;
  /** Later bills of the same UMR in the selected dates, with or without COMBO99. */
  returnBills: number;
  /** COMBO99 line value on bills that include COMBO99. */
  comboValue: number;
  /** Other tests on those same COMBO99 bills. */
  extraRevenue: number;
  /** Full test bill of invoices that include COMBO99. Return visits are not included. */
  totalRevenue: number;
  /** Every test bill for those UMRs, with and without COMBO99. */
  lifetimeBill: number;
  dates: Combo99DateRow[];
};

export function combo99VisitSplit(row: Pick<Combo99BillRow, "comboQty" | "comboAmount" | "billAmount">): {
  combo: number;
  extra: number;
  total: number;
} {
  const bill = Math.max(0, Number(row.billAmount) || 0);
  if ((Number(row.comboQty) || 0) <= 0) return { combo: 0, extra: 0, total: 0 };
  const combo = Math.min(Math.max(Number(row.comboAmount) || 0, 0), bill);
  return { combo, extra: bill - combo, total: bill };
}

export function combo99PatientKey(row: Pick<Combo99BillRow, "umrNumber" | "registrationId">): string {
  const umr = String(row.umrNumber || "").trim().toUpperCase();
  return umr || `reg:${row.registrationId}`;
}

export function summarizeCombo99(rows: Combo99BillRow[]): Combo99Summary {
  const byDate = new Map<string, Combo99DateRow & { keys: Set<string> }>();
  const seenPatients = new Map<string, number>();
  let comboQty = 0;
  let comboBills = 0;
  let returnBills = 0;
  let comboValue = 0;
  let extraRevenue = 0;
  let totalRevenue = 0;

  for (const row of rows) {
    const qty = Number(row.comboQty) || 0;
    const split = combo99VisitSplit(row);
    const combo = split.combo;
    const extra = split.extra;
    const key = combo99PatientKey(row);
    comboQty += qty;
    if (qty > 0) comboBills += 1;
    if (row.isReturn) returnBills += 1;
    if (qty > 0) {
      comboValue += combo;
      extraRevenue += extra;
      totalRevenue += split.total;
    }
    if (!seenPatients.has(key)) seenPatients.set(key, Number(row.lifetimeBill) || 0);

    const dayKey = row.bookedOn || "—";
    const prev = byDate.get(dayKey) || {
      bookedOn: dayKey,
      comboQty: 0,
      visits: 0,
      patients: 0,
      comboBills: 0,
      returnBills: 0,
      comboValue: 0,
      extraRevenue: 0,
      totalRevenue: 0,
      keys: new Set<string>(),
    };
    prev.comboQty += qty;
    prev.visits += 1;
    if (qty > 0) prev.comboBills += 1;
    if (row.isReturn) prev.returnBills += 1;
    if (qty > 0) {
      prev.comboValue += combo;
      prev.extraRevenue += extra;
      prev.totalRevenue += split.total;
    }
    prev.keys.add(key);
    prev.patients = prev.keys.size;
    byDate.set(dayKey, prev);
  }

  const dates = Array.from(byDate.values())
    .sort((a, b) => a.bookedOn.localeCompare(b.bookedOn))
    .map(({ keys: _keys, ...day }) => day);

  let lifetimeBill = 0;
  for (const value of seenPatients.values()) lifetimeBill += value;

  return {
    comboQty,
    patients: seenPatients.size,
    visits: rows.length,
    comboBills,
    returnBills,
    comboValue,
    extraRevenue,
    totalRevenue,
    lifetimeBill,
    dates,
  };
}

export async function fetchCombo99Bills(fromIso: string, toIso: string): Promise<Combo99BillRow[]> {
  const { supabase } = await import("@/integrations/supabase/client");
  const { data, error } = await (supabase as any).rpc("dashboard_combo99_bills", {
    p_from: fromIso,
    p_to: toIso,
  });
  if (error) throw error;
  return ((data || []) as any[]).map((r) => ({
    registrationId: String(r.registration_id || ""),
    invoiceNumber: String(r.invoice_number || "—"),
    patientName: String(r.patient_name || "—"),
    title: r.title ?? null,
    umrNumber: String(r.umr_number || ""),
    createdAt: String(r.created_at || ""),
    bookedOn: String(r.booked_on || ""),
    comboQty: Number(r.combo_qty || 0) || 0,
    otherTestCount: Number(r.other_test_count || 0) || 0,
    comboAmount: Number(r.combo_amount || 0) || 0,
    billAmount: Number(r.bill_amount || 0) || 0,
    lifetimeBill: Number(r.lifetime_bill || 0) || 0,
    lifetimeVisits: Number(r.lifetime_visits || 0) || 0,
    isReturn: r.is_return === true,
  }));
}
