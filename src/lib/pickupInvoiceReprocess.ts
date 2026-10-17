import { supabase } from "@/integrations/supabase/client";
import { syncRegistrationPaymentRow } from "@/lib/paymentTransactions";
import type { PickupInvoice } from "@/lib/pickupBilling";
import {
  recalculateRegistrationAtRates,
  roundMoney,
} from "@/lib/pickupInvoiceReprocessCalc";

export {
  cancelledTestIdSet,
  recalculateRegistrationAtRates,
  roundMoney,
  type InvoiceTestLine,
  type RecalcRegistrationInput,
  type RecalcRegistrationResult,
} from "@/lib/pickupInvoiceReprocessCalc";

export async function loadPriceMapForPickup(pickupPointId: string): Promise<Map<string, number>> {
  const { data, error } = await supabase
    .from("pickup_point_prices")
    .select("test_id, custom_price")
    .eq("pickup_point_id", pickupPointId);
  if (error) throw error;
  const map = new Map<string, number>();
  for (const row of data || []) {
    if (row.test_id != null) map.set(String(row.test_id), Number(row.custom_price || 0));
  }
  return map;
}

export type ReprocessPickupInvoiceResult = {
  invoiceId: string;
  patients: number;
  updated: number;
  unchanged: number;
  skipped: number;
  previousTotal: number;
  total_amount: number;
};

/**
 * Reprice every patient already on a monthly pickup invoice using the pickup
 * point's current custom rates. Updates the registration, Daily Report snapshot
 * (`payment_transactions.registration_payment`), invoice line, and invoice total.
 * Does not add new patients or delete invoice payments.
 */
export async function reprocessPickupInvoice(invoiceId: string): Promise<ReprocessPickupInvoiceResult> {
  const { data: invoice, error: invErr } = await supabase
    .from("pickup_point_invoices")
    .select("*")
    .eq("id", invoiceId)
    .single();
  if (invErr || !invoice) throw invErr || new Error("Invoice not found");

  const { data: items, error: itemErr } = await supabase
    .from("pickup_point_invoice_items")
    .select("*")
    .eq("invoice_id", invoiceId)
    .order("display_order");
  if (itemErr) throw itemErr;

  const prices = await loadPriceMapForPickup(invoice.pickup_point_id);
  const regIds = (items || []).map((i: { registration_id?: string | null }) => i.registration_id).filter(Boolean) as string[];
  const regsById = new Map<string, any>();
  if (regIds.length > 0) {
    const { data: regs, error: regErr } = await supabase
      .from("patient_registrations")
      .select(
        "id, invoice_number, patient_name, tests, cancelled_tests, global_discount_type, global_discount_value, home_visit_charges, paid_amount, payments, bill_cancelled",
      )
      .in("id", regIds);
    if (regErr) throw regErr;
    (regs || []).forEach((r: { id: string }) => regsById.set(r.id, r));
  }

  let updated = 0;
  let unchanged = 0;
  let skipped = 0;
  let newTotal = 0;

  for (const item of items || []) {
    const reg = item.registration_id ? regsById.get(item.registration_id) : null;
    if (!reg || reg.bill_cancelled) {
      skipped++;
      newTotal += Number(item.net_amount || 0);
      continue;
    }

    const next = recalculateRegistrationAtRates(reg, prices);
    newTotal += next.final_amount;

    if (!next.changed && Math.abs(Number(item.net_amount || 0) - next.final_amount) < 0.01) {
      unchanged++;
      continue;
    }

    const { error: updRegErr } = await supabase
      .from("patient_registrations")
      .update({
        tests: next.tests,
        gross_amount: next.gross_amount,
        discount_amount: next.discount_amount,
        net_amount: next.net_amount,
        final_amount: next.final_amount,
        due_amount: next.due_amount,
      } as any)
      .eq("id", reg.id);
    if (updRegErr) throw updRegErr;

    await syncRegistrationPaymentRow({
      registration_id: reg.id,
      invoice_number: reg.invoice_number,
      patient_name: reg.patient_name,
      payments: Array.isArray(reg.payments) ? reg.payments : [],
      paid_amount: Number(reg.paid_amount || 0),
      final_amount: next.final_amount,
      due_amount: next.due_amount,
      gross_amount: next.gross_amount,
      discount_amount: next.discount_amount,
      change_reason: "Pickup rates reprocessed",
    });

    const { error: updItemErr } = await supabase
      .from("pickup_point_invoice_items")
      .update({
        net_amount: next.final_amount,
        test_names: next.test_names,
        patient_name: reg.patient_name,
      } as any)
      .eq("id", item.id);
    if (updItemErr) throw updItemErr;

    updated++;
  }

  const total_amount = roundMoney(newTotal);
  const { error: totErr } = await supabase
    .from("pickup_point_invoices")
    .update({
      total_amount,
      patient_count: (items || []).length,
    } as any)
    .eq("id", invoiceId);
  if (totErr) throw totErr;

  return {
    invoiceId,
    patients: (items || []).length,
    updated,
    unchanged,
    skipped,
    previousTotal: Number((invoice as PickupInvoice).total_amount || 0),
    total_amount,
  };
}
