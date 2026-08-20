import { describe, expect, it } from "vitest";
import {
  capAmountToRemaining,
  collectedExceedsBill,
  billAmountChanged,
  isOverpaymentMessage,
  mergeEditedRegistrationSplit,
  rebuildPaymentsForPaidCap,
  applyDueCollectionModeEdits,
  dueCollectionModesChanged,
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

  it("rejects mode-edit overshoot like bill 2608120032 (undated + dated full bill)", () => {
    const dueNeft = { mode: "NEFT", amount: 550, date: "2026-08-12T13:34:37.191Z" };
    expect(() =>
      mergeEditedRegistrationSplit([dueNeft], [{ mode: "GPay", amount: 550 }], 550),
    ).toThrow(/already collected as due/);
    expect(() =>
      mergeEditedRegistrationSplit(
        [{ mode: "GPay", amount: 550 }, dueNeft],
        [{ mode: "Cash", amount: 550 }],
        550,
      ),
    ).toThrow(/cannot exceed the bill value/);
  });

  it("on overpayment cap, keeps due-only payments and does not invent registration GPay", () => {
    const rebuilt = rebuildPaymentsForPaidCap([dueGpay], 1730, [{ mode: "GPay", amount: 1730 }]);
    expect(rebuilt).toEqual([dueGpay]);
    expect(sumPaymentEntries(rebuilt)).toBe(1730);
  });

  it("on overpayment cap, scales registration split and preserves due collections", () => {
    const due = { mode: "NEFT", amount: 200, date: "2026-08-12T13:34:37.191Z" };
    const rebuilt = rebuildPaymentsForPaidCap(
      [{ mode: "Cash", amount: 400 }, due],
      500,
      [{ mode: "GPay", amount: 400 }],
    );
    expect(sumPaymentEntries(rebuilt)).toBe(500);
    expect(rebuilt.some((p) => p.date && p.mode === "NEFT" && p.amount === 200)).toBe(true);
    expect(rebuilt.some((p) => !p.date && p.mode === "GPay" && p.amount === 300)).toBe(true);
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

  it("remaps due collection mode without changing amount or inventing registration pay", () => {
    const due = { mode: "GPay", amount: 550, date: "2026-08-12T13:34:37.191Z" };
    const remapped = applyDueCollectionModeEdits([due], ["NEFT"]);
    expect(remapped).toEqual([{ mode: "NEFT", amount: 550, date: due.date }]);
    expect(dueCollectionModesChanged([due], ["NEFT"])).toBe(true);
    expect(dueCollectionModesChanged([due], ["GPay"])).toBe(false);
  });

  it("preserves registration split when remapping due collection mode", () => {
    const due = { mode: "Cash", amount: 300, date: "2026-08-12T13:34:37.191Z" };
    const remapped = applyDueCollectionModeEdits(
      [{ mode: "GPay", amount: 200 }, due],
      ["NEFT"],
    );
    expect(remapped).toEqual([
      { mode: "GPay", amount: 200 },
      { mode: "NEFT", amount: 300, date: due.date },
    ]);
  });
});
