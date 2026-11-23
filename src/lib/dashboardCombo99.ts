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
  /** This visit's test bill after discount, excluding home visit charges. */
  billAmount: number;
  /** Every test bill for this UMR. Same value on each of that patient's visits. */
  lifetimeBill: number;
  lifetimeVisits: number;
};

export type Combo99DateRow = {
  bookedOn: string;
  comboQty: number;
  visits: number;
  patients: number;
  returnVisits: number;
  billAmount: number;
  withOtherTests: number;
};

export type Combo99Summary = {
  comboQty: number;
  patients: number;
  visits: number;
  returnVisits: number;
  billAmount: number;
  lifetimeBill: number;
  withOtherTests: number;
  dates: Combo99DateRow[];
};

export function combo99PatientKey(row: Pick<Combo99BillRow, "umrNumber" | "registrationId">): string {
  const umr = String(row.umrNumber || "").trim().toUpperCase();
  return umr || `reg:${row.registrationId}`;
}

export function summarizeCombo99(rows: Combo99BillRow[]): Combo99Summary {
  const byDate = new Map<string, Combo99DateRow & { keys: Set<string> }>();
  const seenPatients = new Map<string, number>();
  let comboQty = 0;
  let returnVisits = 0;
  let billAmount = 0;
  let withOtherTests = 0;

  for (const row of rows) {
    const qty = Number(row.comboQty) || 0;
    const bill = Number(row.billAmount) || 0;
    const others = Number(row.otherTestCount) || 0;
    const key = combo99PatientKey(row);
    comboQty += qty;
    billAmount += bill;
    if (qty <= 0) returnVisits += 1;
    if (others > 0) withOtherTests += 1;
    if (!seenPatients.has(key)) seenPatients.set(key, Number(row.lifetimeBill) || 0);

    const dayKey = row.bookedOn || "—";
    const prev = byDate.get(dayKey) || {
      bookedOn: dayKey,
      comboQty: 0,
      visits: 0,
      patients: 0,
      returnVisits: 0,
      billAmount: 0,
      withOtherTests: 0,
      keys: new Set<string>(),
    };
    prev.comboQty += qty;
    prev.visits += 1;
    prev.billAmount += bill;
    if (qty <= 0) prev.returnVisits += 1;
    if (others > 0) prev.withOtherTests += 1;
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
    returnVisits,
    billAmount,
    lifetimeBill,
    withOtherTests,
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
    billAmount: Number(r.bill_amount || 0) || 0,
    lifetimeBill: Number(r.lifetime_bill || 0) || 0,
    lifetimeVisits: Number(r.lifetime_visits || 0) || 0,
  }));
}
