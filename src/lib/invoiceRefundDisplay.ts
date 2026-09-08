/** Cancelled-test refund amount (prefer stored net / discounted price). */
export function cancelledTestRefundAmount(ct: {
  refund_amount?: number | string | null;
  discounted_price?: number | string | null;
  discountedPrice?: number | string | null;
  price?: number | string | null;
  discount?: number | string | null;
} | null | undefined): number {
  if (!ct) return 0;
  if (ct.refund_amount !== undefined && ct.refund_amount !== null && ct.refund_amount !== "") {
    return Number(ct.refund_amount) || 0;
  }
  const net = ct.discounted_price ?? ct.discountedPrice;
  if (net !== undefined && net !== null && net !== "") return Number(net) || 0;
  return Math.max(0, (Number(ct.price || 0) || 0) - (Number(ct.discount || 0) || 0));
}

/**
 * Home-visit portion of refund_amount for invoice display.
 *
 * - Full bill cancel: HV charge stays on the row; refund includes HV → min(hvc, refund).
 * - Partial cancel with HV kept (hvc > 0): 0.
 * - Partial cancel with HV refunded (hvc zeroed): remainder after cancelled-test refunds.
 */
export function computeHvcRefundAmount(data: {
  refund_amount?: number | string | null;
  home_visit_charges?: number | string | null;
  bill_cancelled?: boolean | null;
  cancelled_tests?: any[] | null;
} | null | undefined): number {
  const refund = Number(data?.refund_amount || 0);
  if (!(refund > 0)) return 0;

  const hvc = Number(data?.home_visit_charges || 0);
  const cancelledTests = Array.isArray(data?.cancelled_tests) ? data!.cancelled_tests! : [];

  if (data?.bill_cancelled) {
    return Math.min(Math.max(0, hvc), refund);
  }

  if (hvc > 0) {
    // HV still on the bill → not refunded
    return 0;
  }

  const testRefundTotal = cancelledTests.reduce(
    (sum: number, ct: any) => sum + cancelledTestRefundAmount(ct),
    0,
  );
  return Math.max(0, refund - testRefundTotal);
}