// @vitest-environment node
import { describe, expect, it } from "vitest";
import { summarizeCombo99, type Combo99BillRow } from "@/lib/dashboardCombo99";

let seq = 0;
function row(partial: Partial<Combo99BillRow> & Pick<Combo99BillRow, "billAmount" | "bookedOn">): Combo99BillRow {
  seq += 1;
  return {
    registrationId: partial.registrationId || `r${seq}`,
    invoiceNumber: partial.invoiceNumber || String(seq),
    patientName: partial.patientName || "Patient",
    title: partial.title ?? null,
    umrNumber: partial.umrNumber ?? `U${seq}`,
    createdAt: partial.createdAt || partial.bookedOn + "T08:00:00+05:30",
    bookedOn: partial.bookedOn,
    comboQty: partial.comboQty ?? 1,
    otherTestCount: partial.otherTestCount ?? 0,
    billAmount: partial.billAmount,
    lifetimeBill: partial.lifetimeBill ?? partial.billAmount,
    lifetimeVisits: partial.lifetimeVisits ?? 1,
  };
}

describe("summarizeCombo99", () => {
  it("adds the full test bill of every patient who booked COMBO99", () => {
    const summary = summarizeCombo99([
      row({ bookedOn: "2026-11-23", billAmount: 99 }),
      row({ bookedOn: "2026-11-23", billAmount: 99 }),
      row({ bookedOn: "2026-11-23", billAmount: 99 }),
      row({ bookedOn: "2026-11-23", billAmount: 399, otherTestCount: 2 }),
      row({ bookedOn: "2026-11-24", billAmount: 499, otherTestCount: 1 }),
    ]);
    expect(summary.comboQty).toBe(5);
    expect(summary.patients).toBe(5);
    expect(summary.visits).toBe(5);
    expect(summary.returnVisits).toBe(0);
    expect(summary.withOtherTests).toBe(2);
    expect(summary.billAmount).toBe(99 + 99 + 99 + 399 + 499);
    expect(summary.lifetimeBill).toBe(99 + 99 + 99 + 399 + 499);
    expect(summary.dates).toEqual([
      { bookedOn: "2026-11-23", comboQty: 4, visits: 4, patients: 4, returnVisits: 0, billAmount: 99 + 99 + 99 + 399, withOtherTests: 1 },
      { bookedOn: "2026-11-24", comboQty: 1, visits: 1, patients: 1, returnVisits: 0, billAmount: 499, withOtherTests: 1 },
    ]);
  });

  it("counts two COMBO99 lines on one bill once for the patient and once for the bill", () => {
    const summary = summarizeCombo99([
      row({ bookedOn: "2026-11-23", billAmount: 198, comboQty: 2, otherTestCount: 0 }),
    ]);
    expect(summary.comboQty).toBe(2);
    expect(summary.patients).toBe(1);
    expect(summary.billAmount).toBe(198);
    expect(summary.lifetimeBill).toBe(198);
    expect(summary.withOtherTests).toBe(0);
  });

  it("counts a later visit of the same UMR once in lifetime value", () => {
    const summary = summarizeCombo99([
      row({
        umrNumber: "UMR1",
        bookedOn: "2026-11-01",
        billAmount: 99,
        comboQty: 1,
        lifetimeBill: 399,
        lifetimeVisits: 2,
      }),
      row({
        umrNumber: "umr1",
        bookedOn: "2026-11-20",
        billAmount: 300,
        comboQty: 0,
        otherTestCount: 1,
        lifetimeBill: 399,
        lifetimeVisits: 2,
      }),
    ]);
    expect(summary.patients).toBe(1);
    expect(summary.visits).toBe(2);
    expect(summary.returnVisits).toBe(1);
    expect(summary.comboQty).toBe(1);
    expect(summary.billAmount).toBe(399);
    expect(summary.lifetimeBill).toBe(399);
    expect(summary.dates.map((d) => d.returnVisits)).toEqual([0, 1]);
  });
});
