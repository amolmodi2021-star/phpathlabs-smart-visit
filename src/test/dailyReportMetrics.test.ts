import { describe, expect, it } from "vitest";
import {
  paymentRowGross,
  paymentRowPaid,
  mergeSameTimestampTestCancelRefunds,
} from "@/lib/dailyReportMetrics";

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

  it("paid for post_discount_refund is signed outflow", () => {
    expect(paymentRowPaid({
      transaction_type: "post_discount_refund",
      total_amount: -10,
      refund_amount: 10,
    })).toBe(-10);
  });

  it("paid for test_cancellation with cash is signed outflow", () => {
    expect(paymentRowPaid({
      transaction_type: "test_cancellation",
      total_amount: -240,
      refund_amount: 240,
      paid_amount: 0,
    })).toBe(-240);
  });

  it("merges legacy cancel + refund for the same action", () => {
    const merged = mergeSameTimestampTestCancelRefunds([
      {
        id: "c1",
        invoice_number: "2609100001",
        registration_id: "r1",
        transaction_type: "test_cancellation",
        transaction_date: "2026-09-09T19:11:00.000Z",
        gross_amount: -300,
        discount_amount: -60,
        final_amount: -240,
        refund_amount: 0,
        total_amount: 0,
        cash_amount: 0,
        remarks: "1 test(s) cancelled",
      },
      {
        id: "rf1",
        invoice_number: "2609100001",
        registration_id: "r1",
        transaction_type: "refund",
        transaction_date: "2026-09-09T19:11:30.000Z",
        refund_amount: 240,
        total_amount: -240,
        cash_amount: -240,
        remarks: "1 test(s) cancelled — refund",
      },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].refund_amount).toBe(240);
  });

  it("keeps later cancel events as separate rows", () => {
    const merged = mergeSameTimestampTestCancelRefunds([
      {
        id: "c1",
        invoice_number: "2609100001",
        registration_id: "r1",
        transaction_type: "test_cancellation",
        transaction_date: "2026-09-09T19:11:00.000Z",
        gross_amount: -300,
        discount_amount: -60,
        final_amount: -240,
        refund_amount: 240,
        total_amount: -240,
        cash_amount: -240,
        remarks: "1 test(s) cancelled — refund",
      },
      {
        id: "c2",
        invoice_number: "2609100001",
        registration_id: "r1",
        transaction_type: "test_cancellation",
        transaction_date: "2026-09-09T19:20:00.000Z",
        gross_amount: -50,
        discount_amount: -10,
        final_amount: -40,
        refund_amount: 40,
        total_amount: -40,
        cash_amount: -40,
        remarks: "1 test(s) cancelled — refund",
      },
    ]);
    expect(merged).toHaveLength(2);
    expect(merged[0].id).toBe("c1");
    expect(merged[1].id).toBe("c2");
  });

  it("does not attach a later refund to an earlier cancel", () => {
    const merged = mergeSameTimestampTestCancelRefunds([
      {
        id: "c1",
        invoice_number: "2609100001",
        registration_id: "r1",
        transaction_type: "test_cancellation",
        transaction_date: "2026-09-09T19:11:00.000Z",
        final_amount: -240,
        refund_amount: 0,
        total_amount: 0,
        cash_amount: 0,
        remarks: "1 test(s) cancelled",
      },
      {
        id: "rf2",
        invoice_number: "2609100001",
        registration_id: "r1",
        transaction_type: "refund",
        transaction_date: "2026-09-09T19:20:00.000Z",
        refund_amount: 40,
        total_amount: -40,
        cash_amount: -40,
        remarks: "1 test(s) cancelled — refund",
      },
    ]);
    expect(merged).toHaveLength(2);
  });
});