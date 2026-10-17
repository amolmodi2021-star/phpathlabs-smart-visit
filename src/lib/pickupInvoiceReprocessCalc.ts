export type InvoiceTestLine = {
  test_id?: string;
  test_name?: string;
  price?: number;
  discount?: number;
  discounted_price?: number;
  discount_applicable?: boolean;
  individual_discount_type?: string | null;
  individual_discount_value?: number;
  [key: string]: unknown;
};

export type RecalcRegistrationInput = {
  tests: InvoiceTestLine[];
  cancelled_tests?: unknown;
  global_discount_type?: string | null;
  global_discount_value?: number | null;
  home_visit_charges?: number | null;
  paid_amount?: number | null;
  bill_cancelled?: boolean | null;
};

export type RecalcRegistrationResult = {
  tests: InvoiceTestLine[];
  test_names: string;
  gross_amount: number;
  discount_amount: number;
  net_amount: number;
  final_amount: number;
  due_amount: number;
  changed: boolean;
};

export const roundMoney = (n: number): number => Math.round((Number(n) || 0) * 100) / 100;

export function cancelledTestIdSet(cancelled: unknown): Set<string> {
  const ids = new Set<string>();
  if (!Array.isArray(cancelled)) return ids;
  for (const row of cancelled) {
    if (row == null) continue;
    if (typeof row === "string") {
      if (row) ids.add(row);
      continue;
    }
    const id = String((row as { test_id?: string }).test_id || "").trim();
    if (id) ids.add(id);
  }
  return ids;
}

function lineDiscount(test: InvoiceTestLine, price: number): number {
  const stored = Number(test.discount || 0)
    || Math.max(0, Number(test.price || 0) - Number(test.discounted_price ?? test.price ?? 0));
  const hasIndividual = !!(test.individual_discount_type && Number(test.individual_discount_value || 0) > 0);
  if (hasIndividual) {
    const val = Number(test.individual_discount_value || 0);
    return test.individual_discount_type === "percent"
      ? (price * val) / 100
      : val;
  }
  const oldPrice = Number(test.price || 0);
  if (oldPrice > 0 && stored > 0 && Math.abs(oldPrice - price) > 0.001) {
    return stored * (price / oldPrice);
  }
  return stored;
}

/**
 * Reprice one registration from the current pickup-point (or channel) price map.
 * Tests without a mapped rate keep their stored price.
 */
export function recalculateRegistrationAtRates(
  input: RecalcRegistrationInput,
  pricesByTestId: Map<string, number>,
): RecalcRegistrationResult {
  const cancelled = cancelledTestIdSet(input.cancelled_tests);
  const globalType = String(input.global_discount_type || "percent");
  const globalVal = Number(input.global_discount_value || 0);
  const hvc = Number(input.home_visit_charges || 0);
  const paid = Number(input.paid_amount || 0);

  let gross = 0;
  let discountTotal = 0;
  let changed = false;
  const names: string[] = [];
  const tests = (Array.isArray(input.tests) ? input.tests : []).map((t) => {
    const id = String(t.test_id || "").trim();
    if (cancelled.has(id)) {
      return { ...t, discount: 0, discounted_price: 0 };
    }
    const mapped = id && pricesByTestId.has(id) ? Number(pricesByTestId.get(id)) : Number(t.price || 0);
    const price = roundMoney(mapped);
    if (Math.abs(price - Number(t.price || 0)) > 0.001) changed = true;

    let discount = 0;
    if (globalVal > 0 && t.discount_applicable !== false && !t.individual_discount_type) {
      discount = globalType === "percent" ? (price * globalVal) / 100 : globalVal;
    } else {
      discount = lineDiscount(t, price);
    }
    discount = roundMoney(Math.min(Math.max(0, discount), price));
    const discounted = roundMoney(price - discount);
    if (Math.abs(discounted - Number(t.discounted_price ?? t.price ?? 0)) > 0.001) changed = true;

    gross += price;
    discountTotal += discount;
    if (t.test_name) names.push(String(t.test_name));
    return { ...t, price, discount, discounted_price: discounted };
  });

  const gross_amount = roundMoney(gross);
  const discount_amount = roundMoney(discountTotal);
  const net_amount = roundMoney(gross_amount - discount_amount);
  const final_amount = input.bill_cancelled ? 0 : roundMoney(net_amount + hvc);
  const due_amount = input.bill_cancelled ? 0 : roundMoney(Math.max(0, final_amount - paid));

  return {
    tests,
    test_names: names.join(", "),
    gross_amount,
    discount_amount,
    net_amount,
    final_amount,
    due_amount,
    changed,
  };
}
