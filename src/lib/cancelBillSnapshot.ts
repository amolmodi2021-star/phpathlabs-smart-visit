/** Resolve Bill Cancel marker amounts from live reg + frozen registration_payment. */

export type FrozenRegistrationBillSnapshot = {
  gross_amount: number;
  discount_amount: number;
  final_amount: number;
  paid_amount: number;
};

/**
 * Prefer live registration; if HVC/tests were refunded first and live totals are
 * already 0, fall back to frozen snapshot so Gross/Final still net to zero.
 */
export function resolveCancelBillSnapshot(
  live: {
    gross_amount?: number | null;
    home_visit_charges?: number | null;
    discount_amount?: number | null;
    final_amount?: number | null;
    paid_amount?: number | null;
  },
  frozen: FrozenRegistrationBillSnapshot | null,
  alreadyRefunded = 0,
): {
  origGross: number;
  origDiscount: number;
  origFinal: number;
  refundCash: number;
} {
  const liveHvc = Number(live.home_visit_charges || 0);
  const liveGross = Number(live.gross_amount || 0) + liveHvc;
  const liveDiscount = Number(live.discount_amount || 0);
  const liveFinal = Number(live.final_amount || 0);
  const livePaid = Number(live.paid_amount || 0);

  let origGross = liveGross;
  let origDiscount = liveDiscount;
  let origFinal = liveFinal;
  let originalPaid = livePaid;

  if (origFinal <= 0.009 && frozen && Number(frozen.final_amount || 0) > 0.009) {
    origFinal = Number(frozen.final_amount || 0);
    origDiscount = Number(frozen.discount_amount || 0);
    // final = (testsGross - discount) + HVC  =>  testsGross + HVC = final + discount
    origGross = origFinal + origDiscount;
  }
  if (originalPaid <= 0.009 && frozen && Number(frozen.paid_amount || 0) > 0.009) {
    originalPaid = Number(frozen.paid_amount || 0);
  }

  const refundCash = Math.max(0, originalPaid - Math.max(0, Number(alreadyRefunded || 0)));
  return { origGross, origDiscount, origFinal, refundCash };
}