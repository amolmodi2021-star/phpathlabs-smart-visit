/** Pure helpers: bill-cancel refund must reverse original payment mode columns. */

export type PaymentModeAmounts = {
  cash: number;
  gpay: number;
  paytm: number;
  credit_card: number;
  neft: number;
};

const MODE_LABELS: Array<{ key: keyof PaymentModeAmounts; label: string }> = [
  { key: "cash", label: "Cash" },
  { key: "gpay", label: "GPay" },
  { key: "paytm", label: "Paytm" },
  { key: "credit_card", label: "Credit Card" },
  { key: "neft", label: "NEFT" },
];

/** Turn mode columns into a payments[] list (positive amounts only). */
export function paymentsFromModeAmounts(
  modes: PaymentModeAmounts,
): Array<{ mode: string; amount: number }> {
  return MODE_LABELS
    .map(({ key, label }) => ({ mode: label, amount: Number(modes[key] || 0) }))
    .filter((p) => p.amount > 0.009);
}

/**
 * Bill-cancel refund must reverse the same mode columns as the original payment
 * (Cash/GPay/…). Scales if refundTotal differs slightly from the paid split.
 */
export function buildCancelRefundPayments(
  payments: Array<{ mode?: string; amount?: number }> | null | undefined,
  refundTotal: number,
  fallbackModes?: PaymentModeAmounts | null,
): Array<{ mode: string; amount: number }> {
  const total = Math.round(Number(refundTotal || 0) * 100) / 100;
  if (total <= 0.009) return [];

  let entries = (Array.isArray(payments) ? payments : [])
    .map((p) => ({
      mode: String(p?.mode || "").trim(),
      amount: Math.round(Number(p?.amount || 0) * 100) / 100,
    }))
    .filter((p) => p.mode && p.amount > 0.009);

  if (!entries.length && fallbackModes) {
    entries = paymentsFromModeAmounts(fallbackModes);
  }
  if (!entries.length) {
    return [{ mode: "Cash", amount: total }];
  }

  const paidSum = entries.reduce((s, p) => s + p.amount, 0);
  if (paidSum <= 0.009) return [{ mode: "Cash", amount: total }];

  const scale = total / paidSum;
  const out = entries.map((p) => ({
    mode: p.mode,
    amount: Math.round(p.amount * scale * 100) / 100,
  }));
  const sum = out.reduce((s, p) => s + p.amount, 0);
  const drift = Math.round((total - sum) * 100) / 100;
  if (Math.abs(drift) >= 0.01 && out.length) {
    out[out.length - 1].amount = Math.round((out[out.length - 1].amount + drift) * 100) / 100;
  }
  return out.filter((p) => p.amount > 0.009);
}

export function refundModesLabel(
  payments: Array<{ mode?: string; amount?: number }> | null | undefined,
): string {
  const modes = Array.from(
    new Set(
      (Array.isArray(payments) ? payments : [])
        .filter((p) => Number(p?.amount || 0) > 0.009 && String(p?.mode || "").trim())
        .map((p) => String(p.mode).trim()),
    ),
  );
  return modes.length ? modes.join("/") : "—";
}