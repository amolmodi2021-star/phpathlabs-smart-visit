import { describe, expect, it } from "vitest";
import { buildCancelRefundPayments, refundModesLabel } from "@/lib/cancelRefundModes";

describe("buildCancelRefundPayments", () => {
  it("keeps the original GPay column for a single-mode refund", () => {
    const payments = buildCancelRefundPayments([{ mode: "GPay", amount: 300 }], 300);
    expect(payments).toEqual([{ mode: "GPay", amount: 300 }]);
    expect(refundModesLabel(payments)).toBe("GPay");
  });

  it("splits multi-mode refunds proportionally", () => {
    const payments = buildCancelRefundPayments(
      [
        { mode: "Cash", amount: 100 },
        { mode: "GPay", amount: 200 },
      ],
      300,
    );
    expect(payments).toEqual([
      { mode: "Cash", amount: 100 },
      { mode: "GPay", amount: 200 },
    ]);
  });

  it("falls back to frozen registration mode columns when payments[] is empty", () => {
    const payments = buildCancelRefundPayments([], 300, {
      cash: 0,
      gpay: 300,
      paytm: 0,
      credit_card: 0,
      neft: 0,
    });
    expect(payments).toEqual([{ mode: "GPay", amount: 300 }]);
  });
});