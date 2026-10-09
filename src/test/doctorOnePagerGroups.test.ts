// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  buildDoctorOnePagerInput,
  clinicalGroupsFor,
  leftoverAbnormalBoxes,
  matchPatternResultRows,
  normalizeDoctorOnePagerSummary,
  snapshotBullets,
  rowsForPatternBox,
  scrubClinicalText,
} from "@/lib/doctorOnePagerGroups";
import { referencesForSummary } from "@/lib/doctorOnePagerSources";

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

  it("keeps urine red cells out of the CBC group", () => {
    const urineRbc = clinicalGroupsFor({
      parameter_name: "Red Blood Cells (Urine)",
      param_code: "RBC",
      test_name: "Urine Routine Examination",
    });
    expect(urineRbc).toContain("urinalysis");
    expect(urineRbc).not.toContain("haematology");
    expect(clinicalGroupsFor({ parameter_name: "R.B.C. Count", test_name: "CBC" })).toContain("haematology");
    expect(clinicalGroupsFor({ parameter_name: "R.B.C. Count", test_name: "CBC" })).not.toContain("urinalysis");
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

describe("matchPatternResultRows", () => {
  it("uses the verified row instead of the prose finding", () => {
    const rows = matchPatternResultRows(
      [
        "Total Cholesterol 246.69 mg/dL (Ref < 200 mg/dL) H",
        "HDL Cholesterol 59.26 mg/dL (Ref 40 mg/dL) L",
      ],
      [],
      [
        { parameter_name: "Total Cholesterol", result_value: "246.69", unit: "mg/dL", reference_range: "< 200 mg/dL", flag: "H" },
        { parameter_name: "HDL Cholesterol", result_value: "59.26", unit: "mg/dL", reference_range: "No Risk: > 60 mg/dL", flag: "L" },
        { parameter_name: "Cholesterol", result_value: "1", unit: "mg/dL", reference_range: "x", flag: "N" },
      ],
    );
    expect(rows.map((row) => row.parameter_name)).toEqual(["Total Cholesterol", "HDL Cholesterol"]);
    expect(rows[0].result_value).toBe("246.69");
    expect(rows[1].reference_range).toBe("No Risk: > 60 mg/dL");
  });

  it("adds every abnormal parameter from the same test into the pattern box", () => {
    const rows = rowsForPatternBox(
      {
        category: "lipid",
        pattern_name: "Isolated low HDL",
        current_findings: ["HDL Cholesterol"],
        related_parameters_considered: ["Total Cholesterol"],
      },
      [
        { parameter_name: "Total Cholesterol", result_value: "180", unit: "mg/dL", reference_range: "< 200", flag: "N" },
        { parameter_name: "HDL Cholesterol", result_value: "52.12", unit: "mg/dL", reference_range: "> 60", flag: "L" },
        { parameter_name: "LDLC/HDLC Ratio", result_value: "3.4", unit: "", reference_range: "< 3.0", flag: "H" },
        { parameter_name: "Haemoglobin", result_value: "10.2", unit: "g/dL", reference_range: "13-17", flag: "L" },
      ],
    );
    expect(rows.map((row) => row.parameter_name)).toEqual(["HDL Cholesterol", "LDLC/HDLC Ratio"]);
    const rest = leftoverAbnormalBoxes(
      [
        { parameter_name: "HDL Cholesterol", result_value: "52.12", flag: "L" },
        { parameter_name: "Haemoglobin", result_value: "10.2", unit: "g/dL", reference_range: "13-17", flag: "L" },
      ],
      new Set(["hdl cholesterol"]),
    );
    expect(rest.map((box) => box.label)).toEqual(["CBC / Haematology"]);
    expect(rest[0].rows[0].parameter_name).toBe("Haemoglobin");
  });

  it("does not place urine red cells in the anaemia box", () => {
    const results = [
      { parameter_name: "Red Blood Cells (Urine)", test_name: "Urine Routine Examination", result_value: "1-2/hpf", reference_range: "Nil", flag: "X" },
      { parameter_name: "Haemoglobin", test_name: "CBC", result_value: "9.0", unit: "g/dL", reference_range: "12 - 15 g/dL", flag: "L" },
      { parameter_name: "R.B.C. Count", test_name: "CBC", result_value: "3.31", unit: "million/cumm", reference_range: "3.8 - 4.8", flag: "L" },
      { parameter_name: "Pus cells (Urine)", test_name: "Urine Routine Examination", result_value: "30-35/hpf", reference_range: "Nil", flag: "X" },
    ];
    const cbc = rowsForPatternBox(
      {
        category: "haematology",
        pattern_name: "Normocytic normochromic anaemia pattern",
        current_findings: ["Haemoglobin", "R.B.C. Count", "Red Blood Cells (Urine)"],
      },
      results,
    );
    expect(cbc.map((row) => row.parameter_name)).toEqual(["Haemoglobin", "R.B.C. Count"]);
    const urine = rowsForPatternBox(
      {
        category: "urinalysis",
        pattern_name: "Pyuria with blood-positive urine findings",
        current_findings: ["Pus cells (Urine)"],
      },
      results,
    );
    expect(urine.map((row) => row.parameter_name)).toEqual(["Red Blood Cells (Urine)", "Pus cells (Urine)"]);
  });

  it("puts each abnormal parameter only in the box for its own test", () => {
    const results = [
      { parameter_name: "Haemoglobin", test_name: "CBC", result_value: "9.0", flag: "L" },
      { parameter_name: "Abs Monocytes", test_name: "CBC", result_value: "153", flag: "L" },
      { parameter_name: "Ferritin", test_name: "Iron Studies", result_value: "8", flag: "L" },
      { parameter_name: "Blood Glucose Fasting", test_name: "FBS", result_value: "106", flag: "H" },
      { parameter_name: "Urine Glucose", test_name: "Urine Routine Examination", result_value: "Present", flag: "X" },
      { parameter_name: "Red Blood Cells (Urine)", test_name: "Urine Routine Examination", result_value: "1-2/hpf", flag: "X" },
      { parameter_name: "Creatinine", test_name: "Renal Function", result_value: "1.8", flag: "H" },
    ];
    expect(rowsForPatternBox({ pattern_name: "Normocytic normochromic anaemia pattern", current_findings: ["Haemoglobin"] }, results).map((row) => row.parameter_name)).toEqual(["Haemoglobin", "Abs Monocytes"]);
    expect(rowsForPatternBox({ pattern_name: "Low ferritin", category: "iron", current_findings: ["Ferritin"] }, results).map((row) => row.parameter_name)).toEqual(["Ferritin"]);
    expect(rowsForPatternBox({ pattern_name: "Isolated fasting glucose elevation", current_findings: ["Blood Glucose Fasting"] }, results).map((row) => row.parameter_name)).toEqual(["Blood Glucose Fasting"]);
    expect(rowsForPatternBox({ pattern_name: "Pyuria with blood-positive urine findings", current_findings: ["Red Blood Cells (Urine)"] }, results).map((row) => row.parameter_name)).toEqual(["Urine Glucose", "Red Blood Cells (Urine)"]);
    expect(rowsForPatternBox({ pattern_name: "Raised creatinine", category: "renal", current_findings: ["Creatinine"] }, results).map((row) => row.parameter_name)).toEqual(["Creatinine"]);
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
    expect(scrubClinicalText("HbA1c result is high, particularly alongside the CBC findings.")).toBe("HbA1c result is high, particularly alongside the haemoglobin findings.");
  });

  it("does not comment on the reported morphology", () => {
    const text = scrubClinicalText(
      "Low MCV and MCH suggest an anaemia pattern, while the reported RBC morphology is normocytic normochromic and WBC counts are within range.",
    );
    expect(text).toBe("Low MCV and MCH suggest an anaemia pattern and WBC counts are within range.");
    expect(text).not.toMatch(/morpholog|normocytic|microcytic|hypochromic/i);
  });
});

describe("snapshotBullets", () => {
  it("separates a blood-count sentence from a urine sentence", () => {
    expect(snapshotBullets(
      "Haematology shows a low haemoglobin pattern with low PCV. Urinalysis shows marked urine glucose.",
    )).toEqual([
      "Haematology shows a low haemoglobin pattern with low PCV.",
      "Urinalysis shows marked urine glucose.",
    ]);
  });

  it("splits two profiles joined in one sentence", () => {
    expect(snapshotBullets(
      "Haematology shows low haemoglobin, while urinalysis shows urine glucose.",
    )).toEqual([
      "Haematology shows low haemoglobin.",
      "Urinalysis shows urine glucose.",
    ]);
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

describe("referencesForSummary", () => {
  it("cites only the published page that matches the comments", () => {
    const glucose = referencesForSummary(normalizeDoctorOnePagerSummary({
      overall_clinical_snapshot: "Isolated fasting glucose elevation.",
      clinical_patterns: [{ pattern_name: "Fasting glucose", category: "glucose", current_findings: ["FBS"] }],
    }));
    expect(glucose.map((ref) => ref.id)).toEqual(["ada"]);
    expect(glucose[0].url).toBe("https://professional.diabetes.org/standards-of-care");

    const lipid = referencesForSummary(normalizeDoctorOnePagerSummary({
      overall_clinical_snapshot: "Lipid pattern.",
      clinical_patterns: [{ pattern_name: "Cholesterol", current_findings: ["HDL", "LDL"] }],
    }));
    expect(lipid.map((ref) => ref.id)).toEqual(["nhlbi-lipid"]);
  });

  it("does not add a reference when the comments do not match a published page", () => {
    const none = referencesForSummary(normalizeDoctorOnePagerSummary({
      overall_clinical_snapshot: "No dominant pattern.",
    }));
    expect(none).toEqual([]);
  });
});