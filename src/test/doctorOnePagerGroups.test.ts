// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  buildDoctorOnePagerInput,
  clinicalGroupsFor,
  normalizeDoctorOnePagerSummary,
  scrubClinicalText,
} from "@/lib/doctorOnePagerGroups";

describe("clinicalGroupsFor", () => {
  it("keeps FBS, PPBS and HbA1c in one glucose group", () => {
    const fbs = clinicalGroupsFor({ parameter_name: "FBS", test_name: "Fasting Blood Sugar" });
    const ppbs = clinicalGroupsFor({ parameter_name: "PPBS", test_name: "Post Prandial Blood Sugar" });
    const a1c = clinicalGroupsFor({ parameter_name: "HbA1c", param_code: "HBA1C" });
    expect(fbs).toContain("glucose");
    expect(ppbs).toContain("glucose");
    expect(a1c).toContain("glucose");
    expect(a1c).not.toContain("haematology");
  });

  it("groups red-cell indices together and does not call haemoglobin glucose", () => {
    const hb = clinicalGroupsFor({ parameter_name: "Haemoglobin", param_code: "HB" });
    const mcv = clinicalGroupsFor({ parameter_name: "MCV" });
    const rdw = clinicalGroupsFor({ parameter_name: "RDW-CV" });
    expect(hb).toContain("haematology");
    expect(hb).not.toContain("glucose");
    expect(mcv).toContain("haematology");
    expect(rdw).toContain("haematology");
  });

  it("groups TSH with free T4", () => {
    expect(clinicalGroupsFor({ parameter_name: "TSH" })).toContain("thyroid");
    expect(clinicalGroupsFor({ parameter_name: "Free T4", param_code: "FT4" })).toContain("thyroid");
  });
});

describe("buildDoctorOnePagerInput", () => {
  it("keeps a normal HbA1c beside an abnormal FBS and attaches history", () => {
    const input = buildDoctorOnePagerInput({
      current: [
        { parameter_name: "FBS", param_code: "FBS", result_value: "132", unit: "mg/dL", reference_range: "70-100", flag: "H", test_name: "FBS" },
        { parameter_name: "PPBS", param_code: "PPBS", result_value: "110", unit: "mg/dL", reference_range: "70-140", flag: "N", test_name: "PPBS" },
        { parameter_name: "HbA1c", param_code: "HBA1C", result_value: "5.4", unit: "%", reference_range: "<5.7", flag: "N", test_name: "HbA1c" },
      ],
      priorVisits: [
        {
          date: "2026-06-01",
          results: [{ parameter_name: "FBS", param_code: "FBS", result_value: "128", flag: "H" }],
        },
      ],
    });
    const glucose = input.groups.find((g) => g.id === "glucose");
    expect(glucose?.parameters.map((p) => p.parameter_name)).toEqual(["FBS", "PPBS", "HbA1c"]);
    expect(glucose?.parameters[0].history[0].value).toBe("128");
    expect(glucose?.parameters[1].abnormal).toBe(false);
  });
});

describe("scrubClinicalText", () => {
  it("removes treatment language", () => {
    expect(scrubClinicalText("Patient has diabetes. Start medication 500 mg/day.")).toMatch(/does not diagnose/);
    expect(scrubClinicalText("Correlate clinically.")).toBe("Correlate clinically.");
  });

  it("rewrites missing history and lab-blame wording", () => {
    expect(scrubClinicalText("No prior lipid results provided.")).toBe("Prior history for lipid not available.");
    expect(scrubClinicalText("Vitamin D is low by lab.")).toBe("Vitamin D result is low.");
    expect(scrubClinicalText("Result may reflect sample contamination.")).toBe("");
  });
});

describe("normalizeDoctorOnePagerSummary", () => {
  it("caps patterns and scrubs points", () => {
    const summary = normalizeDoctorOnePagerSummary({
      overall_clinical_snapshot: "Glycaemic pattern only.",
      clinical_patterns: Array.from({ length: 6 }, (_, i) => ({ pattern_name: `P${i}`, current_findings: ["FBS 132 H"] })),
      points_for_clinical_review: ["Prescribe tablet."],
    });
    expect(summary.clinical_patterns).toHaveLength(4);
    expect(summary.points_for_clinical_review[0]).toMatch(/does not diagnose/);
    expect(summary.suggested_follow_up).toEqual([]);
  });

  it("keeps a follow-up test and interval", () => {
    const summary = normalizeDoctorOnePagerSummary({
      overall_clinical_snapshot: "Lipid pattern.",
      suggested_follow_up: [
        { test: "Lipid profile", when: "after 3 months", note: "Recheck the lipid pattern." },
        { test: "Repeat the sample because of contamination", when: "tomorrow", note: "" },
      ],
    });
    expect(summary.suggested_follow_up[0]).toEqual({
      test: "Lipid profile",
      when: "after 3 months",
      note: "Recheck the lipid pattern.",
    });
    expect(summary.suggested_follow_up[1]?.test || "").toBe("");
  });
});