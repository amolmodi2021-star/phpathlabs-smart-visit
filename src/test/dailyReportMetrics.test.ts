import { describe, expect, it } from "vitest";
import { paymentRowGross, paymentRowPaid } from "@/lib/dailyReportMetrics";

describe("dailyReportMetrics", () => {
  it("adds live HVC onto registration gross", () => {
    expect(paymentRowGross(
      { transaction_type: "registration_payment", gross_amount: 0, final_amount: 300, registration_id: "a" },
      { a: 300 },
    )).toBe(300);
  });

  it("infers HVC from frozen final when live HVC was cleared", () => {
    expect(paymentRowGross(
      { transaction_type: "registration_payment", gross_amount: 0, discount_amount: 0, final_amount: 300, registration_id: "a" },
      { a: 0 },
    )).toBe(300);
  });

  it("does not invent HVC for normal walk-in bills", () => {
    expect(paymentRowGross(
      { transaction_type: "registration_payment", gross_amount: 1000, discount_amount: 100, final_amount: 900, registration_id: "a" },
      {},
    )).toBe(1000);
  });

  it("paid for refunds is signed outflow", () => {
    expect(paymentRowPaid({ transaction_type: "refund", total_amount: -300, refund_amount: 300 })).toBe(-300);
  });

  it("test_cancellation gross is used as-is (negative offset)", () => {
    expect(paymentRowGross(
      { transaction_type: "test_cancellation", gross_amount: -42000, final_amount: -41960 },
      {},
    )).toBe(-42000);
  });
});