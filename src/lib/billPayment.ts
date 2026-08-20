/** Payment entries stored on patient_registrations.payments */

export type BillPaymentEntry = {
  mode?: string;
  amount?: number;
  date?: string | null;
};

export function paymentEntryAmount(entry: BillPaymentEntry | null | undefined): number {
  const n = Number(entry?.amount || 0);
  return Number.isFinite(n) ? n : 0;
}

/** Due-collection rows are stamped with `date`; registration-time split is not. */
export function isDueCollectionEntry(entry: BillPaymentEntry | null | undefined): boolean {
  return !!(entry && entry.date);
}

export function splitRegistrationAndDuePayments(payments: BillPaymentEntry[] | null | undefined): {
  registration: BillPaymentEntry[];
  dueCollections: BillPaymentEntry[];
} {
  const list = Array.isArray(payments) ? payments.filter((p) => p && typeof p === "object") : [];
  return {
    registration: list.filter((p) => !isDueCollectionEntry(p)),
    dueCollections: list.filter((p) => isDueCollectionEntry(p)),
  };
}

export function sumPaymentEntries(payments: BillPaymentEntry[] | null | undefined): number {
  if (!Array.isArray(payments)) return 0;
  return payments.reduce((sum, p) => sum + paymentEntryAmount(p), 0);
}

export function remainingDue(finalAmount: number, paidAmount: number): number {
  return Math.max(0, Number(finalAmount || 0) - Number(paidAmount || 0));
}

export function capAmountToRemaining(amount: number, paidSoFar: number, finalAmount: number): number {
  const remaining = remainingDue(finalAmount, paidSoFar);
  const n = Number(amount || 0);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(n, remaining);
}

export const OVERPAYMENT_MESSAGE = "Collected amount is greater than total bill amount";

export function paymentsExceedBill(
  payments: BillPaymentEntry[] | null | undefined,
  finalAmount: number,
  epsilon = 0.01,
): boolean {
  return sumPaymentEntries(payments) > Number(finalAmount || 0) + epsilon;
}

export function collectedExceedsBill(
  collected: number,
  billAmount: number,
  epsilon = 0.009,
): boolean {
  return Number(collected || 0) > Number(billAmount || 0) + epsilon;
}

export function billAmountChanged(
  previous: number,
  next: number,
  epsilon = 0.009,
): boolean {
  return Math.abs(Number(previous || 0) - Number(next || 0)) > epsilon;
}

export function paymentSelectionIsSet(
  selectedModes: Set<string> | Iterable<string>,
  modeAmounts: Record<string, number>,
): boolean {
  const modes = selectedModes instanceof Set ? selectedModes : new Set(selectedModes);
  if (modes.size > 0) return true;
  return Object.values(modeAmounts || {}).some((n) => Number(n || 0) !== 0);
}

export function isOverpaymentMessage(message: string | undefined | null): boolean {
  const m = String(message || "");
  return /greater than total bill|cannot exceed the (final amount|bill value|grand total)|cannot exceed grand total/i.test(m);
}

export function assertCollectedDoesNotExceedBill(collected: number, billAmount: number): void {
  if (collectedExceedsBill(collected, billAmount)) {
    throw new Error(OVERPAYMENT_MESSAGE);
  }
}

/**
 * Rebuild the payments array after editing the original (undated) split.
 * Due-collection rows are kept as-is. The edited split must not invent a
 * second full payment on top of money already collected as due.
 */
export function mergeEditedRegistrationSplit(
  existingPayments: BillPaymentEntry[] | null | undefined,
  editedSplit: BillPaymentEntry[],
  finalAmount: number,
): BillPaymentEntry[] {
  const { registration, dueCollections } = splitRegistrationAndDuePayments(existingPayments);
  const originalPaid = sumPaymentEntries(registration);
  const editedPaid = sumPaymentEntries(editedSplit);
  const duePaid = sumPaymentEntries(dueCollections);

  if (originalPaid <= 0.01 && duePaid > 0.01 && editedPaid > 0.01) {
    throw new Error(
      "This bill was already collected as due. Do not add another registration payment — that would record the same money twice.",
    );
  }

  if (originalPaid > 0.01 && Math.abs(editedPaid - originalPaid) > 0.01) {
    throw new Error(`Payment mode split must equal the original registration payment of ₹${originalPaid}`);
  }

  const merged = [...editedSplit.filter((p) => paymentEntryAmount(p) > 0), ...dueCollections];
  if (paymentsExceedBill(merged, finalAmount)) {
    throw new Error(`Payment lines cannot exceed the bill value of ₹${finalAmount}`);
  }
  return merged;
}

/**
 * Rebuild payments after paid_amount is capped downward (e.g. overpayment refund).
 * Due-collection rows (`date`) are preserved; undated registration lines are kept
 * only for the remainder, so we never invent a second full payment on top of due.
 */
export function rebuildPaymentsForPaidCap(
  existingPayments: BillPaymentEntry[] | null | undefined,
  newPaidCap: number,
  preferredRegistrationSplit?: BillPaymentEntry[],
): BillPaymentEntry[] {
  const { registration, dueCollections } = splitRegistrationAndDuePayments(existingPayments);
  const duePaid = sumPaymentEntries(dueCollections);
  const cap = Math.max(0, Number(newPaidCap || 0));

  if (duePaid >= cap - 0.01) {
    if (duePaid <= cap + 0.01) {
      return dueCollections.map((p) => ({ ...p }));
    }
    const scale = duePaid > 0 ? cap / duePaid : 0;
    return dueCollections
      .map((p) => ({ ...p, amount: Number((paymentEntryAmount(p) * scale).toFixed(2)) }))
      .filter((p) => paymentEntryAmount(p) > 0);
  }

  const regTarget = cap - duePaid;
  const source =
    preferredRegistrationSplit && sumPaymentEntries(preferredRegistrationSplit) > 0.01
      ? preferredRegistrationSplit
      : registration;
  const regPaid = sumPaymentEntries(source);
  if (regPaid <= 0.01 || regTarget <= 0.01) {
    return [...dueCollections];
  }
  const scaledReg = source
    .map((p) => ({
      mode: p.mode,
      amount: Number(((paymentEntryAmount(p) * regTarget) / regPaid).toFixed(2)),
    }))
    .filter((p) => paymentEntryAmount(p) > 0);
  return [...scaledReg, ...dueCollections];
}
