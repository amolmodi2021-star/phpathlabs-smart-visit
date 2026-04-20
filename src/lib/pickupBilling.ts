import { supabase } from "@/integrations/supabase/client";
import { format, startOfMonth, endOfMonth, subMonths } from "date-fns";

export interface CreditPickup {
  id: string;
  name: string;
  phone: string | null;
  address: string | null;
  contact_person: string | null;
  default_discount_pct: number;
}

export interface EligibleRegistration {
  id: string;
  invoice_number: string;
  patient_name: string | null;
  created_at: string;
  net_amount: number;
  final_amount: number;
  tests: any[];
}

export interface PickupInvoice {
  id: string;
  invoice_number: string;
  pickup_point_id: string;
  invoice_month: number;
  invoice_year: number;
  period_from: string;
  period_to: string;
  patient_count: number;
  total_amount: number;
  paid_amount: number;
  due_amount: number;
  status: string;
  no_reminder: boolean;
  reminder_days: number | null;
  last_reminder_sent_at: string | null;
  notes: string | null;
  created_at: string;
}

export const defaultPreviousMonthRange = () => {
  const prev = subMonths(new Date(), 1);
  return {
    from: format(startOfMonth(prev), "yyyy-MM-dd"),
    to: format(endOfMonth(prev), "yyyy-MM-dd"),
  };
};

export async function getCreditPickupPoints(): Promise<CreditPickup[]> {
  const { data, error } = await supabase
    .from("pickup_points")
    .select("id, name, phone, address, contact_person, default_discount_pct")
    .eq("billing_type", "credit")
    .eq("status", "active")
    .order("name");
  if (error) throw error;
  return (data || []) as CreditPickup[];
}

export async function getEligibleRegistrations(
  pickupPointId: string,
  fromDate: string,
  toDate: string,
): Promise<EligibleRegistration[]> {
  // Already-invoiced registration ids (for ANY invoice — to avoid double billing)
  const { data: invoiced } = await supabase
    .from("pickup_point_invoice_items")
    .select("registration_id");
  const invoicedIds = new Set((invoiced || []).map((r: any) => r.registration_id).filter(Boolean));

  const { data, error } = await supabase
    .from("patient_registrations")
    .select("id, invoice_number, patient_name, created_at, net_amount, final_amount, tests")
    .eq("pickup_point_id", pickupPointId)
    .eq("bill_cancelled", false)
    .gte("created_at", `${fromDate}T00:00:00`)
    .lte("created_at", `${toDate}T23:59:59`)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return ((data || []) as any[]).filter((r) => !invoicedIds.has(r.id)) as EligibleRegistration[];
}

export async function generateInvoicesForPickups(
  pickupPointIds: string[],
  fromDate: string,
  toDate: string,
): Promise<{ created: number; skipped: number; invoiceIds: string[] }> {
  const invoiceMonth = new Date(fromDate).getMonth() + 1;
  const invoiceYear = new Date(fromDate).getFullYear();
  let created = 0;
  let skipped = 0;
  const invoiceIds: string[] = [];

  for (const ppId of pickupPointIds) {
    const regs = await getEligibleRegistrations(ppId, fromDate, toDate);
    if (regs.length === 0) {
      skipped++;
      continue;
    }
    const total = regs.reduce((s, r) => s + Number(r.final_amount || r.net_amount || 0), 0);

    const { data: inv, error: invErr } = await supabase
      .from("pickup_point_invoices")
      .insert({
        pickup_point_id: ppId,
        invoice_month: invoiceMonth,
        invoice_year: invoiceYear,
        period_from: fromDate,
        period_to: toDate,
        patient_count: regs.length,
        total_amount: total,
      } as any)
      .select()
      .single();
    if (invErr) throw invErr;

    const items = regs.map((r, i) => ({
      invoice_id: inv.id,
      registration_id: r.id,
      registration_invoice: r.invoice_number,
      registration_date: r.created_at.slice(0, 10),
      patient_name: r.patient_name,
      test_names: Array.isArray(r.tests)
        ? r.tests.map((t: any) => t.test_name).filter(Boolean).join(", ")
        : "",
      net_amount: Number(r.final_amount || r.net_amount || 0),
      display_order: i,
    }));
    const { error: itemErr } = await supabase.from("pickup_point_invoice_items").insert(items as any);
    if (itemErr) throw itemErr;

    created++;
    invoiceIds.push(inv.id);
  }
  return { created, skipped, invoiceIds };
}

export async function getInvoices(filters?: {
  status?: string;
  pickupPointId?: string;
  from?: string;
  to?: string;
}) {
  let q = supabase
    .from("pickup_point_invoices")
    .select("*")
    .order("created_at", { ascending: false });
  if (filters?.status && filters.status !== "all") q = q.eq("status", filters.status);
  if (filters?.pickupPointId && filters.pickupPointId !== "all") q = q.eq("pickup_point_id", filters.pickupPointId);
  if (filters?.from) q = q.gte("period_from", filters.from);
  if (filters?.to) q = q.lte("period_to", filters.to);
  const { data, error } = await q;
  if (error) throw error;
  return (data || []) as PickupInvoice[];
}

export async function getInvoiceItems(invoiceId: string) {
  const { data, error } = await supabase
    .from("pickup_point_invoice_items")
    .select("*")
    .eq("invoice_id", invoiceId)
    .order("display_order");
  if (error) throw error;
  return data || [];
}

export async function getInvoicePayments(invoiceId: string) {
  const { data, error } = await supabase
    .from("pickup_point_invoice_payments")
    .select("*")
    .eq("invoice_id", invoiceId)
    .order("payment_date", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function recordPayment(payment: {
  invoice_id: string;
  payment_date: string;
  amount: number;
  payment_mode: string;
  reference_no?: string;
  remarks?: string;
  recorded_by?: string;
}) {
  const { error } = await supabase.from("pickup_point_invoice_payments").insert(payment as any);
  if (error) throw error;
}

export async function setNoReminder(invoiceId: string, value: boolean) {
  const { error } = await supabase
    .from("pickup_point_invoices")
    .update({ no_reminder: value } as any)
    .eq("id", invoiceId);
  if (error) throw error;
}

export async function deleteInvoice(invoiceId: string) {
  const { error } = await supabase.from("pickup_point_invoices").delete().eq("id", invoiceId);
  if (error) throw error;
}

export async function markReminderSent(invoiceId: string) {
  const { error } = await supabase
    .from("pickup_point_invoices")
    .update({ last_reminder_sent_at: new Date().toISOString() } as any)
    .eq("id", invoiceId);
  if (error) throw error;
}

export async function getInvoiceLedger(pickupPointId: string) {
  // All invoices (debits) and payments (credits) chronologically with running balance
  const { data: invs } = await supabase
    .from("pickup_point_invoices")
    .select("id, invoice_number, total_amount, created_at")
    .eq("pickup_point_id", pickupPointId)
    .order("created_at");
  const invIds = (invs || []).map((i: any) => i.id);
  const { data: pays } = invIds.length
    ? await supabase
        .from("pickup_point_invoice_payments")
        .select("id, invoice_id, amount, payment_date, payment_mode, reference_no, created_at")
        .in("invoice_id", invIds)
        .order("payment_date")
    : { data: [] as any[] } as any;

  const invMap = new Map<string, string>();
  (invs || []).forEach((i: any) => invMap.set(i.id, i.invoice_number));

  type Row = {
    date: string;
    voucher_type: "Sales" | "Receipt";
    voucher_no: string;
    debit: number;
    credit: number;
    balance: number;
  };
  const rows: Row[] = [];
  (invs || []).forEach((i: any) =>
    rows.push({
      date: i.created_at.slice(0, 10),
      voucher_type: "Sales",
      voucher_no: i.invoice_number,
      debit: Number(i.total_amount || 0),
      credit: 0,
      balance: 0,
    }),
  );
  (pays || []).forEach((p: any) =>
    rows.push({
      date: (p.payment_date || p.created_at || "").slice(0, 10),
      voucher_type: "Receipt",
      voucher_no: `${invMap.get(p.invoice_id) || ""} • ${p.payment_mode}${p.reference_no ? " #" + p.reference_no : ""}`,
      debit: 0,
      credit: Number(p.amount || 0),
      balance: 0,
    }),
  );
  rows.sort((a, b) => a.date.localeCompare(b.date));
  let bal = 0;
  rows.forEach((r) => {
    bal += r.debit - r.credit;
    r.balance = bal;
  });
  return rows;
}

// Indian rupee amount in words
export function amountInWords(num: number): string {
  if (!num || num === 0) return "Rupees Zero Only";
  const a = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
    "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const b = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  const inWords = (n: number): string => {
    if (n < 20) return a[n];
    if (n < 100) return b[Math.floor(n / 10)] + (n % 10 ? " " + a[n % 10] : "");
    if (n < 1000) return a[Math.floor(n / 100)] + " Hundred" + (n % 100 ? " " + inWords(n % 100) : "");
    if (n < 100000) return inWords(Math.floor(n / 1000)) + " Thousand" + (n % 1000 ? " " + inWords(n % 1000) : "");
    if (n < 10000000) return inWords(Math.floor(n / 100000)) + " Lakh" + (n % 100000 ? " " + inWords(n % 100000) : "");
    return inWords(Math.floor(n / 10000000)) + " Crore" + (n % 10000000 ? " " + inWords(n % 10000000) : "");
  };
  const rupees = Math.floor(num);
  const paise = Math.round((num - rupees) * 100);
  let result = "Rupees " + inWords(rupees);
  if (paise > 0) result += " and " + inWords(paise) + " Paise";
  return result + " Only";
}
