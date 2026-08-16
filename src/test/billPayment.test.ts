import { describe, expect, it } from "vitest";
import {
  capAmountToRemaining,
  mergeEditedRegistrationSplit,
  paymentsExceedBill,
  remainingDue,
  splitRegistrationAndDuePayments,
  sumPaymentEntries,
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
});
