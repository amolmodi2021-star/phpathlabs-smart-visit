export type AbnormalFlag = "H" | "L" | "N" | "X";

export interface FlagEvaluationInput {
  result_value?: string | number | null;
  normal_range_low?: string | number | null;
  normal_range_high?: string | number | null;
  normal_range_text?: string | null;
  flag?: string | null;
}

/** Inputs used by Results Entry / Verification / Approval for live flagging. */
export interface ResultFlagInput {
  value: string;
  low?: number | null;
  high?: number | null;
  rangeType?: string;
  /** Qualitative pair label / expected normal. */
  expectedValue?: string;
  descriptiveOptions?: string[];
  /** Display Text — shown on report as reference range (NOT used for descriptive highlight). */
  normalRangeText?: string;
  /** Descriptive only: acceptable normal result(s); used for highlight, not shown on report. */
  normalFindings?: string;
  unit?: string | null;
}

const extractNumber = (value: string | number | null | undefined): number | null => {
  if (value === null || value === undefined) return null;
  const str = String(value).trim();
  if (!str) return null;
  const match = str.replace(/,/g, "").match(/-?\d*\.?\d+/);
  if (!match) return null;
  const parsed = Number.parseFloat(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
};

/**
 * Detect a leading comparison operator on a result value.
 *
 * Lab analyzers and manual entries often report capped readings as
 * ">2000", "> 2000", ">=2000", "≥ 2000" (above measurable range) or
 * "<2", "< 2", "<=2", "≤ 2" (below detection limit). The whitespace
 * between operator and number is inconsistent across instruments and
 * typists.
 */
type ResultOperator = "gt" | "lt" | null;
const detectResultOperator = (value: string | number | null | undefined): ResultOperator => {
  if (value === null || value === undefined) return null;
  const str = String(value).trim();
  if (!str) return null;
  if (/^(?:>=|≥|>)\s*-?\d*\.?\d+/.test(str)) return "gt";
  if (/^(?:<=|≤|<)\s*-?\d*\.?\d+/.test(str)) return "lt";
  return null;
};

/**
 * Compare an operator-prefixed result (`<15`, `> 60`) against numeric bounds.
 * Spaces between operator and number are ignored.
 *
 * Examples:
 *   result `<15` / `< 15`, high=15 (range `<15` or `0-15`) → N
 *   result `<15`, high=10 → H
 *   result `>60`, low=60, open high → N
 *   result `>200`, high=15 → H
 */
export const flagOperatorAgainstBounds = (
  op: "gt" | "lt",
  value: number,
  low: number | null,
  high: number | null,
): AbnormalFlag => {
  if (op === "lt") {
    // true_value ≤ value — normal when the stated ceiling is within the ref high
    if (high != null && value <= high) return "N";
    if (low != null && value <= low) return "L";
    if (high != null && value > high) return "H";
    return "L";
  }
  // true_value ≥ value
  if (low != null && value >= low && (high == null || value <= high)) return "N";
  if (high != null && value >= high) return "H";
  if (low != null && value < low) return "L";
  return "H";
};

const NORMAL_CATEGORY_KEYWORDS = [
  "normal", "non-diabetic", "nondiabetic", "non diabetic",
  "sufficient", "sufficiency", "desirable", "optimal",
  "no risk", "norisk", "acceptable", "negative", "reference",
];

/**
 * Extract bounds from the desirable / "No Risk" / "Optimal" line of a
 * multi-band advisory (e.g. HDL "No Risk: > 60" → low=60, open high).
 * Scans line-by-line so Moderate/High Risk bands on other lines are ignored.
 */
export const findNormalCategoryBounds = (text: string): { low: number | null; high: number | null } | null => {
  const lines = String(text).split(/\r?\n/);

  for (const line of lines) {
    const lower = line.toLowerCase();
    if (!NORMAL_CATEGORY_KEYWORDS.some((keyword) => lower.includes(keyword))) continue;

    const rangeMatch = line.match(/(-?\d*\.?\d+)\s*(?:to|-|–|—)\s*(-?\d*\.?\d+)/i);
    if (rangeMatch) {
      const lo = Number.parseFloat(rangeMatch[1]);
      const hi = Number.parseFloat(rangeMatch[2]);
      if (Number.isFinite(lo) && Number.isFinite(hi)) return { low: lo, high: hi };
    }

    const upperMatch = line.match(/(?:<=|≤|<)\s*(-?\d*\.?\d+)/);
    if (upperMatch) {
      const hi = Number.parseFloat(upperMatch[1]);
      if (Number.isFinite(hi)) return { low: null, high: hi };
    }

    const lowerMatch = line.match(/(?:>=|≥|>)\s*(-?\d*\.?\d+)/);
    if (lowerMatch) {
      const lo = Number.parseFloat(lowerMatch[1]);
      if (Number.isFinite(lo)) return { low: lo, high: null };
    }
  }

  return null;
};

const parseBoundsFromText = (rangeText?: string | null): { low: number | null; high: number | null } => {
  if (!rangeText) return { low: null, high: null };

  const text = rangeText.replace(/,/g, " ");

  const upperMatches = Array.from(text.matchAll(/(?:<=|≤|<|less\s*than|up\s*to|upto)\s*(-?\d*\.?\d+)/gi))
    .map((m) => Number.parseFloat(m[1]))
    .filter((n) => Number.isFinite(n));

  const lowerMatches = Array.from(text.matchAll(/(?:>=|≥|>|greater\s*than|more\s*than)\s*(-?\d*\.?\d+)/gi))
    .map((m) => Number.parseFloat(m[1]))
    .filter((n) => Number.isFinite(n));

  let low = lowerMatches.length ? Math.max(...lowerMatches) : null;
  let high = upperMatches.length ? Math.min(...upperMatches) : null;

  if (low === null && high === null) {
    const ranges = Array.from(text.matchAll(/(-?\d*\.?\d+)\s*(?:to|-|–|—)\s*(-?\d*\.?\d+)/gi))
      .map((m) => ({ low: Number.parseFloat(m[1]), high: Number.parseFloat(m[2]) }))
      .filter((r) => Number.isFinite(r.low) && Number.isFinite(r.high));

    if (ranges.length > 0) {
      low = ranges[0].low;
      high = ranges[0].high;
    }
  }

  if (low !== null && high !== null && low > high) {
    const normalBounds = findNormalCategoryBounds(text);
    if (normalBounds && (normalBounds.low !== null || normalBounds.high !== null)) {
      return normalBounds;
    }
    const temp = low;
    low = high;
    high = temp;
  }

  return { low, high };
};

const ABSENT_MARKERS = ["absent", "nil", "negative", "none", "not seen", "no "];
const PRESENT_MARKERS = ["present", "positive", "trace", "occasional", "few", "many", "seen", "detected"];

const normalizeText = (value: string | number | null | undefined): string =>
  String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const containsMarker = (text: string, markers: string[]) => markers.some((marker) => text.includes(marker));

const computeQualitativeFlag = (row: FlagEvaluationInput): AbnormalFlag | null => {
  const resultText = normalizeText(row.result_value);
  const referenceText = normalizeText(row.normal_range_text);
  if (!resultText || !referenceText) return null;

  const referenceExpectsAbsent = containsMarker(referenceText, ABSENT_MARKERS);
  const resultIsPresent = containsMarker(resultText, PRESENT_MARKERS);
  if (referenceExpectsAbsent && resultIsPresent) return "H";

  const referenceExpectsPresent = containsMarker(referenceText, PRESENT_MARKERS);
  const resultIsAbsent = containsMarker(resultText, ABSENT_MARKERS);
  if (referenceExpectsPresent && resultIsAbsent) return "L";

  if (resultText === referenceText || resultText.includes(referenceText) || referenceText.includes(resultText)) {
    return "N";
  }

  return null;
};

const stripTrailingUnit = (raw: string, unit?: string | null): string => {
  let t = raw.trim().toLowerCase().replace(/\s+/g, " ");
  const u = (unit || "").trim().toLowerCase();
  if (u && t.endsWith(u)) t = t.slice(0, -u.length).trim();
  return t;
};

/** Split Normal Findings into acceptable values (`|` or newlines). */
const splitNormalFindings = (raw?: string | null): string[] => {
  if (!raw) return [];
  return String(raw)
    .split(/\r?\n|\|/)
    .map((s) => s.trim())
    .filter(Boolean);
};

/**
 * Live flag for Results / Verification / Approval / interface.
 * - descriptive: compare against normalFindings only → N or X (highlight, no H/L)
 * - qualitative: compare against display text / expected value → N or X
 * - numeric: H/L/N, with `<15` / `> 60` compared to bounds (spaces trimmed)
 */
export const calculateResultFlag = (input: ResultFlagInput): string => {
  const value = (input.value ?? "").toString();
  if (!value.trim()) return "";
  const rangeType = input.rangeType || "numeric";
  if (rangeType === "undefined") return "";

  if (rangeType === "time") {
    const num = extractNumber(value);
    if (num == null) return "";
    if (input.low != null && num < input.low) return "L";
    if (input.high != null && num > input.high) return "H";
    return "N";
  }

  if (rangeType === "descriptive") {
    const findings = splitNormalFindings(input.normalFindings);
    if (findings.length === 0) return "";
    const got = stripTrailingUnit(value, input.unit);
    const ok = findings.some((f) => stripTrailingUnit(f, input.unit) === got);
    return ok ? "N" : "X";
  }

  if (rangeType === "qualitative") {
    const ref = stripTrailingUnit(input.normalRangeText || input.expectedValue || "", input.unit);
    if (!ref) return "";
    return stripTrailingUnit(value, input.unit) === ref ? "N" : "X";
  }

  const operator = detectResultOperator(value);
  const num = extractNumber(value);
  if (num == null) return "";

  let low = input.low ?? null;
  let high = input.high ?? null;
  if (low == null && high == null) {
    const textBounds = parseBoundsFromText(input.normalRangeText);
    low = textBounds.low;
    high = textBounds.high;
  }

  if (operator === "gt" || operator === "lt") {
    return flagOperatorAgainstBounds(operator, num, low, high);
  }

  if (low != null && num < low) return "L";
  if (high != null && num > high) return "H";
  return "N";
};

export const computeAbnormalFlag = (row: FlagEvaluationInput): AbnormalFlag => {
  const existingFlag = String(row.flag ?? "").toUpperCase();
  const value = extractNumber(row.result_value);
  const operator = detectResultOperator(row.result_value);
  if (value === null) {
    const qualitativeFlag = computeQualitativeFlag(row);
    if (qualitativeFlag) return qualitativeFlag;
    return existingFlag === "H" || existingFlag === "L" || existingFlag === "X"
      ? (existingFlag as AbnormalFlag)
      : "N";
  }

  const explicitLow = extractNumber(row.normal_range_low);
  const explicitHigh = extractNumber(row.normal_range_high);
  const textBounds = parseBoundsFromText(row.normal_range_text);

  let low = explicitLow ?? textBounds.low;
  let high = explicitHigh ?? textBounds.high;

  if (low !== null && high !== null && low > high) {
    if (textBounds.low !== null && textBounds.high !== null && textBounds.low <= textBounds.high) {
      low = textBounds.low;
      high = textBounds.high;
    } else {
      const temp = low;
      low = high;
      high = temp;
    }
  }

  if (operator === "gt" || operator === "lt") {
    return flagOperatorAgainstBounds(operator, value, low, high);
  }

  if (low === null && high === null) {
    return existingFlag === "H" || existingFlag === "L" ? existingFlag : "N";
  }

  if (high !== null && value > high) return "H";
  if (low !== null && value < low) return "L";
  return "N";
};

/**
 * Detect a "suspect negative" numeric result — almost always an instrument
 * error or typing slip (e.g. "-1.02", "- 1.02", ">-1", "> -2").
 */
export const isSuspectNegativeResult = (value: string | number | null | undefined): boolean => {
  if (value === null || value === undefined) return false;
  const stripped = String(value).trim().replace(/^(?:>=|≥|>|<=|≤|<)\s*/, "").trim();
  if (!stripped) return false;
  if (!/^-\s*\d*\.?\d+\s*$/.test(stripped.replace(/,/g, ""))) return false;
  const num = Number.parseFloat(stripped.replace(/,/g, "").replace(/-\s+/, "-"));
  return Number.isFinite(num) && num < 0;
};

/** H / L / A / X — same set Results & Verification highlight. */
export const isAbnormalResultFlag = (flag?: string | null): boolean => {
  const f = String(flag || "").toUpperCase();
  return f === "H" || f === "L" || f === "A" || f === "X";
};

/**
 * Display / save flag for CBC-style read-only or lightly-edited grids.
 * Keep the saved flag while the value is unchanged; otherwise recalculate from ref text.
 */
export const resolveCbcDisplayFlag = (opts: {
  value: string;
  savedValue?: string | null;
  savedFlag?: string | null;
  normalRangeText?: string | null;
  unit?: string | null;
  rangeType?: string | null;
  normalFindings?: string | null;
  expectedValue?: string | null;
}): string => {
  const value = (opts.value ?? "").toString();
  if (!value.trim()) return "";
  const saved = String(opts.savedFlag || "").toUpperCase();
  const unchanged = String(opts.savedValue ?? "") === value;
  if (unchanged && saved) return saved;
  const auto = calculateResultFlag({
    value,
    rangeType: opts.rangeType || undefined,
    expectedValue: opts.expectedValue || undefined,
    normalRangeText: opts.normalRangeText || undefined,
    normalFindings: opts.normalFindings || undefined,
    unit: opts.unit,
  });
  return auto || (unchanged ? saved : "");
};

export const normalizeTestResultFlags = <T extends FlagEvaluationInput>(rows: T[]): (T & { flag: AbnormalFlag })[] => {
  return rows.map((row) => ({
    ...row,
    flag: computeAbnormalFlag(row),
  }));
};
