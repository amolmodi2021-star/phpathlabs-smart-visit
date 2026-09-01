import { describe, expect, it } from "vitest";
import { buildCollectionReceiptLines } from "@/lib/tallyIntegration";

describe("buildCollectionReceiptLines", () => {
  it("debits Cash and credits Cash Sales for cash", () => {
    const lines = buildCollectionReceiptLines({
      mode: "cash",
      modeLedger: "Cash Sales",
      bankLedger: "Axis Bank Ltd.",
      amount: 1000,
    });
    expect(lines).toEqual([
      { ledger: "Cash", is_debit: true, amount: 1000 },
      { ledger: "Cash Sales", is_debit: false, amount: 1000 },
    ]);
  });

  it("debits Axis bank and credits mapped ledger for non-cash", () => {
    const lines = buildCollectionReceiptLines({
      mode: "gpay",
      modeLedger: "Online Payment (Google Pay)",
      bankLedger: "Axis Bank Ltd.",
      amount: 2500.5,
    });
    expect(lines).toEqual([
      { ledger: "Axis Bank Ltd.", is_debit: true, amount: 2500.5 },
      { ledger: "Online Payment (Google Pay)", is_debit: false, amount: 2500.5 },
    ]);
  });

  it("rejects flipped non-cash mapping where mode would be debited", () => {
    expect(() =>
      buildCollectionReceiptLines({
        mode: "gpay",
        modeLedger: "Axis Bank Ltd.",
        bankLedger: "Axis Bank Ltd.",
        amount: 100,
      }),
    ).toThrow(/same ledger/i);
  });
});