/** Clinical groups for the doctor one-pager. Matching is by parameter code, name, and test name. */

export type OnePagerResult = {
  test_id?: string | null;
  test_name?: string | null;
  parameter_id?: string | null;
  parameter_name?: string | null;
  param_code?: string | null;
  result_value?: string | null;
  unit?: string | null;
  reference_range?: string | null;
  flag?: string | null;
};

export type PriorVisit = {
  date: string;
  invoice?: string | null;
  results: OnePagerResult[];
};

export const CLINICAL_GROUP_LABELS: Record<string, string> = {
  haematology: "CBC / Haematology",
  glucose: "Glucose / Diabetes",
  renal: "Renal function",
  liver: "Liver function",
  lipid: "Lipid profile",
  thyroid: "Thyroid",
  iron: "Iron / anaemia-related",
  vitamins: "Vitamins / nutritional",
  urinalysis: "Urinalysis",
  inflammatory: "Inflammatory / infection-related",
};

const GLUCOSE = /hba1c|hb\s*a1c|glycated|glycosylated|\bfbs\b|fasting (blood )?sugar|ppbs|post[ -]?prandial|random blood sugar|\brbs\b|\beag\b|average blood glucose|homa|\binsulin\b|urine glucose|\bglucose\b/;
const HAEM = /haemoglobin|hemoglobin|(^|[^a-z])hb([^a-z]|$)|r\.?b\.?c|red blood|\bpcv\b|hematocrit|haematocrit|\bhct\b|\bmcv\b|\bmchc\b|\bmch\b|\brdw\b|\bwbc\b|\btlc\b|leucocyte|leukocyte|neutrophil|lymphocyte|monocyte|eosinophil|basophil|platelet|\bplt\b|\bmpv\b|\bpdw\b|p-?lcr|absolute neutrophil|absolute lymph/;
const RENAL = /creatinine|\begfr\b|\bgfr\b|\burea\b|\bbun\b|uric acid|sodium|\bna\b|potassium|\bk\+?\b|chloride|phosphorus|phosphate|urine protein|urine albumin|microalbumin|\bacr\b/;
const LIVER = /bilirubin|\bsgot\b|\bsgpt\b|\bast\b|\balt\b|\balp\b|\bggt\b|total protein|\balbumin\b|globulin|a\/g|ag ratio/;
const LIPID = /cholesterol|\bldl\b|\bhdl\b|triglyceride|\bvldl\b|non-hdl/;
const THYROID = /\btsh\b|free t3|free t4|\bft3\b|\bft4\b|\bt3\b|\bt4\b|anti-?tpo|thyroglobulin|thyroid antibody/;
const IRON = /serum iron|\biron\b|ferritin|\btibc\b|\buibc\b|transferrin|saturation/;
const VITAMIN = /vitamin\s*b12|b12|cobalamin|folate|folic|vitamin\s*d|\bvit\s*d\b|\bpth\b|parathyroid/;
const URINE = /urinalysis|urine |ketone|nitrite|leucocyte esterase|leukocyte esterase|specific gravity|\bcasts?\b|\bcrystals?\b/;
const INFLAM = /\bcrp\b|c-reactive|\besr\b|procalcitonin/;

export function resultBlob(row: OnePagerResult): string {
  return [row.param_code, row.parameter_name, row.test_name]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .replace(/\./g, "");
}

/** Groups a parameter belongs to. Related normals stay in the same group as abnormals. */
export function clinicalGroupsFor(row: OnePagerResult): string[] {
  const b = resultBlob(row);
  if (!b.trim()) return [];
  const groups: string[] = [];
  const add = (id: string) => {
    if (!groups.includes(id)) groups.push(id);
  };
  const isA1c = /hba1c|hb a1c|glycated|glycosylated/.test(b);
  if (GLUCOSE.test(b) || isA1c) add("glucose");
  if (!isA1c && HAEM.test(b)) add("haematology");
  if (RENAL.test(b) || (/calcium/.test(b) && !/vitamin/.test(b))) add("renal");
  if (LIVER.test(b) && !/urine/.test(b)) add("liver");
  if (LIPID.test(b)) add("lipid");
  if (THYROID.test(b)) add("thyroid");
  if (IRON.test(b) || (!isA1c && /haemoglobin|hemoglobin|(^|[^a-z])hb([^a-z]|$)|mcv|mch|rdw|ferritin|b12|folate/.test(b))) add("iron");
  if (VITAMIN.test(b) || /calcium|phosphorus|phosphate/.test(b)) add("vitamins");
  if (URINE.test(b) || (/urine/.test(b) && /protein|albumin|glucose|blood|rbc|wbc|ph\b/.test(b))) add("urinalysis");
  if (INFLAM.test(b)) add("inflammatory");
  if (/urine/.test(b) && /glucose/.test(b)) add("glucose");
  return groups;
}

export type PatternTableRow = {
  parameter_name: string;
  result_value: string;
  unit: string;
  reference_range: string;
  flag: string;
};

/** Match a pattern back to verified rows so the page can use the report table, not parsed prose. */
export function matchPatternResultRows(
  findings: string[],
  related: string[],
  results: OnePagerResult[],
): PatternTableRow[] {
  const rows = (results || [])
    .map((row) => ({
      parameter_name: String(row.parameter_name || row.param_code || "").trim(),
      result_value: String(row.result_value ?? "").trim(),
      unit: String(row.unit || "").trim(),
      reference_range: String(row.reference_range || "").trim(),
      flag: String(row.flag || "").trim().toUpperCase(),
    }))
    .filter((row) => row.parameter_name && row.result_value);

  const used = new Set<string>();
  const picked: PatternTableRow[] = [];
  const take = (text: string) => {
    const hay = text.toLowerCase();
    let best: PatternTableRow | null = null;
    let bestLen = 0;
    for (const row of rows) {
      const name = row.parameter_name.toLowerCase();
      if (used.has(name) || name.length < 2) continue;
      const hit = hay.includes(name) || (hay.length >= 3 && name.includes(hay));
      if (hit && name.length > bestLen) {
        best = row;
        bestLen = name.length;
      }
    }
    if (!best) return;
    used.add(best.parameter_name.toLowerCase());
    picked.push(best);
  };
  for (const text of findings || []) take(String(text || ""));
  if (picked.length === 0) {
    for (const text of related || []) take(String(text || ""));
  }
  return picked.slice(0, 8);
}

export function resultKey(row: OnePagerResult): string {
  const code = String(row.param_code || "").trim().toLowerCase();
  if (code) return `c:${code}`;
  const name = String(row.parameter_name || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
  return name ? `n:${name}` : "";
}

export function isAbnormalFlag(flag: string | null | undefined): boolean {
  const f = String(flag || "").trim().toUpperCase();
  if (!f || f === "N" || f === "NORMAL") return false;
  return f === "H" || f === "L" || f === "A" || f === "X" || f.includes("HH") || f.includes("LL") || f.includes("CRIT");
}

export type OnePagerParameter = {
  test_name: string;
  parameter_name: string;
  param_code: string;
  value: string;
  unit: string;
  reference_range: string;
  flag: string;
  abnormal: boolean;
  groups: string[];
  history: { date: string; value: string; flag: string }[];
};

export type DoctorOnePagerInput = {
  groups: { id: string; label: string; parameters: OnePagerParameter[] }[];
  ungrouped_abnormal: OnePagerParameter[];
  prior_visit_count: number;
};

function pack(row: OnePagerResult, history: { date: string; value: string; flag: string }[]): OnePagerParameter {
  const groups = clinicalGroupsFor(row);
  const testId = String(row.test_id || "").trim();
  return {
    test_name: String(row.test_name || "").trim(),
    parameter_name: String(row.parameter_name || "").trim(),
    param_code: String(row.param_code || "").trim(),
    value: String(row.result_value ?? "").trim(),
    unit: String(row.unit || "").trim(),
    reference_range: String(row.reference_range || "").trim(),
    flag: String(row.flag || "").trim(),
    abnormal: isAbnormalFlag(row.flag),
    groups: testId ? [...groups, `panel:${testId}`] : groups,
    history,
  };
}

/**
 * Group the current report and attach matching history.
 * Normal related parameters stay in the group so the model can see discordance.
 */
export function buildDoctorOnePagerInput(opts: {
  current: OnePagerResult[];
  priorVisits: PriorVisit[];
}): DoctorOnePagerInput {
  const priors = opts.priorVisits.slice(0, 4);
  const historyByKey = new Map<string, { date: string; value: string; flag: string }[]>();
  for (const visit of priors) {
    for (const row of visit.results || []) {
      const key = resultKey(row);
      if (!key) continue;
      const value = String(row.result_value ?? "").trim();
      if (!value) continue;
      const list = historyByKey.get(key) || [];
      list.push({
        date: visit.date,
        value,
        flag: String(row.flag || "").trim(),
      });
      historyByKey.set(key, list);
    }
  }

  const packed = (opts.current || [])
    .filter((row) => String(row.result_value ?? "").trim())
    .map((row) => pack(row, historyByKey.get(resultKey(row)) || []));

  const clinicalIds = Object.keys(CLINICAL_GROUP_LABELS);
  const groups = clinicalIds
    .map((id) => ({
      id,
      label: CLINICAL_GROUP_LABELS[id],
      parameters: packed.filter((p) => p.groups.includes(id)),
    }))
    .filter((g) => g.parameters.length > 0);

  const groupedKeys = new Set(
    groups.flatMap((g) => g.parameters.map((p) => `${p.param_code}|${p.parameter_name}|${p.value}`)),
  );
  const ungrouped_abnormal = packed.filter((p) => {
    const key = `${p.param_code}|${p.parameter_name}|${p.value}`;
    return p.abnormal && !groupedKeys.has(key);
  });

  return { groups, ungrouped_abnormal, prior_visit_count: priors.length };
}

const BANNED =
  /\b(prescribe|prescription|start medication|stop medication|dosage|dose change|mg\/day|tablet|capsule|definitely has|confirmed diagnosis|must take|patient has)\b/i;

const LAB_BLAME_SENTENCE =
  /[^.]*\b(contaminat\w*|haemolys\w*|hemolys\w*|clotted sample|insufficient sample|lab(?:oratory)? error|analytical error|pre-?analytical|sample mix-?up|wrong sample|spoiled sample|unfit sample|repeat collection)\b[^.]*\.?/gi;

export function scrubClinicalText(text: string): string {
  let clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) return "";
  clean = clean.replace(LAB_BLAME_SENTENCE, " ").replace(/\s+/g, " ").trim();
  clean = clean.replace(/\bflagged\s+(low|high)\s+by\s+(the\s+)?lab\b/gi, "result is $1");
  clean = clean.replace(/\b(is|are)\s+(low|high)\s+by\s+(the\s+)?lab\b/gi, "result is $2");
  clean = clean.replace(/\bby\s+(the\s+)?lab\b/gi, "");
  clean = clean.replace(
    /\bno\s+(?:prior|previous|earlier)\s+(?:results?\s+)?(?:for\s+|of\s+)?([^.]{0,60}?)\s+results?\s+(?:were\s+|are\s+|was\s+)?(?:not\s+)?(?:provided|available|given)\b[^.]*\.?/gi,
    (_match, what: string) => {
      const name = String(what || "").replace(/^(for|of)\s+/i, "").replace(/\s+(results?|values?)$/i, "").trim();
      return name ? `Prior history for ${name} not available.` : "Prior history for this test not available.";
    },
  );
  clean = clean.replace(
    /\bno\s+(?:prior|previous|earlier)\s+results?\b[^.]*\.?/gi,
    "Prior history for this test not available.",
  );
  clean = clean.replace(/\s+/g, " ").replace(/\s+([,.;])/g, "$1").trim();
  if (!clean) return "";
  if (!BANNED.test(clean)) return clean;
  return "Correlate with clinical history. This summary does not diagnose or recommend treatment.";
}

export type DoctorOnePagerPattern = {
  category: string;
  pattern_name: string;
  current_findings: string[];
  related_parameters_considered: string[];
  historical_context: string;
  status: string;
  integrated_interpretation: string;
  clinical_correlation: string[];
};

export type SuggestedFollowUp = {
  test: string;
  when: string;
  note: string;
};

export type DoctorOnePagerSummary = {
  overall_clinical_snapshot: string;
  clinical_patterns: DoctorOnePagerPattern[];
  important_isolated_findings: string[];
  historical_changes: {
    new: string[];
    worsening: string[];
    improving: string[];
    stable: string[];
    resolved: string[];
  };
  points_for_clinical_review: string[];
  suggested_follow_up: SuggestedFollowUp[];
  overall_comment: string;
};

function asStringList(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => scrubClinicalText(typeof item === "string" ? item : ""))
    .filter(Boolean)
    .slice(0, max);
}

export function normalizeDoctorOnePagerSummary(raw: any): DoctorOnePagerSummary {
  const patterns = Array.isArray(raw?.clinical_patterns) ? raw.clinical_patterns : [];
  const history = raw?.historical_changes && typeof raw.historical_changes === "object" ? raw.historical_changes : {};
  return {
    overall_clinical_snapshot: scrubClinicalText(raw?.overall_clinical_snapshot),
    clinical_patterns: patterns.slice(0, 4).map((p: any) => ({
      category: String(p?.category || "").trim(),
      pattern_name: scrubClinicalText(p?.pattern_name) || "Pattern",
      current_findings: asStringList(p?.current_findings, 6),
      related_parameters_considered: asStringList(p?.related_parameters_considered, 12),
      historical_context: scrubClinicalText(p?.historical_context),
      status: String(p?.status || "INDETERMINATE").trim().toUpperCase(),
      integrated_interpretation: scrubClinicalText(p?.integrated_interpretation),
      clinical_correlation: asStringList(p?.clinical_correlation, 2),
    })),
    important_isolated_findings: asStringList(raw?.important_isolated_findings, 3),
    historical_changes: {
      new: asStringList(history.new, 3),
      worsening: asStringList(history.worsening, 3),
      improving: asStringList(history.improving, 3),
      stable: asStringList(history.stable, 3),
      resolved: asStringList(history.resolved, 3),
    },
    points_for_clinical_review: asStringList(raw?.points_for_clinical_review, 3),
    suggested_follow_up: (Array.isArray(raw?.suggested_follow_up) ? raw.suggested_follow_up : [])
      .slice(0, 4)
      .map((item: any) => ({
        test: scrubClinicalText(item?.test),
        when: scrubClinicalText(item?.when),
        note: scrubClinicalText(item?.note),
      }))
      .filter((item: SuggestedFollowUp) => item.test),
    overall_comment: scrubClinicalText(raw?.overall_comment),
  };
}