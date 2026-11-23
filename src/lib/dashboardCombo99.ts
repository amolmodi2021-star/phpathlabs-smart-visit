/** One registration that still has COMBO99 on the bill. */
export type Combo99BillRow = {
  registrationId: string;
  invoiceNumber: string;
  patientName: string;
  title: string | null;
  createdAt: string;
  /** Calendar date in Asia/Kolkata, yyyy-MM-dd. */
  bookedOn: string;
  comboQty: number;
  otherTestCount: number;
  /** Test bill on this invoice after discount, excluding home visit charges. */
  billAmount: number;
};

export type Combo99DateRow = {
  bookedOn: string;
  comboQty: number;
  patients: number;
  billAmount: number;
  withOtherTests: number;
};

export type Combo99Summary = {
  comboQty: number;
  patients: number;
  billAmount: number;
  withOtherTests: number;
  dates: Combo99DateRow[];
};

export function summarizeCombo99(rows: Combo99BillRow[]): Combo99Summary {
  const byDate = new Map<string, Combo99DateRow>();
  let comboQty = 0;
  let patients = 0;
  let billAmount = 0;
  let withOtherTests = 0;

  for (const row of rows) {
    const qty = Number(row.comboQty) || 0;
    const bill = Number(row.billAmount) || 0;
    const others = Number(row.otherTestCount) || 0;
    comboQty += qty;
    patients += 1;
    billAmount += bill;
    if (others > 0) withOtherTests += 1;

    const key = row.bookedOn || "—";
    const prev = byDate.get(key) || {
      bookedOn: key,
      comboQty: 0,
      patients: 0,
      billAmount: 0,
      withOtherTests: 0,
    };
    prev.comboQty += qty;
    prev.patients += 1;
    prev.billAmount += bill;
    if (others > 0) prev.withOtherTests += 1;
    byDate.set(key, prev);
  }

  const dates = Array.from(byDate.values()).sort((a, b) => a.bookedOn.localeCompare(b.bookedOn));
  return { comboQty, patients, billAmount, withOtherTests, dates };
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
    createdAt: String(r.created_at || ""),
    bookedOn: String(r.booked_on || ""),
    comboQty: Number(r.combo_qty || 0) || 0,
    otherTestCount: Number(r.other_test_count || 0) || 0,
    billAmount: Number(r.bill_amount || 0) || 0,
  }));
}
