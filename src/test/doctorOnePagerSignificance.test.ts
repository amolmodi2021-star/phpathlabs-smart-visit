// @vitest-environment node
import { describe, expect, it } from "vitest";
import { buildDoctorOnePagerInput, type OnePagerResult, type PriorVisit } from "@/lib/doctorOnePagerGroups";
import { applyClinicalPriority, reviewDoctorOnePagerInput } from "@/lib/doctorOnePagerSignificance";

function row(name: string, value: string, flag: string): OnePagerResult {
  return { parameter_name: name, result_value: value, flag, unit: "mg/dL", reference_range: "range" };
}

function reviewOf(rows: OnePagerResult[], id: string, priors: PriorVisit[] = []) {
  const input = reviewDoctorOnePagerInput(buildDoctorOnePagerInput({ current: rows, priorVisits: priors }));
  return input.groups.find((group) => group.id === id)?.clinical_review;
}

describe("clinical significance", () => {
  it("treats isolated low HDL as minor and ignores a favorably low ratio", () => {
    const lipid = reviewOf([
      row("HDL Cholesterol", "52.12", "L"),
      row("Total Cholesterol", "180", "N"),
      row("Triglycerides", "110", "N"),
      row("LDL Cholesterol", "100", "N"),
      row("LDL/HDL Ratio", "1.9", "L"),
    ], "lipid");
    expect(lipid?.significance).toBe("MINOR_ISOLATED_DEVIATION");
    expect(lipid?.include_in_key_patterns).toBe(true);
    expect(lipid?.omit_from_adverse_findings).toContain("LDL/HDL Ratio");
    expect(lipid?.instruction).toMatch(/isolated/i);
    expect(lipid?.instruction).toMatch(/not an unfavorable|not clinically unfavorable/i);
  });

  it("does not highlight a low LDL/HDL ratio when the lipid profile is otherwise acceptable", () => {
    const lipid = reviewOf([
      row("HDL Cholesterol", "62", "N"),
      row("LDL Cholesterol", "90", "N"),
      row("LDL/HDL Ratio", "1.9", "L"),
    ], "lipid");
    expect(lipid?.significance).toBe("NORMAL_OR_ACCEPTABLE");
    expect(lipid?.include_in_key_patterns).toBe(false);
    expect(lipid?.omit_from_adverse_findings).toContain("LDL/HDL Ratio");
  });

  it("calls high FBS with normal PPBS and HbA1c an isolated elevation", () => {
    const glucose = reviewOf([
      row("FBS", "132", "H"),
      row("PPBS", "120", "N"),
      row("HbA1c", "5.4", "N"),
    ], "glucose");
    expect(glucose?.significance).toBe("POTENTIALLY_SIGNIFICANT");
    expect(glucose?.instruction).toMatch(/isolated fasting/i);
  });

  it("treats high FBS, PPBS and HbA1c as one significant pattern", () => {
    const glucose = reviewOf([
      row("FBS", "140", "H"),
      row("PPBS", "210", "H"),
      row("HbA1c", "6.8", "H"),
    ], "glucose");
    expect(glucose?.significance).toBe("CLINICALLY_SIGNIFICANT");
  });

  it("combines low Hb with low MCV, low MCH and high RDW", () => {
    const blood = reviewOf([
      row("Haemoglobin", "9.5", "L"),
      row("MCV", "72", "L"),
      row("MCH", "24", "L"),
      row("RDW", "16", "H"),
    ], "haematology");
    expect(blood?.significance).toBe("CLINICALLY_SIGNIFICANT");
    expect(blood?.instruction).toMatch(/one red-cell pattern/i);
  });

  it("does not call low Hb with normal indices microcytic", () => {
    const blood = reviewOf([
      row("Haemoglobin", "10.5", "L"),
      row("MCV", "88", "N"),
      row("MCH", "30", "N"),
    ], "haematology");
    expect(blood?.significance).toBe("POTENTIALLY_SIGNIFICANT");
    expect(blood?.instruction).toMatch(/not describe a microcytic/i);
  });

  it("does not call high creatinine with a normal eGFR reduced renal function", () => {
    const renal = reviewOf([
      row("Creatinine", "1.3", "H"),
      row("eGFR", "95", "N"),
    ], "renal");
    expect(renal?.significance).toBe("MINOR_ISOLATED_DEVIATION");
    expect(renal?.instruction).toMatch(/do not describe reduced renal function/i);
  });

  it("treats high creatinine with low eGFR as one significant pattern", () => {
    const renal = reviewOf([
      row("Creatinine", "2.1", "H"),
      row("eGFR", "42", "L"),
    ], "renal");
    expect(renal?.significance).toBe("CLINICALLY_SIGNIFICANT");
  });

  it("treats high TSH with low free T4 as one pattern and high TSH with normal free T4 as potential", () => {
    const low = reviewOf([row("TSH", "12", "H"), row("Free T4", "0.6", "L")], "thyroid");
    const normal = reviewOf([row("TSH", "6.5", "H"), row("Free T4", "1.2", "N")], "thyroid");
    expect(low?.significance).toBe("CLINICALLY_SIGNIFICANT");
    expect(normal?.significance).toBe("POTENTIALLY_SIGNIFICANT");
    expect(normal?.instruction).toMatch(/do not label a thyroid disorder/i);
  });

  it("keeps a mild isolated ALT elevation minor", () => {
    const liver = reviewOf([
      row("ALT", "48", "H"),
      row("AST", "28", "N"),
      row("ALP", "80", "N"),
      row("GGT", "30", "N"),
      row("Total Bilirubin", "0.8", "N"),
    ], "liver");
    expect(liver?.significance).toBe("MINOR_ISOLATED_DEVIATION");
    expect(liver?.instruction).toMatch(/isolated/i);
  });

  it("upgrades a worsening glycaemic marker that stays high across reports", () => {
    const glucose = reviewOf(
      [row("FBS", "150", "H"), row("PPBS", "118", "N"), row("HbA1c", "6.8", "H")],
      "glucose",
      [
        { date: "2026-06-01", results: [row("HbA1c", "6.4", "H"), row("FBS", "128", "H")] },
        { date: "2026-01-01", results: [row("HbA1c", "6.1", "H"), row("FBS", "118", "H")] },
      ],
    );
    expect(glucose?.significance).toBe("CLINICALLY_SIGNIFICANT");
  });

  it("drops a favorably low ratio from the summary and does not add follow-up for a minor HDL finding", () => {
    const input = reviewDoctorOnePagerInput(buildDoctorOnePagerInput({
      current: [
        row("HDL Cholesterol", "52.12", "L"),
        row("Total Cholesterol", "180", "N"),
        row("LDL/HDL Ratio", "1.9", "L"),
      ],
      priorVisits: [],
    }));
    const summary = applyClinicalPriority({
      clinical_patterns: [
        {
          pattern_name: "Low LDL/HDL ratio",
          current_findings: ["LDL/HDL Ratio"],
          integrated_interpretation: "LDL/HDL Ratio is low.",
        },
        {
          pattern_name: "HDL below laboratory desirable level",
          current_findings: ["HDL Cholesterol", "LDL/HDL Ratio"],
          integrated_interpretation: "HDL is below the desirable level and the other lipids are within limits.",
        },
      ],
      points_for_clinical_review: [],
      suggested_follow_up: [{ test: "Lipid profile", when: "after 3 months", note: "Repeat." }],
    }, input);
    expect(summary.clinical_patterns.map((p: { pattern_name: string }) => p.pattern_name)).toEqual([
      "HDL below laboratory desirable level",
    ]);
    expect(summary.clinical_patterns[0].current_findings).toEqual(["HDL Cholesterol"]);
    expect(summary.suggested_follow_up).toEqual([]);
    expect(summary.points_for_clinical_review).toEqual([
      "No additional laboratory-specific points for review identified.",
    ]);
  });
});