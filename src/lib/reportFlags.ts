export type AbnormalFlag = "H" | "L" | "N" | "X";

export interface FlagEvaluationInput {
  result_value?: string | number | null;
  normal_range_low?: string | number | null;
  normal_range_high?: string | number | null;
  normal_range_text?: string | null;
  flag?: string | null;
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
 * typists. Returns the operator direction so the flagging logic can
 * treat the value as a saturating bound rather than an exact equality.
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

const NORMAL_CATEGORY_KEYWORDS = [
  "normal", "non-diabetic", "nondiabetic", "non diabetic",
  "sufficient", "sufficiency", "desirable", "optimal",
  "no risk", "norisk", "acceptable", "negative", "reference",
];

/**
 * For advisory-style ranges (e.g. HbA1c, Vitamin D, HDL), try to locate the
 * "normal" category by keyword and extract its numeric bounds.
 */
const findNormalCategoryBounds = (text: string): { low: number | null; high: number | null } | null => {
  const lower = text.toLowerCase();

  for (const keyword of NORMAL_CATEGORY_KEYWORDS) {
    const idx = lower.indexOf(keyword);
    if (idx === -1) continue;

    // Extract a segment around the keyword (generous window)
    const segment = text.substring(Math.max(0, idx - 10), idx + keyword.length + 80);

    // Look for range pattern first (e.g. "30-100")
    const rangeMatch = segment.match(/(-?\d*\.?\d+)\s*(?:to|-|–|—)\s*(-?\d*\.?\d+)/i);
    if (rangeMatch) {
      const lo = Number.parseFloat(rangeMatch[1]);
      const hi = Number.parseFloat(rangeMatch[2]);
      if (Number.isFinite(lo) && Number.isFinite(hi)) return { low: lo, high: hi };
    }

    // Look for <= or < pattern (e.g. "Non-Diabetic: <= 5.6")
    const upperMatch = segment.match(/(?:<=|≤|<)\s*(-?\d*\.?\d+)/);
    if (upperMatch) {
      const hi = Number.parseFloat(upperMatch[1]);
      if (Number.isFinite(hi)) return { low: null, high: hi };
    }

    // Look for >= or > pattern (e.g. "No Risk: > 60")
    const lowerMatch = segment.match(/(?:>=|≥|>)\s*(-?\d*\.?\d+)/);
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

  // Handle advisory ranges (e.g. HbA1c: <=5.6 and >=6.5, Vitamin D: <10 and >100)
  // When < gives high and > gives low, they appear swapped → advisory range detected.
  // Use keyword-based detection to find the "normal" category bounds.
  if (low !== null && high !== null && low > high) {
    const normalBounds = findNormalCategoryBounds(text);
    if (normalBounds && (normalBounds.low !== null || normalBounds.high !== null)) {
      return normalBounds;
    }
    // Last resort: swap (legacy fallback)
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

export const computeAbnormalFlag = (row: FlagEvaluationInput): AbnormalFlag => {
  const existingFlag = String(row.flag ?? "").toUpperCase();
  const value = extractNumber(row.result_value);
  const operator = detectResultOperator(row.result_value);
  if (value === null) {
    const qualitativeFlag = computeQualitativeFlag(row);
    if (qualitativeFlag) return qualitativeFlag;
    return existingFlag === "H" || existingFlag === "L" ? existingFlag : "N";
  }

  const explicitLow = extractNumber(row.normal_range_low);
  const explicitHigh = extractNumber(row.normal_range_high);
  const textBounds = parseBoundsFromText(row.normal_range_text);

  let low = explicitLow ?? textBounds.low;
  let high = explicitHigh ?? textBounds.high;

  // If explicit low/high are swapped (AI extraction error like low=2000, high=1000),
  // prefer text-parsed bounds which are more reliable, then fall back to swap
  if (low !== null && high !== null && low > high) {
    if (textBounds.low !== null && textBounds.high !== null && textBounds.low <= textBounds.high) {
      // Text parsing got it right (e.g. "200-1000" → low=200, high=1000), use those
      low = textBounds.low;
      high = textBounds.high;
    } else {
      // Last resort: swap
      const temp = low;
      low = high;
      high = temp;
    }
  }

  // Operator-prefixed results (">2000", "< 2", "≥ 100") indicate the analyzer
  // saturated its measurable range. Treat as definitively High/Low when the
  // operator places the true value outside the normal range.
  //   >X  → true value ≥ X, possibly higher → flag H if X is at/above high,
  //         or if no high is defined (still abnormal direction).
  //   <X  → true value ≤ X, possibly lower → mirror with low.
  if (operator === "gt") {
    if (high !== null) {
      if (value >= high) return "H";
      // ">X" with X below the high bound is unusual but still indicates the
      // reading saturated upward at the analyzer; flag H to be safe.
      return "H";
    }
    if (low !== null) {
      // No upper bound; only flag H if X is already at/above the lower bound,
      // otherwise the value could still be within an open-ended normal range.
      return value >= low ? "N" : "L";
    }
    return "H";
  }
  if (operator === "lt") {
    if (low !== null) {
      if (value <= low) return "L";
      return "L";
    }
    if (high !== null) {
      return value <= high ? "N" : "H";
    }
    return "L";
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
 * error or typing slip (e.g. "-1.02", "- 1.02", ">-1", "> -2"). The UI uses
 * this to highlight test names and parameter rows in red across the LIMS
 * workflow without blocking save/verify/approve. Pure text results
 * ("Negative", "Absent", etc.) are NOT flagged.
 */
export const isSuspectNegativeResult = (value: string | number | null | undefined): boolean => {
  if (value === null || value === undefined) return false;
  const stripped = String(value).trim().replace(/^(?:>=|≥|>|<=|≤|<)\s*/, "").trim();
  if (!stripped) return false;
  // Must look numeric (optionally signed, with digits and optional decimal),
  // possibly with a space between sign and digits.
  if (!/^-\s*\d*\.?\d+\s*$/.test(stripped.replace(/,/g, ""))) return false;
  const num = Number.parseFloat(stripped.replace(/,/g, "").replace(/-\s+/, "-"));
  return Number.isFinite(num) && num < 0;
};

export const normalizeTestResultFlags = <T extends FlagEvaluationInput>(rows: T[]): (T & { flag: AbnormalFlag })[] => {
  return rows.map((row) => ({
    ...row,
    flag: computeAbnormalFlag(row),
  }));
};
