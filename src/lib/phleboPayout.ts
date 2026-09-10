/** Phlebo month-end HVC + incentive payout helpers. */

export function buildIncentiveMap(
  rows: Array<Array<{ id: string; incentive_allowed?: boolean | null; incentive_amount?: number | null }>>,
): Record<string, number> {
  const m: Record<string, number> = {};
  for (const list of rows) {
    for (const r of list || []) {
      if (!r?.id || !r.incentive_allowed) continue;
      const amt = Number(r.incentive_amount) || 0;
      if (amt > 0) m[r.id] = amt;
    }
  }
  return m;
}

export type IncentiveCatalogEntry = { name: string; amount: number };

/** id -> { name, amount } for export / detail lines */
export function buildIncentiveCatalog(
  sources: Array<{
    rows: Array<{ id: string; name?: string | null; incentive_allowed?: boolean | null; incentive_amount?: number | null }>;
  }>,
): Record<string, IncentiveCatalogEntry> {
  const m: Record<string, IncentiveCatalogEntry> = {};
  for (const src of sources) {
    for (const r of src.rows || []) {
      if (!r?.id || !r.incentive_allowed) continue;
      const amount = Number(r.incentive_amount) || 0;
      if (amount <= 0) continue;
      m[r.id] = { name: String(r.name || r.id), amount };
    }
  }
  return m;
}

export function incentiveAmountMapFromCatalog(
  catalog: Record<string, IncentiveCatalogEntry>,
): Record<string, number> {
  const m: Record<string, number> = {};
  for (const [id, e] of Object.entries(catalog)) m[id] = e.amount;
  return m;
}

/** Items booked on the invoice (active + previously cancelled lines). */
export function registrationBillItems(reg: {
  tests?: any[] | null;
  cancelled_tests?: any[] | null;
}): any[] {
  const active = Array.isArray(reg.tests) ? reg.tests : [];
  const cancelled = Array.isArray(reg.cancelled_tests) ? reg.cancelled_tests : [];
  return [...active, ...cancelled];
}

export function cancelledTestIdSet(reg: { cancelled_tests?: any[] | null }): Set<string> {
  const set = new Set<string>();
  for (const t of Array.isArray(reg.cancelled_tests) ? reg.cancelled_tests : []) {
    const id = String(t?.test_id || "");
    if (id) set.add(id);
  }
  return set;
}

function incentiveEligibleItems(reg: {
  bill_cancelled?: boolean | null;
  tests?: any[] | null;
  cancelled_tests?: any[] | null;
}): any[] {
  if (reg.bill_cancelled) return registrationBillItems(reg);
  const cancelled = cancelledTestIdSet(reg);
  const active = Array.isArray(reg.tests) ? reg.tests : [];
  return active.filter((t) => {
    const id = String(t?.test_id || "");
    return id && !cancelled.has(id);
  });
}

/**
 * Incentive for a registration.
 * - Active bill: only tests still on the invoice (not in cancelled_tests).
 * - Cancelled bill: all originally booked lines (so full cancel deducts full incentive).
 */
export function registrationIncentiveAmount(
  reg: {
    bill_cancelled?: boolean | null;
    tests?: any[] | null;
    cancelled_tests?: any[] | null;
  },
  incentiveById: Record<string, number>,
): number {
  return incentiveEligibleItems(reg).reduce((sum, t) => {
    const id = String(t?.test_id || "");
    return sum + (id ? Number(incentiveById[id] || 0) : 0);
  }, 0);
}

/** Incentive test names + total for one registered patient (export / UI detail). */
export function registrationIncentiveDetails(
  reg: {
    bill_cancelled?: boolean | null;
    tests?: any[] | null;
    cancelled_tests?: any[] | null;
  },
  catalog: Record<string, IncentiveCatalogEntry>,
): { names: string[]; total: number } {
  const names: string[] = [];
  let total = 0;
  for (const t of incentiveEligibleItems(reg)) {
    const id = String(t?.test_id || "");
    const entry = id ? catalog[id] : undefined;
    if (!entry) continue;
    names.push(entry.name);
    total += entry.amount;
  }
  return { names, total };
}

/** Home visit charge actually billed on this registration (not estimate). */
export function registrationHvc(reg: { home_visit_charges?: number | null }): number {
  return Math.max(0, Number(reg.home_visit_charges || 0));
}

export type PhleboPayoutBucket = "earned" | "hold" | "deducted" | "none";

export type PhleboPayoutBucketTotals = {
  earned: number;
  hold: number;
  deducted: number;
};

/** Net payable once: earned − hold − deducted (never subtract hold/deducted twice). */
export function payoutBucketNet(b: PhleboPayoutBucketTotals): number {
  return (Number(b.earned) || 0) - (Number(b.hold) || 0) - (Number(b.deducted) || 0);
}

/**
 * Month-end payout bucket for one registration.
 * - Cancelled bill -> deducted (HVC + incentives must not be paid).
 * - Open due -> hold until collected.
 * - Otherwise -> earned.
 * Secondary family members with HVC=0 correctly earn 0 HVC (no false "refunded").
 */
export function registrationPayoutBucket(reg: {
  bill_cancelled?: boolean | null;
  due_amount?: number | null;
}): PhleboPayoutBucket {
  if (reg.bill_cancelled) return "deducted";
  if (Number(reg.due_amount || 0) > 0.01) return "hold";
  return "earned";
}