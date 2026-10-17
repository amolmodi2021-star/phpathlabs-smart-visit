import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  cancelledTestIdSet,
  recalculateRegistrationAtRates,
  shouldRepriceRegistration,
} from "@/lib/pickupInvoiceReprocessCalc";

const prices = (entries: Array<[string, number]>) => new Map(entries);

describe("shouldRepriceRegistration", () => {
  const invoiceRegs = new Set(["reg-sept-1", "reg-sept-2"]);

  it("allows only patients listed on that invoice for that pickup", () => {
    expect(shouldRepriceRegistration("pp-vasu", invoiceRegs, {
      id: "reg-sept-1",
      pickup_point_id: "pp-vasu",
    })).toBe(true);
  });

  it("rejects other invoices' patients and other pickup points", () => {
    expect(shouldRepriceRegistration("pp-vasu", invoiceRegs, {
      id: "reg-aug-1",
      pickup_point_id: "pp-vasu",
    })).toBe(false);
    expect(shouldRepriceRegistration("pp-vasu", invoiceRegs, {
      id: "reg-sept-1",
      pickup_point_id: "pp-other",
    })).toBe(false);
    expect(shouldRepriceRegistration("pp-vasu", invoiceRegs, {
      id: "reg-sept-1",
      pickup_point_id: "pp-vasu",
      bill_cancelled: true,
    })).toBe(false);
  });
});

describe("cancelledTestIdSet", () => {
  it("reads ids from strings and objects", () => {
    expect([...cancelledTestIdSet(["cbc", { test_id: "lft" }])].sort()).toEqual(["cbc", "lft"]);
  });
});

describe("recalculateRegistrationAtRates", () => {
  it("revises CBC from 250 to 150 and leaves unmapped tests", () => {
    const next = recalculateRegistrationAtRates(
      {
        tests: [
          { test_id: "cbc", test_name: "CBC", price: 250, discount: 0, discounted_price: 250 },
          { test_id: "crp", test_name: "CRP", price: 400, discount: 0, discounted_price: 400 },
        ],
        paid_amount: 0,
      },
      prices([["cbc", 150]]),
    );
    expect(next.changed).toBe(true);
    expect(next.tests[0].price).toBe(150);
    expect(next.tests[0].discounted_price).toBe(150);
    expect(next.tests[1].price).toBe(400);
    expect(next.gross_amount).toBe(550);
    expect(next.final_amount).toBe(550);
    expect(next.due_amount).toBe(550);
    expect(next.test_names).toBe("CBC, CRP");
  });

  it("scales a stored line discount when the list price changes", () => {
    const next = recalculateRegistrationAtRates(
      {
        tests: [
          { test_id: "cbc", test_name: "CBC", price: 250, discount: 50, discounted_price: 200 },
        ],
        paid_amount: 0,
      },
      prices([["cbc", 150]]),
    );
    expect(next.tests[0].price).toBe(150);
    expect(next.tests[0].discount).toBe(30);
    expect(next.tests[0].discounted_price).toBe(120);
    expect(next.final_amount).toBe(120);
  });

  it("recomputes a global percent discount on the new price", () => {
    const next = recalculateRegistrationAtRates(
      {
        tests: [
          { test_id: "cbc", test_name: "CBC", price: 250, discount: 25, discounted_price: 225 },
        ],
        global_discount_type: "percent",
        global_discount_value: 10,
        paid_amount: 0,
      },
      prices([["cbc", 150]]),
    );
    expect(next.tests[0].discount).toBe(15);
    expect(next.final_amount).toBe(135);
  });

  it("excludes cancelled tests from the new bill", () => {
    const next = recalculateRegistrationAtRates(
      {
        tests: [
          { test_id: "cbc", test_name: "CBC", price: 250, discount: 0, discounted_price: 250 },
          { test_id: "lft", test_name: "LFT", price: 500, discount: 0, discounted_price: 500 },
        ],
        cancelled_tests: [{ test_id: "lft" }],
        paid_amount: 0,
      },
      prices([["cbc", 150], ["lft", 400]]),
    );
    expect(next.tests[1].discounted_price).toBe(0);
    expect(next.gross_amount).toBe(150);
    expect(next.final_amount).toBe(150);
    expect(next.test_names).toBe("CBC");
  });

  it("keeps due in sync with paid amount and zeroes a cancelled bill", () => {
    const open = recalculateRegistrationAtRates(
      {
        tests: [{ test_id: "cbc", test_name: "CBC", price: 250, discounted_price: 250 }],
        paid_amount: 50,
      },
      prices([["cbc", 150]]),
    );
    expect(open.final_amount).toBe(150);
    expect(open.due_amount).toBe(100);

    const cancelled = recalculateRegistrationAtRates(
      {
        tests: [{ test_id: "cbc", test_name: "CBC", price: 250, discounted_price: 250 }],
        paid_amount: 50,
        bill_cancelled: true,
      },
      prices([["cbc", 150]]),
    );
    expect(cancelled.final_amount).toBe(0);
    expect(cancelled.due_amount).toBe(0);
  });

  it("reports unchanged when the mapped rate already matches", () => {
    const next = recalculateRegistrationAtRates(
      {
        tests: [{ test_id: "cbc", test_name: "CBC", price: 150, discount: 0, discounted_price: 150 }],
        paid_amount: 0,
      },
      prices([["cbc", 150]]),
    );
    expect(next.changed).toBe(false);
    expect(next.final_amount).toBe(150);
  });
});

describe("invoice reprocess wiring", () => {
  it("exposes Reprocess on dashboard and generate, and syncs Daily Report rows", () => {
    const dashboard = fs.readFileSync(
      path.resolve(process.cwd(), "src/components/lims/BillingDashboard.tsx"),
      "utf8",
    );
    const generate = fs.readFileSync(
      path.resolve(process.cwd(), "src/components/lims/BillingGenerate.tsx"),
      "utf8",
    );
    const impl = fs.readFileSync(
      path.resolve(process.cwd(), "src/lib/pickupInvoiceReprocess.ts"),
      "utf8",
    );
    expect(dashboard).toContain("reprocessPickupInvoice");
    expect(dashboard).toContain("reprocess.variables === inv.id");
    expect(dashboard).toContain("Only the ${inv.patient_count} patient(s) already on this invoice");
    expect(generate).toContain("reprocessPickupInvoice");
    expect(generate).toContain("reprocess.variables === invoiceByPickup.get(pp.id)?.id");
    expect(impl).toContain("shouldRepriceRegistration");
    expect(impl).toContain("sync_bill_snapshot: true");
    expect(impl).toContain("pickup_point_prices");
  });
});
