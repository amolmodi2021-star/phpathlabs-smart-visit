/**
 * Round-up billing when a discount is applied: offer the next ₹10 multiple
 * and absorb the difference by reducing per-test discounts (integer rupees).
 */

export function nextTenMultiple(amount: number): number | null {
  const due = Math.round(Number(amount) || 0);
  if (due <= 0) return null;
  const rem = due % 10;
  if (rem === 0) return null;
  return due + (10 - rem);
}

/** Split diff across 
 slots: first slots get the odd remainder. */
export function distributeIntegerDiff(diff: number, n: number): number[] {
  if (n <= 0 || diff <= 0) return Array.from({ length: Math.max(0, n) }, () => 0);
  const base = Math.floor(diff / n);
  const rem = diff % n;
  return Array.from({ length: n }, (_, i) => base + (i < rem ? 1 : 0));
}

export type DiscountLine = {
  price: number;
  discount: number;
  discount_applicable?: boolean;
};

export type RoundUpAdjustment<T extends DiscountLine> = {
  /** Final amount after raising payable to next ₹10 (via less discount). */
  finalAmount: number;
  totalDiscount: number;
  extraRupees: number;
  testDetails: Array<T & { discount: number; discountedPrice: number; effectiveDiscountPct: number }>;
};

function effectivePct(price: number, discount: number): number {
  if (!(price > 0) || !(discount > 0)) return 0;
  return Number(((discount / price) * 100).toFixed(2));
}

/**
 * Reduce discounts on lines that currently have discount > 0 so final rises
 * to the next ₹10 multiple. Returns null when not applicable.
 */
export function applyRoundUpToNextTen<T extends DiscountLine>(
  testDetails: T[],
  homeVisitCharges: number,
): RoundUpAdjustment<T> | null {
  const hvc = Math.max(0, Number(homeVisitCharges) || 0);
  const gross = testDetails.reduce((s, t) => s + (Number(t.price) || 0), 0);
  const baseDiscount = testDetails.reduce((s, t) => s + (Number(t.discount) || 0), 0);
  if (!(baseDiscount > 0)) return null;

  const baseFinal = Math.round(gross - baseDiscount + hvc);
  const target = nextTenMultiple(baseFinal);
  if (target == null) return null;

  const maxFinal = Math.round(gross + hvc);
  const cappedTarget = Math.min(target, maxFinal);
  let extra = cappedTarget - baseFinal;
  if (extra <= 0) return null;
  extra = Math.min(extra, Math.round(baseDiscount));

  const eligibleIdx: number[] = [];
  testDetails.forEach((t, i) => {
    if (Math.round(Number(t.discount) || 0) > 0) eligibleIdx.push(i);
  });
  if (eligibleIdx.length === 0) return null;

  const reductions = new Array(testDetails.length).fill(0);
  let remaining = extra;
  let pool = [...eligibleIdx];
  while (remaining > 0 && pool.length > 0) {
    const shares = distributeIntegerDiff(remaining, pool.length);
    const nextPool: number[] = [];
    let consumed = 0;
    pool.forEach((idx, j) => {
      const currentDisc = Math.round(Number(testDetails[idx].discount) || 0) - reductions[idx];
      const take = Math.min(shares[j], currentDisc);
      reductions[idx] += take;
      consumed += take;
      if (currentDisc - take > 0) nextPool.push(idx);
    });
    if (consumed <= 0) break;
    remaining -= consumed;
    pool = nextPool;
  }

  const adjusted = testDetails.map((t, i) => {
    const price = Number(t.price) || 0;
    const disc = Math.max(0, Math.round(Number(t.discount) || 0) - reductions[i]);
    return {
      ...t,
      discount: disc,
      discountedPrice: Math.max(0, price - disc),
      effectiveDiscountPct: effectivePct(price, disc),
    };
  });

  const totalDiscount = adjusted.reduce((s, t) => s + t.discount, 0);
  const finalAmount = Math.round(gross - totalDiscount + hvc);

  return {
    finalAmount,
    totalDiscount,
    extraRupees: Math.max(0, finalAmount - baseFinal),
    testDetails: adjusted,
  };
}

export function withEffectiveDiscountPct<T extends DiscountLine>(
  testDetails: T[],
): Array<T & { effectiveDiscountPct: number }> {
  return testDetails.map((t) => ({
    ...t,
    effectiveDiscountPct: effectivePct(Number(t.price) || 0, Number(t.discount) || 0),
  }));
}
