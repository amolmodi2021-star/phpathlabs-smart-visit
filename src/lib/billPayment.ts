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

const ALLOWED_PAYMENT_MODES = new Set(["Cash", "GPay", "Paytm", "Credit Card", "NEFT"]);

export type DueCollectionGroup = {
  date: string;
  entries: BillPaymentEntry[];
  total: number;
};

/** One due-collection event (same `date` stamp) — may contain a Cash+GPay split. */
export function groupDueCollectionsByDate(
  dueCollections: BillPaymentEntry[] | null | undefined,
): DueCollectionGroup[] {
  const list = Array.isArray(dueCollections) ? dueCollections : [];
  const map = new Map<string, BillPaymentEntry[]>();
  for (const p of list) {
    const key = String(p.date || "");
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(p);
  }
  return [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, entries]) => ({
      date,
      entries,
      total: sumPaymentEntries(entries),
    }));
}

export type DueCollectionGroupEdit = {
  date: string;
  /** Locked collection total — mode split must equal this. */
  total: number;
  modeAmounts: Record<string, number>;
};

function normalizeModeAmounts(modeAmounts: Record<string, number> | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [mode, amount] of Object.entries(modeAmounts || {})) {
    const n = Number(amount || 0);
    if (!ALLOWED_PAYMENT_MODES.has(mode) || !(n > 0)) continue;
    out[mode] = n;
  }
  return out;
}

/**
 * Rebuild due-collection payment lines from per-collection mode splits.
 * Each group's total must match the original collection total; dates stay fixed.
 */
export function buildDueCollectionsFromGroupEdits(
  groups: DueCollectionGroupEdit[],
): BillPaymentEntry[] {
  const out: BillPaymentEntry[] = [];
  for (const g of groups) {
    const date = String(g.date || "");
    if (!date) throw new Error("Due collection is missing its collection timestamp");
    const modes = normalizeModeAmounts(g.modeAmounts);
    const entries = Object.entries(modes).map(([mode, amount]) => ({
      mode,
      amount,
      date,
    }));
    if (entries.length === 0) {
      throw new Error("Each due collection needs at least one payment mode");
    }
    const sum = sumPaymentEntries(entries);
    const total = Number(g.total || 0);
    if (Math.abs(sum - total) > 0.01) {
      throw new Error(`Due collection split must equal ₹${total}`);
    }
    out.push(...entries);
  }
  return out;
}

/**
 * Replace due-collection lines with edited per-collection mode splits.
 * Registration (undated) lines are preserved. Collection totals/dates cannot change.
 */
export function applyDueCollectionGroupEdits(
  existingPayments: BillPaymentEntry[] | null | undefined,
  groupEdits: DueCollectionGroupEdit[],
): BillPaymentEntry[] {
  const { registration, dueCollections } = splitRegistrationAndDuePayments(existingPayments);
  const originalGroups = groupDueCollectionsByDate(dueCollections);
  if (originalGroups.length === 0) {
    return [...registration];
  }
  if (groupEdits.length !== originalGroups.length) {
    throw new Error("Due collection list does not match existing due payments");
  }
  for (let i = 0; i < originalGroups.length; i++) {
    const orig = originalGroups[i];
    const edit = groupEdits[i];
    if (String(edit.date || "") !== orig.date) {
      throw new Error("Due collection dates cannot be changed");
    }
    if (Math.abs(Number(edit.total || 0) - orig.total) > 0.01) {
      throw new Error("Due collection totals cannot be changed — only payment modes");
    }
  }
  return [...registration, ...buildDueCollectionsFromGroupEdits(groupEdits)];
}

export function dueCollectionGroupEditsChanged(
  existingPayments: BillPaymentEntry[] | null | undefined,
  groupEdits: DueCollectionGroupEdit[],
): boolean {
  const { dueCollections } = splitRegistrationAndDuePayments(existingPayments);
  const originalGroups = groupDueCollectionsByDate(dueCollections);
  if (originalGroups.length === 0) return false;
  if (groupEdits.length !== originalGroups.length) return true;
  try {
    const rebuilt = buildDueCollectionsFromGroupEdits(groupEdits);
    if (rebuilt.length !== dueCollections.length) return true;
    const norm = (rows: BillPaymentEntry[]) =>
      rows
        .map((p) => `${p.date}|${p.mode}|${paymentEntryAmount(p).toFixed(2)}`)
        .sort()
        .join(";");
    return norm(rebuilt) !== norm(dueCollections);
  } catch {
    return true;
  }
}

/** @deprecated Use applyDueCollectionGroupEdits — kept for simple single-line remaps in tests. */
export function applyDueCollectionModeEdits(
  existingPayments: BillPaymentEntry[] | null | undefined,
  dueModes: string[],
): BillPaymentEntry[] {
  const { dueCollections } = splitRegistrationAndDuePayments(existingPayments);
  const groups = groupDueCollectionsByDate(dueCollections);
  // Flat per-line mode list (legacy): one mode per dated entry, in group order.
  let cursor = 0;
  const edits: DueCollectionGroupEdit[] = groups.map((g) => {
    const modeAmounts: Record<string, number> = {};
    for (const entry of g.entries) {
      const mode = String(dueModes[cursor++] || entry.mode || "").trim();
      modeAmounts[mode] = (modeAmounts[mode] || 0) + paymentEntryAmount(entry);
    }
    return { date: g.date, total: g.total, modeAmounts };
  });
  if (cursor !== dueModes.length) {
    throw new Error("Due collection mode list does not match existing due payments");
  }
  return applyDueCollectionGroupEdits(existingPayments, edits);
}

export function dueCollectionModesChanged(
  existingPayments: BillPaymentEntry[] | null | undefined,
  dueModes: string[],
): boolean {
  const { dueCollections } = splitRegistrationAndDuePayments(existingPayments);
  if (dueCollections.length === 0) return false;
  if (dueModes.length !== dueCollections.length) return true;
  return dueCollections.some((p, i) => String(p.mode || "") !== String(dueModes[i] || ""));
}
