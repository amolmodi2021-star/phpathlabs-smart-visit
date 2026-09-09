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
  if (type === "refund" || type === "old_bill_refund" || type === "post_discount_refund") {
    const signedTotal = Number(row.total_amount || 0);
    if (signedTotal !== 0) return signedTotal;
    const refundAmt = Number(row.refund_amount || 0);
    return refundAmt ? -Math.abs(refundAmt) : 0;
  }
  return Number(row.paid_amount || 0);
}

export function isHiddenDailyReportType(type: string | null | undefined): boolean {
  return type === "old_bill_cancellation";
}