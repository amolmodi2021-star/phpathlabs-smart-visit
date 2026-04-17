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
  // For "out" (refund / bill_cancellation), store mode amounts and total_amount as
  // NEGATIVE so daily mode totals net to actual cash-drawer reality.
  // refund_amount stays POSITIVE (audit value).
  const sign = params.direction === "out" ? -1 : 1;

  const row = {
    registration_id: params.registration_id,
    invoice_number: params.invoice_number,
    patient_name: params.patient_name || null,
    transaction_type: params.transaction_type,
    transaction_date: new Date().toISOString(),
    performed_by: user?.display_name || user?.username || "Unknown",
    cash_amount: modes.cash * sign,
    gpay_amount: modes.gpay * sign,
    paytm_amount: modes.paytm * sign,
    credit_card_amount: modes.credit_card * sign,
    neft_amount: modes.neft * sign,
    total_amount: (params.total_amount ?? 0) * sign,
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

export interface SyncRegistrationPaymentRowParams {
  registration_id: string;
  invoice_number: string;
  patient_name?: string;
  payments: Array<{ mode: string; amount: number }>;
  paid_amount: number;
  final_amount: number;
  due_amount: number;
  gross_amount?: number;
  discount_amount?: number;
  /** Short label describing the edit, e.g. "Discount edited", "Tests cancelled", "Bill cancelled" */
  change_reason?: string;
  /**
   * If true, overwrite per-mode payment columns (cash/gpay/...) + paid_amount + total_amount
   * on the original registration audit row. Default false: only the bill snapshot
   * (gross/discount/final/due) is updated, leaving the original at-registration-time
   * payment split frozen so later due-collection deltas don't get double-counted.
   */
  sync_payment_split?: boolean;
}

/**
 * Sync the original `registration_payment` row with the latest authoritative
 * registration numbers so Daily Report (which sums payment_transactions rows)
 * always reflects the current state.
 *
 * Updates in-place:
 *   - per-mode amounts (cash/gpay/paytm/credit_card/neft) from `payments` split
 *   - total_amount = paid_amount
 *   - gross/discount/final/paid/due amounts
 *   - appends a remark line describing the change + timestamp + user
 *
 * If no original row exists (legacy registration), inserts a fresh one.
 * Never throws.
 */
export async function syncRegistrationPaymentRow(params: SyncRegistrationPaymentRowParams) {
  try {
    const user = getCurrentUser();
    const modes = splitPaymentModes(params.payments);
    const performer = user?.display_name || user?.username || "Unknown";
    const now = new Date();
    const stamp = now.toLocaleString("en-IN", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit", hour12: true,
    });
    const reasonLabel = params.change_reason || "Payment details edited";
    const editRemark = `${reasonLabel} on ${stamp} by ${performer}`;

    const { data: existing, error: findErr } = await supabase
      .from("payment_transactions" as any)
      .select("id, remarks")
      .eq("registration_id", params.registration_id)
      .eq("transaction_type", "registration_payment")
      .order("transaction_date", { ascending: false })
      .limit(1);

    if (findErr) {
      console.error("Failed to lookup payment transaction:", findErr);
      return;
    }

    if (existing && existing.length > 0) {
      const row: any = existing[0];
      const newRemarks = row.remarks ? `${row.remarks}\n${editRemark}` : editRemark;
      const { error: updErr } = await supabase
        .from("payment_transactions" as any)
        .update({
          cash_amount: modes.cash,
          gpay_amount: modes.gpay,
          paytm_amount: modes.paytm,
          credit_card_amount: modes.credit_card,
          neft_amount: modes.neft,
          total_amount: params.paid_amount,
          paid_amount: params.paid_amount,
          due_amount: params.due_amount,
          final_amount: params.final_amount,
          ...(params.gross_amount !== undefined ? { gross_amount: params.gross_amount } : {}),
          ...(params.discount_amount !== undefined ? { discount_amount: params.discount_amount } : {}),
          remarks: newRemarks,
        })
        .eq("id", row.id);
      if (updErr) console.error("Failed to sync registration payment row:", updErr);
    } else {
      // Fallback: legacy registration with no audit row — create one now
      logPaymentTransaction({
        registration_id: params.registration_id,
        invoice_number: params.invoice_number,
        patient_name: params.patient_name,
        transaction_type: "registration_payment",
        direction: "in",
        payments: params.payments,
        total_amount: params.paid_amount,
        gross_amount: params.gross_amount ?? 0,
        discount_amount: params.discount_amount ?? 0,
        final_amount: params.final_amount,
        paid_amount: params.paid_amount,
        due_amount: params.due_amount,
        remarks: editRemark,
      });
    }
  } catch (e) {
    console.error("syncRegistrationPaymentRow failed:", e);
  }
}

/**
 * @deprecated Use `syncRegistrationPaymentRow` instead.
 * Kept as an alias for backwards-compatibility.
 */
export const updateRegistrationPaymentSplit = syncRegistrationPaymentRow;
