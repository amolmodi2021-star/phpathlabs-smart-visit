# Fix BUN / CREATININE RATIO Result Misalignment

## Problem

In the RFT (RENAL FUNCTION TEST) section, the result `11.48` for **BUN / CREATININE RATIO** appears left-aligned and shifted slightly right of the "Result" column header, while every row above it (Urea, Creatinine, Calcium, Phosphorus, Uric Acid, Blood Urea Nitrogen) is properly centered under the "Result" column.

## Root Cause

In `src/components/report/ReportResultsSection.tsx`, the helper `isDescriptiveResult()` (lines 85–88) returns `true` for any row that has **no unit, no reference range, and no flag** — regardless of whether the value itself is numeric or text:

```ts
const isDescriptiveResult = (r) =>
  !r.unit && !r.normal_range_text && !r.normal_range_low && !r.normal_range_high
  && (!r.flag || r.flag === "N" || r.flag === "Normal");
```

`BUN / CREATININE RATIO` is a calculated ratio with no unit and no reference range, so it falls into this branch. The renderer then draws the row using a wide `colSpan={3}` cell with `text-left px-2` (line 138–141) — meant for descriptive text like "Yellow", "Clear", "Negative", or morphology notes — instead of using the centered numeric path.

Result: `11.48` renders as left-aligned text spanning Result + Reference Range + Flag columns, looking misaligned.

## Fix

Treat a result as "descriptive" **only** when the value is non-numeric. Pure numeric values (including decimals, negatives, and `<10` / `>100` style limits) should always render through the normal numeric path so they sit centered under the Result column.

### Edit `src/components/report/ReportResultsSection.tsx`

Add a `isNumericResult()` helper and short-circuit `isDescriptiveResult()` when the value is numeric:

```ts
const isNumericResult = (value?: string): boolean => {
  if (!value) return false;
  const v = String(value).trim();
  if (!v) return false;
  // "11.48", "0.84", "-0.5", "<10", ">100", "1.2e3"
  return /^[<>]?\s*-?\d+(\.\d+)?(e[+-]?\d+)?\s*$/i.test(v);
};

const isDescriptiveResult = (r: TestResult): boolean => {
  if (isNumericResult(r.result_value)) return false;
  return !r.unit && !r.normal_range_text && !r.normal_range_low && !r.normal_range_high
    && (!r.flag || r.flag === "N" || r.flag === "Normal");
};
```

Nothing else changes. Morphology rows (`isMorph`) still use the descriptive path because they're forced via `isDescriptiveResult(r) || isMorph` on line 112.

## Files Edited

- `src/components/report/ReportResultsSection.tsx` (lines 85–88 only)

## Verification

After the change, in the same RFT block:
- BUN / CREATININE RATIO → `11.48` renders centered under the Result column, aligned with Urea (20.62), Creatinine (0.84), etc.
- The Reference Range and Flag columns for that row stay empty (no false text).
- Truly descriptive results (Urine "Color: Yellow", "Appearance: Clear", peripheral smear morphology notes) keep their wide, left-aligned descriptive layout — unchanged.
