import { describe, expect, it } from "vitest";
import { resolveCancelBillSnapshot } from "@/lib/cancelBillSnapshot";

describe("resolveCancelBillSnapshot", () => {
  it("uses live amounts when still present", () => {
    const s = resolveCancelBillSnapshot(
      { gross_amount: 100, home_visit_charges: 50, discount_amount: 10, final_amount: 140, paid_amount: 140 },
      null,
      0,
    );
    expect(s.origGross).toBe(150);
    expect(s.origFinal).toBe(140);
    expect(s.refundCash).toBe(140);
  });

  it("falls back to frozen snapshot when live was zeroed by prior HVC refund", () => {
    const s = resolveCancelBillSnapshot(
      { gross_amount: 0, home_visit_charges: 0, discount_amount: 0, final_amount: 0, paid_amount: 0 },
      { gross_amount: 0, discount_amount: 0, final_amount: 50, paid_amount: 50 },
      50,
    );
    expect(s.origGross).toBe(50);
    expect(s.origFinal).toBe(50);
    expect(s.refundCash).toBe(0);
  });

  it("does not double-refund after partial refund already logged", () => {
    const s = resolveCancelBillSnapshot(
      { gross_amount: 0, home_visit_charges: 0, discount_amount: 0, final_amount: 0, paid_amount: 0 },
      { gross_amount: 100, discount_amount: 0, final_amount: 100, paid_amount: 100 },
      40,
    );
    expect(s.refundCash).toBe(60);
    expect(s.origFinal).toBe(100);
  });
});