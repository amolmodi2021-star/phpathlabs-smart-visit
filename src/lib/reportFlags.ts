export type AbnormalFlag = "H" | "L" | "N";

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

  // Handle advisory ranges like Vitamin D (Deficiency: <10, Sufficiency: 30-100, Toxicity: >100):
  // When < gives high and > gives low, they appear swapped. Swap them to get correct normal bounds.
  if (low !== null && high !== null && low > high) {
    const temp = low;
    low = high;
    high = temp;
  }

  return { low, high };
};

export const computeAbnormalFlag = (row: FlagEvaluationInput): AbnormalFlag => {
  const value = extractNumber(row.result_value);
  if (value === null) {
    return row.flag === "H" || row.flag === "L" ? row.flag : "N";
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

  if (high !== null && value > high) return "H";
  if (low !== null && value < low) return "L";
  return "N";
};

export const normalizeTestResultFlags = <T extends FlagEvaluationInput>(rows: T[]): (T & { flag: AbnormalFlag })[] => {
  return rows.map((row) => ({
    ...row,
    flag: computeAbnormalFlag(row),
  }));
};
