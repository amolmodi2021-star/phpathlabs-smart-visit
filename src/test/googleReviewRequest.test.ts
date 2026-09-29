// @vitest-environment node
import { describe, expect, it } from "vitest";

const memory = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => memory.set(key, value),
  removeItem: (key: string) => memory.delete(key),
};

const { buildGoogleReviewMessage, isGoogleReviewEligible, labCalendarDay } = await import(
  "@/lib/googleReviewRequest"
);

const registeredAt = "2026-09-29T04:00:00.000Z"; // 09:30 IST

describe("labCalendarDay", () => {
  it("uses the India calendar day", () => {
    expect(labCalendarDay(registeredAt)).toBe("2026-09-29");
    expect(labCalendarDay("2026-09-29T20:00:00.000Z")).toBe("2026-09-30");
  });
});

describe("isGoogleReviewEligible", () => {
  const tests = [
    { testId: "cbc", status: "approved" },
    { testId: "crp", status: "dispatched" },
    { testId: "lft", status: "verified" },
  ];

  it("waits until the last pending report is dispatched", () => {
    const partial = isGoogleReviewEligible({
      visitType: "lab",
      registeredAt,
      dispatchedAt: new Date("2026-09-29T08:00:00.000Z"),
      tests,
      dispatchingTestIds: ["cbc"],
    });
    expect(partial.eligible).toBe(false);

    const done = isGoogleReviewEligible({
      visitType: "home_visit",
      registeredAt,
      dispatchedAt: new Date("2026-09-29T14:00:00.000Z"),
      tests,
      dispatchingTestIds: ["cbc", "lft"],
    });
    expect(done.eligible).toBe(true);
  });

  it("skips pickup point patients", () => {
    const result = isGoogleReviewEligible({
      visitType: "pickup_point",
      registeredAt,
      dispatchedAt: new Date("2026-09-29T08:00:00.000Z"),
      tests: [{ testId: "cbc", status: "approved" }],
      dispatchingTestIds: ["cbc"],
    });
    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/Pickup/);
  });

  it("skips when the last report is dispatched on a later day", () => {
    const result = isGoogleReviewEligible({
      visitType: "lab",
      registeredAt,
      dispatchedAt: new Date("2026-09-29T20:00:00.000Z"),
      tests: [{ testId: "cbc", status: "approved" }],
      dispatchingTestIds: ["cbc"],
    });
    expect(result.eligible).toBe(false);
  });

  it("ignores cancelled tests", () => {
    const result = isGoogleReviewEligible({
      visitType: "lab",
      registeredAt,
      dispatchedAt: new Date("2026-09-29T10:00:00.000Z"),
      tests: [
        { testId: "cbc", status: "dispatched" },
        { testId: "esr", status: "cancelled" },
      ],
      dispatchingTestIds: [],
    });
    expect(result.eligible).toBe(true);
  });
});

describe("buildGoogleReviewMessage", () => {
  it("fills title and name and drops the extra space when title is blank", () => {
    const withTitle = buildGoogleReviewMessage({
      template: "Dear {title} {patient_name} ({invoice_number})",
      title: "mrs",
      patientName: "SIMRAN DHINGRA",
      invoiceNumber: "2609230028",
    });
    expect(withTitle).toBe("Dear Mrs. SIMRAN DHINGRA (2609230028)");

    const noTitle = buildGoogleReviewMessage({
      template: "Dear {title} {patient_name}",
      title: "",
      patientName: "RAHUL",
    });
    expect(noTitle).toBe("Dear RAHUL");
  });
});