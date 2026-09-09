import { describe, expect, it } from "vitest";
import {
  canSaveHvChargeOnly,
  isHvChargeOnlyRegistration,
  refundableHomeVisitCharges,
} from "@/lib/hvChargeOnly";

describe("hvChargeOnly", () => {
  it("detects charge-only registrations", () => {
    expect(isHvChargeOnlyRegistration({
      hv_charge_only: true,
      visit_type: "home_visit",
      home_visit_charges: 200,
      tests: [],
    })).toBe(true);
    expect(isHvChargeOnlyRegistration({
      visit_type: "home_visit",
      home_visit_charges: 200,
      tests: [],
    })).toBe(true);
    expect(isHvChargeOnlyRegistration({
      visit_type: "home_visit",
      home_visit_charges: 200,
      tests: [{ test_id: "1" }],
    })).toBe(false);
  });

  it("allows save only for home visit with charges and no tests", () => {
    expect(canSaveHvChargeOnly({
      visitType: "home_visit",
      selectedTestCount: 0,
      homeVisitCharges: 150,
    })).toBe(true);
    expect(canSaveHvChargeOnly({
      visitType: "walk_in",
      selectedTestCount: 0,
      homeVisitCharges: 150,
    })).toBe(false);
  });

  it("refunds only received HVC (tests paid first)", () => {
    expect(refundableHomeVisitCharges({
      home_visit_charges: 300,
      final_amount: 300,
      paid_amount: 300,
    })).toBe(300);
    expect(refundableHomeVisitCharges({
      home_visit_charges: 300,
      final_amount: 300,
      paid_amount: 100,
    })).toBe(100);
    expect(refundableHomeVisitCharges({
      home_visit_charges: 300,
      final_amount: 1000,
      paid_amount: 1000,
    })).toBe(300);
    expect(refundableHomeVisitCharges({
      home_visit_charges: 300,
      final_amount: 1000,
      paid_amount: 200,
    })).toBe(0);
  });
});