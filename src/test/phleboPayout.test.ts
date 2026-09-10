import { describe, expect, it } from "vitest";
import {
  buildIncentiveCatalog,
  buildIncentiveMap,
  payoutBucketNet,
  registrationHvc,
  registrationIncentiveAmount,
  registrationIncentiveDetails,
  registrationPayoutBucket,
} from "@/lib/phleboPayout";

describe("phleboPayout", () => {
  const incentives = buildIncentiveMap([
    [{ id: "cbc", incentive_allowed: true, incentive_amount: 20 }],
    [{ id: "pkg", incentive_allowed: true, incentive_amount: 100 }],
    [{ id: "no", incentive_allowed: false, incentive_amount: 50 }],
  ]);

  const catalog = buildIncentiveCatalog([
    { rows: [{ id: "cbc", name: "CBC", incentive_allowed: true, incentive_amount: 20 }] },
    { rows: [{ id: "pkg", name: "Health Package (Package)", incentive_allowed: true, incentive_amount: 100 }] },
  ]);

  it("uses registration HVC only (never estimate)", () => {
    expect(registrationHvc({ home_visit_charges: 50 })).toBe(50);
    expect(registrationHvc({ home_visit_charges: 0 })).toBe(0);
  });

  it("does not treat secondary patient (HVC 0) as deducted", () => {
    expect(registrationPayoutBucket({ bill_cancelled: false, due_amount: 0 })).toBe("earned");
  });

  it("deducts cancelled bills", () => {
    expect(registrationPayoutBucket({ bill_cancelled: true, due_amount: 0 })).toBe("deducted");
  });

  it("holds unpaid dues", () => {
    expect(registrationPayoutBucket({ bill_cancelled: false, due_amount: 100 })).toBe("hold");
  });

  it("sums incentives for active tests only", () => {
    const amt = registrationIncentiveAmount(
      {
        bill_cancelled: false,
        tests: [{ test_id: "cbc" }, { test_id: "pkg" }],
        cancelled_tests: [],
      },
      incentives,
    );
    expect(amt).toBe(120);
  });

  it("excludes partially cancelled tests from active incentive", () => {
    const amt = registrationIncentiveAmount(
      {
        bill_cancelled: false,
        tests: [{ test_id: "pkg" }],
        cancelled_tests: [{ test_id: "cbc" }],
      },
      incentives,
    );
    expect(amt).toBe(100);
  });

  it("on full cancel, incentives include cancelled lines", () => {
    const amt = registrationIncentiveAmount(
      {
        bill_cancelled: true,
        tests: [{ test_id: "pkg" }],
        cancelled_tests: [{ test_id: "cbc" }],
      },
      incentives,
    );
    expect(amt).toBe(120);
  });

  it("computes net payable once (earned − hold − deducted)", () => {
    expect(payoutBucketNet({ earned: 500, hold: 100, deducted: 50 })).toBe(350);
    expect(payoutBucketNet({ earned: 0, hold: 80, deducted: 0 })).toBe(-80);
  });
});