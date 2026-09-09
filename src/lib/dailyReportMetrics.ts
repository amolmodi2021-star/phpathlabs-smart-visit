/** Shared Daily Report / Dashboard payment_transaction metrics. */

export function paymentRowGross(
  row: {
    transaction_type?: string | null;
    gross_amount?: number | null;
    final_amount?: number | null;
    discount_amount?: number | null;
    registration_id?: string | null;
  },
  homeVisitChargesByRegId: Record<string, number>,
): number {
  const base = Number(row.gross_amount || 0);
  const type = row.transaction_type || "";
  if (type === "bill_cancellation" || type === "old_bill_cancellation" || type === "test_cancellation") return base;
  if (type === "registration_payment" || type === "discount_applied") {
    let hvc = Number(homeVisitChargesByRegId[row.registration_id || ""] || 0);
    // Live HVC may be cleared after cancel; recover from frozen snapshot:
    // final = (tests gross - discount) + HVC  =>  HVC = final + discount - gross
    if (hvc <= 0.009) {
      const final = Number(row.final_amount || 0);
      const discount = Number(row.discount_amount || 0);
      const inferred = final + discount - base;
      if (inferred > 0.009) hvc = inferred;
    }
    return base + hvc;
  }
  return base;
}

/**
 * Paid column for Daily Report:
 * - due collections use total_amount (delta)
 * - refunds use signed total_amount (negative outflow)
 * - registration rows use paid_amount snapshot
 */
export function paymentRowPaid(row: {
  transaction_type?: string | null;
  total_amount?: number | null;
  paid_amount?: number | null;
  refund_amount?: number | null;
}): number {
  const type = row.transaction_type || "";
  if (type === "due_collection" || type === "old_due_recovered") {
    return Number(row.total_amount || 0);
  }
  if (type === "refund" || type === "old_bill_refund" || type === "post_discount_refund" || type === "test_cancellation") {
    const signedTotal = Number(row.total_amount || 0);
    if (signedTotal !== 0) return signedTotal;
    const refundAmt = Number(row.refund_amount || 0);
    if (refundAmt) return -Math.abs(refundAmt);
    // test_cancellation with no cash still uses paid_amount (usually 0)
    if (type === "test_cancellation") return Number(row.paid_amount || 0);
    return 0;
  }
  return Number(row.paid_amount || 0);
}

export function isHiddenDailyReportType(type: string | null | undefined): boolean {
  return type === "old_bill_cancellation";
}

/** Minute bucket for pairing cancel + refund (same minute → eligible to merge). */
export function transactionMinuteKey(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}-${d.getUTCHours()}-${d.getUTCMinutes()}`;
}

function isCashlessTestCancellation(row: {
  transaction_type?: string | null;
  refund_amount?: number | null;
  total_amount?: number | null;
  cash_amount?: number | null;
  gpay_amount?: number | null;
  paytm_amount?: number | null;
  neft_amount?: number | null;
  credit_card_amount?: number | null;
}): boolean {
  if (row.transaction_type !== "test_cancellation") return false;
  if (Number(row.refund_amount || 0) > 0.009) return false;
  const modeSum =
    Math.abs(Number(row.cash_amount || 0))
    + Math.abs(Number(row.gpay_amount || 0))
    + Math.abs(Number(row.paytm_amount || 0))
    + Math.abs(Number(row.neft_amount || 0))
    + Math.abs(Number(row.credit_card_amount || 0))
    + Math.abs(Number(row.total_amount || 0));
  return modeSum < 0.009;
}

function isTestCancelCashRefund(row: {
  transaction_type?: string | null;
  remarks?: string | null;
}): boolean {
  if (row.transaction_type !== "refund" && row.transaction_type !== "old_bill_refund") return false;
  const remarks = String(row.remarks || "").toLowerCase();
  // Prefer explicit cancel remarks; still allow empty remarks when paired by time+invoice.
  if (!remarks) return true;
  return remarks.includes("cancel") || remarks.includes("test");
}

/**
 * Legacy only: merge a cashless Test Cancellation with its paired Refund when they
 * share invoice + minute + matching amount. Never merges two cancel events together —
 * each cancel action stays its own Daily Report row.
 */
export function mergeSameTimestampTestCancelRefunds<T extends {
  id?: string;
  invoice_number?: string | null;
  registration_id?: string | null;
  transaction_type?: string | null;
  transaction_date?: string | null;
  remarks?: string | null;
  refund_amount?: number | null;
  total_amount?: number | null;
  cash_amount?: number | null;
  gpay_amount?: number | null;
  paytm_amount?: number | null;
  neft_amount?: number | null;
  credit_card_amount?: number | null;
  gross_amount?: number | null;
  discount_amount?: number | null;
  final_amount?: number | null;
}>(rows: T[]): T[] {
  const used = new Set<string>();
  const out: T[] = [];

  for (const row of rows) {
    const id = String(row.id || "");
    if (id && used.has(id)) continue;

    // Already a combined cancel row (new logging) — leave alone; do not fold into others.
    if (row.transaction_type === "test_cancellation" && !isCashlessTestCancellation(row)) {
      out.push(row);
      continue;
    }

    if (!isCashlessTestCancellation(row)) {
      out.push(row);
      continue;
    }

    const minute = transactionMinuteKey(row.transaction_date);
    const cancelFinal = Math.abs(Number(row.final_amount || 0));
    const partner = rows.find((cand) => {
      const cid = String(cand.id || "");
      if (!cid || cid === id || used.has(cid)) return false;
      if (!isTestCancelCashRefund(cand)) return false;
      if ((cand.invoice_number || "") !== (row.invoice_number || "")) return false;
      if ((cand.registration_id || "") && (row.registration_id || "")
        && cand.registration_id !== row.registration_id) return false;
      // Different cancel actions (different minute) stay separate.
      if (!minute || transactionMinuteKey(cand.transaction_date) !== minute) return false;
      // Amount must match this cancel's Final so a later cancel's refund is not attached.
      const refundAmt = Math.abs(Number(cand.refund_amount || cand.total_amount || 0));
      if (cancelFinal > 0.009 && Math.abs(refundAmt - cancelFinal) > 0.05) return false;
      return true;
    });

    if (!partner) {
      out.push(row);
      continue;
    }

    const pid = String(partner.id || "");
    if (id) used.add(id);
    if (pid) used.add(pid);

    out.push({
      ...row,
      id: id && pid ? `${id}+${pid}` : row.id,
      cash_amount: partner.cash_amount ?? 0,
      gpay_amount: partner.gpay_amount ?? 0,
      paytm_amount: partner.paytm_amount ?? 0,
      neft_amount: partner.neft_amount ?? 0,
      credit_card_amount: partner.credit_card_amount ?? 0,
      total_amount: partner.total_amount ?? 0,
      refund_amount: partner.refund_amount ?? 0,
      remarks: row.remarks || partner.remarks,
    });
  }

  return out;
}