import { describe, expect, it } from "vitest";
import {
  capAmountToRemaining,
  collectedExceedsBill,
  billAmountChanged,
  isOverpaymentMessage,
  mergeEditedRegistrationSplit,
  OVERPAYMENT_MESSAGE,
  paymentSelectionIsSet,
  paymentsExceedBill,
  remainingDue,
  splitRegistrationAndDuePayments,
  sumPaymentEntries,
  assertCollectedDoesNotExceedBill,
} from "@/lib/billPayment";

describe("billPayment", () => {
  const dueGpay = { mode: "GPay", amount: 1730, date: "2026-08-16T07:02:32.848Z" };

  it("splits registration vs dated due-collection entries", () => {
    const { registration, dueCollections } = splitRegistrationAndDuePayments([
      { mode: "GPay", amount: 1730 },
      dueGpay,
    ]);
    expect(sumPaymentEntries(registration)).toBe(1730);
    expect(sumPaymentEntries(dueCollections)).toBe(1730);
  });

  it("flags payment lines that exceed the bill", () => {
    expect(paymentsExceedBill([{ mode: "GPay", amount: 1730 }, dueGpay], 1730)).toBe(true);
    expect(paymentsExceedBill([dueGpay], 1730)).toBe(false);
  });

  it("caps a collection to remaining due", () => {
    expect(remainingDue(1730, 1730)).toBe(0);
    expect(capAmountToRemaining(1730, 1730, 1730)).toBe(0);
    expect(capAmountToRemaining(500, 1000, 1730)).toBe(500);
    expect(capAmountToRemaining(900, 1000, 1730)).toBe(730);
  });

  it("rejects inventing a registration GPay after due was already collected", () => {
    expect(() => mergeEditedRegistrationSplit([dueGpay], [{ mode: "GPay", amount: 1730 }], 1730)).toThrow(
      /already collected as due/,
    );
  });

  it("keeps a mode-only edit of the original registration split", () => {
    const merged = mergeEditedRegistrationSplit(
      [{ mode: "Cash", amount: 1730 }],
      [{ mode: "GPay", amount: 1730 }],
      1730,
    );
    expect(merged).toEqual([{ mode: "GPay", amount: 1730 }]);
  });

  it("preserves due-collection rows when the original split is unchanged", () => {
    const merged = mergeEditedRegistrationSplit(
      [{ mode: "Cash", amount: 500 }, dueGpay],
      [{ mode: "GPay", amount: 500 }],
      2230,
    );
    expect(merged).toEqual([{ mode: "GPay", amount: 500 }, dueGpay]);
  });

  it("detects a stale collected amount after the bill is discounted", () => {
    expect(collectedExceedsBill(1000, 800)).toBe(true);
    expect(collectedExceedsBill(800, 800)).toBe(false);
    expect(collectedExceedsBill(0, 800)).toBe(false);
    expect(() => assertCollectedDoesNotExceedBill(1000, 800)).toThrow(OVERPAYMENT_MESSAGE);
    expect(() => assertCollectedDoesNotExceedBill(800, 800)).not.toThrow();
  });

  it("treats any bill-total change as a reason to clear payment modes", () => {
    expect(billAmountChanged(1000, 800)).toBe(true);
    expect(billAmountChanged(1000, 1200)).toBe(true);
    expect(billAmountChanged(1000, 1000)).toBe(false);
    expect(paymentSelectionIsSet(new Set(["Cash", "GPay"]), { Cash: 400, GPay: 600 })).toBe(true);
    expect(paymentSelectionIsSet(new Set(), {})).toBe(false);
  });

  it("recognizes overpayment errors from client and database messages", () => {
    expect(isOverpaymentMessage(OVERPAYMENT_MESSAGE)).toBe(true);
    expect(isOverpaymentMessage("Payment (₹1200) cannot exceed the bill value (₹800)")).toBe(true);
    expect(isOverpaymentMessage("Payment cannot exceed grand total")).toBe(true);
    expect(isOverpaymentMessage("Valid mobile number required")).toBe(false);
  });
});
