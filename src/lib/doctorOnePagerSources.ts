import type { DoctorOnePagerSummary } from "@/lib/doctorOnePagerGroups";

export type ClinicalReference = {
  id: string;
  title: string;
  url: string;
  pattern: RegExp;
};

/** Published pages the summary is allowed to cite. URLs are fixed here so the page never shows a made-up link. */
export const CLINICAL_REFERENCES: ClinicalReference[] = [
  {
    id: "ada",
    title: "American Diabetes Association — Standards of Care in Diabetes",
    url: "https://professional.diabetes.org/standards-of-care",
    pattern: /\b(glucose|fbs|ppbs|hba1c|glycaem|glycem|diabetes|fasting sugar|post[- ]?prandial)\b/i,
  },
  {
    id: "nhlbi-lipid",
    title: "National Heart, Lung, and Blood Institute — Blood Cholesterol",
    url: "https://www.nhlbi.nih.gov/health/blood-cholesterol",
    pattern: /\b(cholesterol|hdl|ldl|triglyceride|lipid)\b/i,
  },
  {
    id: "kdigo",
    title: "KDIGO — CKD Evaluation and Management",
    url: "https://kdigo.org/guidelines/ckd-evaluation-and-management/",
    pattern: /\b(creatinine|egfr|gfr|urea|bun|kidney|renal)\b/i,
  },
  {
    id: "niddk-thyroid",
    title: "National Institute of Diabetes and Digestive and Kidney Diseases — Thyroid",
    url: "https://www.niddk.nih.gov/health-information/endocrine-diseases/hypothyroidism",
    pattern: /\b(tsh|thyroid|ft3|ft4|free t3|free t4)\b/i,
  },
  {
    id: "aasld",
    title: "American Association for the Study of Liver Diseases — Practice Guidelines",
    url: "https://www.aasld.org/practice-guidelines",
    pattern: /\b(bilirubin|sgot|sgpt|ast|alt|ggt|alp|alkaline phosphatase|albumin|liver)\b/i,
  },
  {
    id: "who-anaemia",
    title: "World Health Organization — Anaemia",
    url: "https://www.who.int/news-room/fact-sheets/detail/anaemia",
    pattern: /\b(haemoglobin|hemoglobin|anaemia|anemia|hb|mcv|mch|pcv|hct|rdw|haematocrit|hematocrit|ferritin)\b/i,
  },
  {
    id: "endocrine",
    title: "Endocrine Society — Clinical Practice Guidelines",
    url: "https://www.endocrine.org/clinical-practice-guidelines",
    pattern: /\b(vitamin d|25[- ]?oh|cholecalciferol)\b/i,
  },
  {
    id: "nih-b12",
    title: "NIH Office of Dietary Supplements — Vitamin B12",
    url: "https://ods.od.nih.gov/factsheets/VitaminB12-HealthProfessional/",
    pattern: /\b(vitamin b12|b12|cobalamin)\b/i,
  },
];

function summaryText(summary: DoctorOnePagerSummary): string {
  const parts = [
    summary.overall_clinical_snapshot,
    summary.overall_comment,
    ...summary.important_isolated_findings,
    ...summary.points_for_clinical_review,
    ...summary.suggested_follow_up.flatMap((item) => [item.test, item.note]),
  ];
  for (const pattern of summary.clinical_patterns) {
    parts.push(
      pattern.category,
      pattern.pattern_name,
      pattern.historical_context,
      pattern.integrated_interpretation,
      ...pattern.current_findings,
      ...pattern.related_parameters_considered,
      ...pattern.clinical_correlation,
    );
  }
  return parts.filter(Boolean).join("\n");
}

export function referencesForSummary(summary: DoctorOnePagerSummary): Array<{ id: string; title: string; url: string }> {
  const text = summaryText(summary);
  return CLINICAL_REFERENCES.filter((ref) => ref.pattern.test(text)).map(({ id, title, url }) => ({ id, title, url }));
}
