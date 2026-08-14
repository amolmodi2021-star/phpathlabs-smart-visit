// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  formatPatientAge,
  snapshotAgeAtApproval,
  resolveReportAgeText,
} from "@/lib/patientAge";

describe("formatPatientAge", () => {
  it("uses pickup free-text age and appends Years for a bare number", () => {
    expect(formatPatientAge({ ageText: "45", dob: null })).toBe("45 Years");
    expect(formatPatientAge({ ageText: "45 Years", dob: null })).toBe("45 Years");
    expect(formatPatientAge({ ageText: "8 months", dob: null })).toBe("8 months");
  });

  it("shows em dash when pickup age and DOB are both missing", () => {
    expect(formatPatientAge({ ageText: null, dob: null })).toBe("—");
  });

  it("derives lab age from DOB as of approval, not today", () => {
    expect(
      formatPatientAge({ dob: "1990-06-15", asOf: "2026-08-14T00:00:00.000Z" }),
    ).toBe("36 Years");
  });
});

describe("snapshotAgeAtApproval", () => {
  it("freezes pickup free-text age onto the approval snapshot", () => {
    expect(
      snapshotAgeAtApproval(
        { visit_type: "pickup_point", dob: null, age_text: "45 Years" },
        "2026-08-14T10:00:00.000Z",
      ),
    ).toBe("45 Years");
  });

  it("returns null for pickup when age_text was not loaded", () => {
    expect(
      snapshotAgeAtApproval(
        { visit_type: "pickup_point", dob: null },
        "2026-08-14T10:00:00.000Z",
      ),
    ).toBeNull();
  });

  it("freezes lab age from DOB at approval time", () => {
    expect(
      snapshotAgeAtApproval(
        { visit_type: "lab_visit", dob: "1990-06-15", age_text: null },
        "2026-08-14T10:00:00.000Z",
      ),
    ).toBe("36 Years");
  });
});

describe("resolveReportAgeText", () => {
  it("prefers the frozen snapshot over a later live edit", () => {
    expect(resolveReportAgeText("40 Years", "45 Years")).toBe("40 Years");
  });

  it("falls back to live registration age when the snapshot is missing", () => {
    expect(resolveReportAgeText(null, "45 Years")).toBe("45 Years");
    expect(resolveReportAgeText("", "45")).toBe("45");
  });

  it("returns null when neither snapshot nor live age exists", () => {
    expect(resolveReportAgeText(null, null)).toBeNull();
  });
});
