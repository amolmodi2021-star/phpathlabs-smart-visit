import { describe, expect, it } from "vitest";
import {
  nextInvoiceQueueToken,
  pickOutboxJobsSerializingPhone,
  shouldFireBoundInvoiceQueue,
} from "@/lib/whatsappOutboxQueue";

describe("shouldFireBoundInvoiceQueue", () => {
  it("fires only when token matches the ready invoice and nonce is new", () => {
    expect(
      shouldFireBoundInvoiceQueue({
        token: { invoiceNumber: "2608210002", nonce: 2 },
        lastNonce: 1,
        currentInvoiceNumber: "2608210002",
        ready: true,
      }),
    ).toBe(true);
  });

  it("ignores leftover tokens from a previous patient after the preview switches", () => {
    expect(
      shouldFireBoundInvoiceQueue({
        token: { invoiceNumber: "2608210001", nonce: 1 },
        lastNonce: 0,
        currentInvoiceNumber: "2608210002",
        ready: true,
      }),
    ).toBe(false);
  });

  it("does not fire until fonts/layout are ready", () => {
    expect(
      shouldFireBoundInvoiceQueue({
        token: { invoiceNumber: "2608210001", nonce: 1 },
        lastNonce: 0,
        currentInvoiceNumber: "2608210001",
        ready: false,
      }),
    ).toBe(false);
  });

  it("does not re-fire the same nonce", () => {
    expect(
      shouldFireBoundInvoiceQueue({
        token: { invoiceNumber: "2608210001", nonce: 3 },
        lastNonce: 3,
        currentInvoiceNumber: "2608210001",
        ready: true,
      }),
    ).toBe(false);
  });
});

describe("nextInvoiceQueueToken", () => {
  it("increments nonce from idle (0) to 1", () => {
    expect(nextInvoiceQueueToken("2608210001", 0)).toEqual({
      invoiceNumber: "2608210001",
      nonce: 1,
    });
  });
});

describe("pickOutboxJobsSerializingPhone", () => {
  it("keeps FIFO order and only one job per phone per claim batch", () => {
    const pending = [
      { id: "a1", phone: "9876543210" },
      { id: "a2", phone: "9876543210" },
      { id: "b1", phone: "9123456780" },
      { id: "a3", phone: "+91 98765 43210" },
    ];
    const picked = pickOutboxJobsSerializingPhone(pending, [], 5);
    expect(picked.map((j) => j.id)).toEqual(["a1", "b1"]);
  });

  it("skips a phone that already has an in-flight claimed job", () => {
    const pending = [
      { id: "a2", phone: "9876543210" },
      { id: "b1", phone: "9123456780" },
    ];
    const picked = pickOutboxJobsSerializingPhone(pending, ["9876543210"], 5);
    expect(picked.map((j) => j.id)).toEqual(["b1"]);
  });

  it("respects claim limit after unique-phone filtering", () => {
    const pending = [
      { id: "a", phone: "1111111111" },
      { id: "b", phone: "2222222222" },
      { id: "c", phone: "3333333333" },
    ];
    expect(pickOutboxJobsSerializingPhone(pending, [], 2).map((j) => j.id)).toEqual(["a", "b"]);
  });
});
