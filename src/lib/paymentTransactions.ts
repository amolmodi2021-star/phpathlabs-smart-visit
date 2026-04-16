import { supabase } from "@/integrations/supabase/client";
import { getCurrentUser } from "@/lib/auth";

export interface PaymentModeAmounts {
  cash: number;
  gpay: number;
  paytm: number;
  credit_card: number;
  neft: number;
}

/**
 * Convert a payments array (e.g. [{mode:"Cash",amount:100},{mode:"GPay",amount:50}])
 * into mode-wise column amounts.
 */
export function splitPaymentModes(
  payments: Array<{ mode: string; amount: number }> | undefined
): PaymentModeAmounts {
  const result: PaymentModeAmounts = { cash: 0, gpay: 0, paytm: 0, credit_card: 0, neft: 0 };
  if (!payments || !Array.isArray(payments)) return result;
  for (const p of payments) {
    const mode = (p.mode || "").toLowerCase().replace(/\s+/g, "_");
    if (mode === "cash") result.cash += p.amount || 0;
    else if (mode === "gpay") result.gpay += p.amount || 0;
    else if (mode === "paytm") result.paytm += p.amount || 0;
    else if (mode === "credit_card") result.credit_card += p.amount || 0;
    else if (mode === "neft") result.neft += p.amount || 0;
  }
  return result;
}

export interface LogTransactionParams {
  registration_id: string;
  invoice_number: string;
  patient_name?: string;
  transaction_type: "registration_payment" | "due_collection" | "discount_applied" | "refund" | "bill_cancellation";
  direction: "in" | "out";
  payments?: Array<{ mode: string; amount: number }>;
  total_amount?: number;
  gross_amount?: number;
  discount_amount?: number;
  final_amount?: number;
  paid_amount?: number;
  due_amount?: number;
  refund_amount?: number;
  remarks?: string;
}

/**
 * Fire-and-forget: log a payment transaction to the audit table.
 * Never throws — failures are logged to console only.
 */
export function logPaymentTransaction(params: LogTransactionParams) {
  const user = getCurrentUser();
  const modes = splitPaymentModes(params.payments);

  const row = {
    registration_id: params.registration_id,
    invoice_number: params.invoice_number,
    patient_name: params.patient_name || null,
    transaction_type: params.transaction_type,
    transaction_date: new Date().toISOString(),
    performed_by: user?.display_name || user?.username || "Unknown",
    cash_amount: modes.cash,
    gpay_amount: modes.gpay,
    paytm_amount: modes.paytm,
    credit_card_amount: modes.credit_card,
    neft_amount: modes.neft,
    total_amount: params.total_amount ?? 0,
    direction: params.direction,
    gross_amount: params.gross_amount ?? 0,
    discount_amount: params.discount_amount ?? 0,
    final_amount: params.final_amount ?? 0,
    paid_amount: params.paid_amount ?? 0,
    due_amount: params.due_amount ?? 0,
    refund_amount: params.refund_amount ?? 0,
    remarks: params.remarks || null,
  };

  supabase
    .from("payment_transactions" as any)
    .insert(row)
    .then(({ error }) => {
      if (error) console.error("Failed to log payment transaction:", error);
    });
}
