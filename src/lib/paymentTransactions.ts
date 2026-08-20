import { supabase } from "@/integrations/supabase/client";
import { getCurrentUser } from "@/lib/auth";
import {
  paymentEntryAmount,
  sumPaymentEntries,
  type BillPaymentEntry,
} from "@/lib/billPayment";

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
  payments: Array<{ mode?: string; amount?: number }> | undefined
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
  transaction_type: "registration_payment" | "due_collection" | "old_due_recovered" | "discount_applied" | "refund" | "old_bill_refund" | "bill_cancellation" | "old_bill_cancellation";
  direction: "in" | "out";
  payments?: Array<{ mode?: string; amount?: number }>;
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
  payments: Array<{ mode?: string; amount?: number }>;
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
      .select("id, remarks, paid_amount")
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
      // Invariant on the registration audit row:
      //   due_amount = final_amount - paid_amount (frozen at registration time)
      // When NOT syncing the payment split, paid_amount stays frozen, so we must
      // recompute due from the new final_amount and the existing frozen paid_amount —
      // NOT use the live registration's due_amount (which already nets later collections).
      const frozenPaid = Number(row.paid_amount) || 0;
      const dueForRow = params.sync_payment_split
        ? params.due_amount
        : Math.max(0, params.final_amount - frozenPaid);
      const updateRow: any = {
        due_amount: dueForRow,
        final_amount: params.final_amount,
        ...(params.gross_amount !== undefined ? { gross_amount: params.gross_amount } : {}),
        ...(params.discount_amount !== undefined ? { discount_amount: params.discount_amount } : {}),
        remarks: newRemarks,
      };
      // Only overwrite the original registration-time payment split when explicitly
      // requested (e.g. user corrected a mode typo). Otherwise leave cash/gpay/... and
      // paid/total frozen so later due-collection rows don't get double-counted.
      if (params.sync_payment_split) {
        updateRow.cash_amount = modes.cash;
        updateRow.gpay_amount = modes.gpay;
        updateRow.paytm_amount = modes.paytm;
        updateRow.credit_card_amount = modes.credit_card;
        updateRow.neft_amount = modes.neft;
        updateRow.total_amount = params.paid_amount;
        updateRow.paid_amount = params.paid_amount;
      }
      const { error: updErr } = await supabase
        .from("payment_transactions" as any)
        .update(updateRow)
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

/**
 * After correcting due-collection modes on patient_registrations.payments,
 * rewrite matching due_collection / old_due_recovered audit rows' mode columns.
 * Amounts stay the same — only Cash/GPay/NEFT/etc. columns move.
 * Never throws.
 */
export async function syncDueCollectionPaymentModes(params: {
  registration_id: string;
  dueCollections: BillPaymentEntry[];
}) {
  try {
    const dueCollections = (params.dueCollections || []).filter((p) => paymentEntryAmount(p) > 0);
    if (dueCollections.length === 0) return;

    const { data: txs, error } = await supabase
      .from("payment_transactions" as any)
      .select("id, total_amount, transaction_date, remarks, cash_amount, gpay_amount, paytm_amount, credit_card_amount, neft_amount")
      .eq("registration_id", params.registration_id)
      .in("transaction_type", ["due_collection", "old_due_recovered"])
      .order("transaction_date", { ascending: true });

    if (error) {
      console.error("Failed to lookup due collection transactions:", error);
      return;
    }
    if (!txs || txs.length === 0) return;

    const groups = new Map<string, BillPaymentEntry[]>();
    for (const p of dueCollections) {
      const key = String(p.date || "");
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(p);
    }
    const groupList = [...groups.entries()]
      .map(([date, entries]) => ({
        date,
        entries,
        total: sumPaymentEntries(entries),
        modes: splitPaymentModes(
          entries.map((e) => ({ mode: String(e.mode || ""), amount: paymentEntryAmount(e) })),
        ),
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const user = getCurrentUser();
    const performer = user?.display_name || user?.username || "Unknown";
    const stamp = new Date().toLocaleString("en-IN", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
    const editRemark = `Due collection payment mode corrected on ${stamp} by ${performer}`;
    const used = new Set<number>();

    for (const tx of txs as any[]) {
      const txTotal = Math.abs(Number(tx.total_amount || 0));
      let matchIdx = groupList.findIndex(
        (g, i) => !used.has(i) && Math.abs(g.total - txTotal) < 0.01,
      );
      if (matchIdx < 0 && tx.transaction_date) {
        const txMs = new Date(tx.transaction_date).getTime();
        matchIdx = groupList.findIndex((g, i) => {
          if (used.has(i) || !g.date) return false;
          return Math.abs(new Date(g.date).getTime() - txMs) < 10_000;
        });
      }
      if (matchIdx < 0) continue;
      used.add(matchIdx);
      const g = groupList[matchIdx];
      const sameModes =
        Number(tx.cash_amount || 0) === g.modes.cash &&
        Number(tx.gpay_amount || 0) === g.modes.gpay &&
        Number(tx.paytm_amount || 0) === g.modes.paytm &&
        Number(tx.credit_card_amount || 0) === g.modes.credit_card &&
        Number(tx.neft_amount || 0) === g.modes.neft;
      if (sameModes) continue;

      const newRemarks = tx.remarks ? `${tx.remarks}\n${editRemark}` : editRemark;
      const { error: updErr } = await supabase
        .from("payment_transactions" as any)
        .update({
          cash_amount: g.modes.cash,
          gpay_amount: g.modes.gpay,
          paytm_amount: g.modes.paytm,
          credit_card_amount: g.modes.credit_card,
          neft_amount: g.modes.neft,
          remarks: newRemarks,
        })
        .eq("id", tx.id);
      if (updErr) console.error("Failed to sync due collection payment modes:", updErr);
    }
  } catch (e) {
    console.error("syncDueCollectionPaymentModes failed:", e);
  }
}
