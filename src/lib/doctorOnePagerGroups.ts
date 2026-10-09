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
const LIPID = /cholesterol|\bldl\b|\bhdl\b|ldlc|hdlc|triglyceride|\bvldl\b|non-hdl|ldl\s*[/:-]\s*hdl|hdl\s*[/:-]\s*ldl|chol\s*[/:-]\s*hdl/;
const THYROID = /\btsh\b|free t3|free t4|\bft3\b|\bft4\b|\bt3\b|\bt4\b|anti-?tpo|thyroglobulin|thyroid antibody/;
const IRON = /serum iron|\biron\b|ferritin|\btibc\b|\buibc\b|transferrin|saturation/;
const VITAMIN = /vitamin\s*b12|b12|cobalamin|folate|folic|vitamin\s*d|\bvit\s*d\b|\bpth\b|parathyroid/;
const URINE = /urin|urinalysis|ketone|nitrite|leucocyte esterase|leukocyte esterase|specific gravity|\bcasts?\b|\bcrystals?\b|pus cell|epithelial/;
const INFLAM = /\bcrp\b|c-reactive|\besr\b|procalcitonin/;

export function resultBlob(row: OnePagerResult): string {
  return [row.param_code, row.parameter_name, row.test_name]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .replace(/\./g, "");
}

function groupFromText(text: string): string | null {
  const b = text.toLowerCase().replace(/\./g, "");
  if (!b.trim()) return null;
  const isA1c = /hba1c|hb a1c|glycated|glycosylated/.test(b);
  if (URINE.test(b)) return "urinalysis";
  if (INFLAM.test(b)) return "inflammatory";
  if (LIPID.test(b)) return "lipid";
  if (THYROID.test(b)) return "thyroid";
  if (isA1c || GLUCOSE.test(b)) return "glucose";
  if (LIVER.test(b)) return "liver";
  if (RENAL.test(b)) return "renal";
  if (VITAMIN.test(b)) return "vitamins";
  if (IRON.test(b)) return "iron";
  if (HAEM.test(b)) return "haematology";
  if (/calcium|phosphorus|phosphate/.test(b)) return "renal";
  return null;
}

/**
 * The one box a parameter belongs in. The parameter's own name decides.
 * A shared panel word such as ESR on the test name cannot pull haemoglobin
 * out of the blood-count box. A urine test still keeps urine RBC and urine glucose.
 */
export function primaryGroupFor(row: OnePagerResult): string | null {
  const param = [row.param_code, row.parameter_name].filter(Boolean).join(" ");
  const test = String(row.test_name || "");
  if (URINE.test(`${param} ${test}`.toLowerCase())) return "urinalysis";
  return groupFromText(param) || groupFromText(test);
}

/** Groups a parameter belongs to. A parameter has one home group. */
export function clinicalGroupsFor(row: OnePagerResult): string[] {
  const id = primaryGroupFor(row);
  return id ? [id] : [];
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

const GROUP_HINTS: Record<string, RegExp> = {
  haematology: /haematolog|hematolog|\bcbc\b|red cell|haemoglobin|hemoglobin|anaem|anem|normocytic|normochromic/,
  glucose: /glucose|\bfbs\b|\bppbs\b|hba1c|glycaem|glycem|diabetes/,
  renal: /renal|kidney|creatinine|\begfr\b|\burea\b/,
  liver: /liver|bilirubin|\bast\b|\balt\b|sgot|sgpt|\bggt\b/,
  lipid: /lipid|cholesterol|\bhdl\b|\bldl\b|ldlc|hdlc|triglyceride|\bvldl\b/,
  thyroid: /thyroid|\btsh\b|\bft3\b|\bft4\b/,
  iron: /\biron\b|ferritin|\btibc\b/,
  vitamins: /vitamin|\bb12\b|folate|cobalamin/,
  urinalysis: /urin|pyuria|pus cell/,
  inflammatory: /inflammat|\bcrp\b|\besr\b/,
};

function toPatternTableRow(row: OnePagerResult): PatternTableRow | null {
  const parameter_name = String(row.parameter_name || row.param_code || "").trim();
  const result_value = String(row.result_value ?? "").trim();
  if (!parameter_name || !result_value) return null;
  return {
    parameter_name,
    result_value,
    unit: String(row.unit || "").trim(),
    reference_range: String(row.reference_range || "").trim(),
    flag: String(row.flag || "").trim().toUpperCase(),
  };
}

const GROUP_PRIORITY = ["urinalysis", "inflammatory", "lipid", "thyroid", "glucose", "liver", "renal", "vitamins", "iron", "haematology"];

function groupsMentioned(blob: string): string[] {
  const ids: string[] = [];
  const add = (id: string) => {
    if (CLINICAL_GROUP_LABELS[id] && !ids.includes(id)) ids.push(id);
  };
  for (const [id, label] of Object.entries(CLINICAL_GROUP_LABELS)) {
    if (blob.includes(id) || blob.includes(label.toLowerCase())) add(id);
  }
  for (const [id, hint] of Object.entries(GROUP_HINTS)) {
    if (hint.test(blob)) add(id);
  }
  return ids;
}

function findSource(row: PatternTableRow, results: OnePagerResult[]): OnePagerResult | undefined {
  const name = row.parameter_name.toLowerCase();
  return (results || []).find((item) => String(item.parameter_name || item.param_code || "").trim().toLowerCase() === name);
}

function pickOneGroup(
  hits: string[],
  pattern: { current_findings?: string[] },
  results: OnePagerResult[],
): string | null {
  if (hits.length === 0) return null;
  if (hits.length === 1) return hits[0];
  const named = matchPatternResultRows(pattern.current_findings || [], [], results);
  const scores = new Map<string, number>();
  for (const row of named) {
    const source = findSource(row, results);
    const home = source ? primaryGroupFor(source) : null;
    if (home && hits.includes(home)) scores.set(home, (scores.get(home) || 0) + 1);
  }
  let best: string | null = null;
  let bestScore = 0;
  for (const id of hits) {
    const score = scores.get(id) || 0;
    if (score > bestScore) {
      best = id;
      bestScore = score;
    }
  }
  if (best) return best;
  return [...hits].sort((a, b) => GROUP_PRIORITY.indexOf(a) - GROUP_PRIORITY.indexOf(b))[0] || null;
}

function patternHomeGroup(
  pattern: { category?: string; pattern_name?: string; current_findings?: string[] },
  named: PatternTableRow[],
  results: OnePagerResult[],
): string | null {
  const title = [pattern.category, pattern.pattern_name].filter(Boolean).join(" ").toLowerCase();
  const fromTitle = pickOneGroup(groupsMentioned(title), pattern, results);
  if (fromTitle) return fromTitle;
  const fromFindings = pickOneGroup(groupsMentioned((pattern.current_findings || []).join(" ").toLowerCase()), pattern, results);
  if (fromFindings) return fromFindings;
  const homes = named
    .map((row) => {
      const source = findSource(row, results);
      return source ? primaryGroupFor(source) : null;
    })
    .filter((id): id is string => !!id);
  return pickOneGroup([...new Set(homes)], pattern, results);
}

function testKey(row: OnePagerResult): string {
  const id = String(row.test_id || "").trim();
  if (id) return `id:${id}`;
  const name = String(row.test_name || "").trim().toLowerCase();
  return name ? `name:${name}` : "";
}

function abnormalRowsForHome(groupId: string | null, results: OnePagerResult[]): PatternTableRow[] {
  if (!groupId) return [];
  const picked: PatternTableRow[] = [];
  const used = new Set<string>();
  const testKeys = new Set<string>();
  const take = (row: OnePagerResult) => {
    const table = toPatternTableRow(row);
    if (!table) return;
    const key = table.parameter_name.toLowerCase();
    if (used.has(key)) return;
    used.add(key);
    picked.push(table);
    const token = testKey(row);
    if (token) testKeys.add(token);
  };
  for (const row of results || []) {
    if (!isAbnormalFlag(row.flag)) continue;
    if (primaryGroupFor(row) === groupId) take(row);
  }
  for (const row of results || []) {
    if (!isAbnormalFlag(row.flag) || primaryGroupFor(row)) continue;
    const token = testKey(row);
    if (token && testKeys.has(token)) take(row);
  }
  return picked;
}

/**
 * Pattern table rows: every abnormal parameter in the same test group, plus any
 * abnormal row the summary named. Normal related values stay in the narrative.
 */
export function rowsForPatternBox(
  pattern: { category?: string; pattern_name?: string; current_findings?: string[]; related_parameters_considered?: string[] },
  results: OnePagerResult[],
): PatternTableRow[] {
  const named = matchPatternResultRows(pattern.current_findings || [], pattern.related_parameters_considered || [], results);
  const groupId = patternHomeGroup(pattern, named, results);
  const abnormal = abnormalRowsForHome(groupId, results);
  const seen = new Set(abnormal.map((row) => row.parameter_name.toLowerCase()));
  const extras = named.filter((row) => {
    if (!isAbnormalFlag(row.flag) || seen.has(row.parameter_name.toLowerCase())) return false;
    const source = findSource(row, results);
    if (!source) return false;
    const home = primaryGroupFor(source);
    return !groupId || home === groupId || !home;
  });
  return [...abnormal, ...extras].slice(0, 24);
}

export type AbnormalBox = { id: string; label: string; rows: PatternTableRow[] };

function mentionsParameter(line: string, parameterName: string): boolean {
  const text = line.toLowerCase();
  const name = parameterName.toLowerCase().trim();
  if (name.length >= 4 && text.includes(name)) return true;
  const core = name.replace(/\(.*?\)/g, "").trim();
  return core.length >= 4 && text.includes(core);
}

function sameFinding(a: string, b: string): boolean {
  const words = (line: string) => new Set(line.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((word) => word.length > 2));
  const left = words(a);
  const right = words(b);
  const [small, large] = left.size <= right.size ? [left, right] : [right, left];
  if (small.size < 4) return false;
  let shared = 0;
  for (const word of small) if (large.has(word)) shared += 1;
  return shared / small.size >= 0.72;
}

/** Short AI sentences that belong under an abnormal-parameter box. Repeated wording is dropped. */
export function explanationsForBox(
  box: { id: string; label: string; rows: { parameter_name: string }[] },
  notes: { profile: string; note: string }[],
  isolated: string[],
): string[] {
  const lines: string[] = [];
  const covered = new Set<string>();
  const add = (line: string) => {
    const text = line.trim();
    if (!text || lines.some((kept) => kept.toLowerCase() === text.toLowerCase() || sameFinding(kept, text))) return;
    const mentioned = box.rows.map((row) => row.parameter_name).filter((name) => mentionsParameter(text, name));
    if (mentioned.length > 0 && mentioned.every((name) => covered.has(name.toLowerCase()))) return;
    mentioned.forEach((name) => covered.add(name.toLowerCase()));
    lines.push(text);
  };
  const blob = `${box.id} ${box.label}`.toLowerCase();
  for (const note of notes || []) {
    const profile = note.profile.toLowerCase();
    const aboutBox = blob.includes(profile) || profile.includes(box.id) || box.rows.some((row) => mentionsParameter(note.profile, row.parameter_name) || mentionsParameter(note.note, row.parameter_name));
    if (aboutBox) add(note.note);
  }
  for (const line of isolated || []) {
    if (box.rows.some((row) => mentionsParameter(line, row.parameter_name))) add(line);
  }
  return lines.slice(0, 3);
}

/** Abnormal parameters that no pattern box already shows, grouped by test family. */
export function leftoverAbnormalBoxes(results: OnePagerResult[], shownNames: Set<string>): AbnormalBox[] {
  const buckets = new Map<string, PatternTableRow[]>();
  for (const row of results || []) {
    if (!isAbnormalFlag(row.flag)) continue;
    const table = toPatternTableRow(row);
    if (!table || shownNames.has(table.parameter_name.toLowerCase())) continue;
    const home = primaryGroupFor(row);
    const id = home || testKey(row) || "other";
    const list = buckets.get(id) || [];
    list.push(table);
    buckets.set(id, list);
  }
  return [...buckets.entries()].map(([id, rows]) => ({
    id,
    label: CLINICAL_GROUP_LABELS[id] || String(results.find((row) => testKey(row) === id)?.test_name || "").trim() || "Other abnormal results",
    rows,
  }));
}

export type MergedAbnormalBox = AbnormalBox & { interpretation: string; history: string };

/** Every abnormal test in one list. Pattern comments sit under the matching test. */
export function mergedAbnormalBoxes(
  patterns: Array<{
    category?: string;
    pattern_name?: string;
    current_findings?: string[];
    related_parameters_considered?: string[];
    integrated_interpretation?: string;
    historical_context?: string;
  }>,
  results: OnePagerResult[],
): MergedAbnormalBox[] {
  const boxes: MergedAbnormalBox[] = leftoverAbnormalBoxes(results, new Set()).map((box) => ({
    ...box,
    interpretation: "",
    history: "",
  }));
  const byId = new Map(boxes.map((box) => [box.id, box]));
  for (const pattern of patterns || []) {
    const named = matchPatternResultRows(pattern.current_findings || [], pattern.related_parameters_considered || [], results);
    const id = patternHomeGroup(pattern, named, results);
    const interpretation = String(pattern.integrated_interpretation || "").trim();
    const history = String(pattern.historical_context || "").trim();
    let box = id ? byId.get(id) : undefined;
    if (!box) {
      const rows = rowsForPatternBox(pattern, results);
      if (rows.length === 0 && !interpretation && !history) continue;
      const key = id || `pattern:${boxes.length}`;
      box = {
        id: key,
        label: (id && CLINICAL_GROUP_LABELS[id]) || String(pattern.pattern_name || "").trim() || "Other abnormal results",
        rows,
        interpretation: "",
        history: "",
      };
      boxes.push(box);
      byId.set(key, box);
    }
    if (interpretation) {
      box.interpretation = box.interpretation && !sameFinding(box.interpretation, interpretation)
        ? `${box.interpretation} ${interpretation}`
        : box.interpretation || interpretation;
    }
    if (history && !box.history) box.history = history;
  }
  return boxes.filter((box) => box.rows.length > 0 || box.interpretation || box.history);
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
  return f === "H" || f === "L" || f === "A" || f === "X" || f === "HIGH" || f === "LOW" || f.includes("HH") || f.includes("LL") || f.includes("CRIT");
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
  patient: { age: string | null; gender: string | null };
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
  age?: string | null;
  gender?: string | null;
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
    .filter((row) => !/morpholog/.test(resultBlob(row)))
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

  const age = String(opts.age || "").trim();
  const gender = String(opts.gender || "").trim();
  return {
    patient: {
      age: !age || age === "—" ? null : age,
      gender: gender || null,
    },
    groups,
    ungrouped_abnormal,
    prior_visit_count: priors.length,
  };
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
  clean = clean.replace(
    /,?\s*(?:while|whereas|although|but|and)?\s*(?:the\s+)?(?:reported\s+)?(?:rbc\s+|red\s*cell\s+|erythrocyte\s+|smear\s+)?morphology\s+is\s+(?:(?:normocytic|microcytic|macrocytic|normochromic|hypochromic|hyperchromic)\s*)+/gi,
    " ",
  );
  clean = clean.replace(/\b(?:reported\s+)?(?:rbc\s+|red\s*cell\s+|smear\s+)?morphology\b/gi, "");
  clean = clean.replace(/\b(?:normocytic|microcytic|macrocytic|normochromic|hypochromic|hyperchromic)\b/gi, "");
  clean = clean.replace(/,?\s*\bsuggest(?:s|ed|ing)?\s+an?\s+(?:[\w-]+\s+){0,4}pattern\b(?:\s+with\s+[^,.]*)?/gi, "");
  clean = clean.replace(/\b(?:anaem\w*|anem\w*)[-\s]*pattern\b/gi, "");
  clean = clean.replace(/\b(?:(?:mild|moderate|marked|severe|reactive|mildly)\s+)*thrombocytosis\b/gi, "high platelet count");
  clean = clean.replace(/\b(?:(?:mild|moderate|marked|severe)\s+)*thrombocytop(?:enia|aenia)\b/gi, "low platelet count");
  clean = clean.replace(/\b(?:leuco|leuko)cytosis\b/gi, "high white-cell count");
  clean = clean.replace(/\b(?:leuco|leuko)(?:penia|paenia)\b/gi, "low white-cell count");
  clean = clean.replace(/\b(?:anaem\w*|anem\w*|anisocytosis|poikilocytosis|polycyth(?:a)?emia|polycythemia|diabet\w*|hypothyroidism|hyperthyroidism)\b/gi, "");
  clean = clean.replace(/\b(?:cbc|haematology|hematology|blood[- ]count)\s+findings\b/gi, "haemoglobin findings");
  clean = clean.replace(/\b(?:alongside|along with|together with)\s+the\s+cbc\b/gi, "alongside the haemoglobin findings");
  clean = clean.replace(/\s+/g, " ").replace(/\s+([,.;])/g, "$1").replace(/^[,\s]+/, "").trim();
  if (!clean) return "";
  if (!BANNED.test(clean)) return clean;
  return "Correlate with clinical history. This summary does not diagnose or recommend treatment.";
}

const TEACHING_POINT =
  /\b(please|kindly|should|must|ought to|needs? to|consider|recommend\w*|advis\w*|correlat\w*|evaluate|rule out|work-?up|monitor|follow[- ]?up|ensure|physician|doctor|it is important|prudent|warrants|attention is drawn|clinical correlation)\b/i;

/** Drop advice aimed at the treating doctor. Keep the laboratory observation. */
export function softenReviewPoint(text: string): string {
  const clean = scrubClinicalText(text);
  if (!clean) return "";
  const kept = clean
    .split(/(?<=[.])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence && !TEACHING_POINT.test(sentence));
  return kept.join(" ").replace(/\s+/g, " ").trim();
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
  overall_clinical_snapshot: string[];
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
  profile_notes: { profile: string; note: string }[];
  overall_comment: string;
};

const SNAPSHOT_PROFILE = "haematolog\\w*|hematolog\\w*|\\bcbc\\b|complete blood count|urinalys\\w*|\\burine\\b|glucose|glycaem\\w*|glycem\\w*|lipid\\w*|cholesterol|thyroid|renal|kidney|liver|\\biron\\b|vitamin\\w*";

/** One bullet per test or profile. A combined paragraph is split where the next profile starts. */
export function snapshotBullets(value: unknown): string[] {
  const rawParts = Array.isArray(value) ? value : [value];
  const lines: string[] = [];
  const whileJoin = new RegExp(`\\s*,?\\s+while\\s+(?=(?:${SNAPSHOT_PROFILE})\\b)`, "ig");
  const sentenceJoin = new RegExp(`\\.\\s+(?=(?:${SNAPSHOT_PROFILE})\\b)`, "ig");
  for (const part of rawParts) {
    let text = scrubClinicalText(typeof part === "string" ? part : "");
    if (!text) continue;
    text = text.replace(whileJoin, ". ");
    for (const bit of text.split(sentenceJoin)) {
      const line = bit.trim().replace(/\s+/g, " ");
      if (!line) continue;
      const sentence = /[.!?]$/.test(line) ? line : `${line}.`;
      const finished = sentence.charAt(0).toUpperCase() + sentence.slice(1);
      if (!lines.includes(finished)) lines.push(finished);
    }
  }
  return lines.slice(0, 6);
}

function asStringList(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => scrubClinicalText(typeof item === "string" ? item : ""))
    .filter(Boolean)
    .slice(0, max);
}

function leadCapital(text: string): string {
  const value = text.trim();
  if (!value) return "";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function normalizeDoctorOnePagerSummary(raw: any): DoctorOnePagerSummary {
  const patterns = Array.isArray(raw?.clinical_patterns) ? raw.clinical_patterns : [];
  const history = raw?.historical_changes && typeof raw.historical_changes === "object" ? raw.historical_changes : {};
  return {
    overall_clinical_snapshot: snapshotBullets(raw?.overall_clinical_snapshot),
    clinical_patterns: patterns.slice(0, 4).map((p: any) => ({
      category: String(p?.category || "").trim(),
      pattern_name: leadCapital(scrubClinicalText(p?.pattern_name)) || "Pattern",
      current_findings: asStringList(p?.current_findings, 6),
      related_parameters_considered: asStringList(p?.related_parameters_considered, 12),
      historical_context: scrubClinicalText(p?.historical_context),
      status: String(p?.status || "INDETERMINATE").trim().toUpperCase(),
      integrated_interpretation: leadCapital(scrubClinicalText(p?.integrated_interpretation)),
      clinical_correlation: asStringList(p?.clinical_correlation, 2),
    })),
    important_isolated_findings: asStringList(raw?.important_isolated_findings, 8),
    historical_changes: {
      new: asStringList(history.new, 3),
      worsening: asStringList(history.worsening, 3),
      improving: asStringList(history.improving, 3),
      stable: asStringList(history.stable, 3),
      resolved: asStringList(history.resolved, 3),
    },
    points_for_clinical_review: asStringList(raw?.points_for_clinical_review, 4).map(softenReviewPoint).filter(Boolean),
    profile_notes: (Array.isArray(raw?.profile_notes) ? raw.profile_notes : [])
      .slice(0, 8)
      .map((item: any) => ({
        profile: scrubClinicalText(item?.profile),
        note: scrubClinicalText(item?.note),
      }))
      .filter((item: { profile: string; note: string }) => item.note),
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
