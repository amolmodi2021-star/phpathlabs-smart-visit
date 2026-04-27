# Make Page Height Estimation Account for Every Visual Element

## Why

The previous estimator missed several elements that the renderer actually draws inside each parameter row, plus a couple of profile-level elements. This still allows tests like RFT to spill into the signature band and get clipped. Most notably:

- **Italic description under the parameter name** (`parameter_description`) — never reaches the estimator because it lives on `report_test_parameters`, not on the result row, so `p.parameter_description` was always `undefined`.
- **Wrapped result_value** — long descriptive results (e.g. morphology / "URINE EXAMINATION" notes / multi-line text) wrap into many lines but were budgeted as one row.
- **Wrapped remark/note row** — `r.note` renders as a full-width row that can wrap.
- **Standalone-profile per-parameter meta rows** — `(Sample: ...)`, `Instrument: ... | Method: ...`, per-parameter `Interpretation:`, per-parameter outsourced caption, and the `border-t-2` divider with 3 mm margin between standalone parameters.
- **Profile sample-type chip** — adds height to the profile header on wrap.

## What Will Change

Edit only `src/pages/LimsReportView.tsx`. No DB / schema / other file changes.

### 1. Description-aware row height

Replace `rowHeightMm(p)` with `rowHeightMm(p, descriptionText)`:

```ts
const rowHeightMm = (p: any, descriptionText?: string | null): number => {
  const refText    = String(p?.reference_range ?? "").trim();
  const resultText = String(p?.result_value    ?? "").trim();
  const description = String(descriptionText ?? "").trim();
  const note       = String(p?.note ?? "").trim();

  // Reference Range col ~30% width => ~38 chars/line at 13px
  const refLines = Math.max(
    1,
    Math.ceil((refText.length || 1) / 38),
    refText ? refText.split(/\r?\n/).length : 1,
  );
  // Result col ~20% width (~22 chars) — but descriptive results span ~50% (~62 chars)
  const isDescriptive = !p?.unit && !refText;
  const resultPerLine = isDescriptive ? 62 : 22;
  const resultLines = resultText
    ? Math.max(Math.ceil(resultText.length / resultPerLine),
               resultText.split(/\r?\n/).length)
    : 1;
  // Italic description under parameter name (~75% font, ~3.5mm/line, ~52 chars/line)
  const descLines = description
    ? Math.max(1, Math.ceil(description.length / 52),
                  description.split(/\r?\n/).length)
    : 0;
  // Remark/note row: full-width, ~110 chars/line
  const noteLines = note ? Math.max(1, Math.ceil(note.length / 110)) : 0;

  const baseMm = Math.max(refLines, resultLines) * 5;
  const descMm = descLines * 3.5;
  const noteMm = noteLines * 5;
  const padMm  = noteLines > 0 ? 1.5 : 0;
  return Math.max(ROW_HEIGHT_MM, baseMm + descMm + noteMm + padMm);
};
```

### 2. Feed descriptions into the estimator

When building each test block (the loop near line ~444), look up the description for each parameter from `testParamsMap[testId]`:

```ts
const descByParamId: Record<string, string | null> = {};
(testParamsMap[testId] || []).forEach((tp: any) => {
  if (tp.parameter_id) descByParamId[tp.parameter_id] = tp.parameter_description ?? null;
});

const paramRowsHeight = sortedParams.reduce(
  (sum, p) => sum + rowHeightMm(p, descByParamId[p.parameter_id]),
  0,
);
```

### 3. Standalone-profile per-parameter meta budget

For tests rendered as "_individual" / standalone (`isSingleParameter` or no profile grouping), each parameter can carry its own `(Sample:)`, `Instrument | Method`, `Interpretation:` and outsourced caption rows, plus a `border-t-2` divider with ~3 mm gap between params. Add a per-block adjustment:

```ts
const STANDALONE_DIVIDER_MM = 3;
const STANDALONE_META_LINE_MM = 5;
const standaloneAdjMm = block.isSingleParameter
  ? Math.max(0, sortedParams.length - 1) * STANDALONE_DIVIDER_MM
  : 0;
heightMm += standaloneAdjMm;
// For standalone tests, the profile-level Instrument/Method/Sample lines aren't shown
// (they're shown per-parameter), so we already have INSTRUMENT_LINE_MM budgeted; that's fine.
```

### 4. Profile sample-type chip wrap

The `(Sample: ...)` chip lives inline on the profile header. Long sample-type strings can wrap. Add 3 mm to `PROFILE_HEADER_MM` when `testInfo?.sample_type` is set and is long:

```ts
const sampleHeaderExtraMm = (testInfo?.sample_type && testInfo.sample_type.length > 18) ? 3 : 0;
```

Add `sampleHeaderExtraMm` into the `heightMm` sum.

### 5. Slightly bump safety pad

Raise `SAFETY_PAD_MM` from **5 → 6** to absorb sub-millimetre rounding across many rows (a 12-row test accumulates up to ~3 mm of rounding).

## Files Edited

- `src/pages/LimsReportView.tsx`
  - Replace `rowHeightMm` (lines ~44–56) with the description+result+note-aware version.
  - Inside the `useMemo` that builds `testBlocks` (around lines ~440–463), build `descByParamId`, pass it into `rowHeightMm`, add standalone-divider and sample-chip adjustments, and bump `SAFETY_PAD_MM` constant.

No render-time changes needed — `parameter_description` already reaches the renderer through `transformBlocksToGrouped`.

## Verification

Re-render reports that previously caused issues:
- Invoice **2604270005** (JAGMOHAN AGARWAL): RFT must remain fully on its own page.
- Any report whose tests carry `parameter_description` (italic line under the parameter name) — those tests must now reserve enough height and never overlap the signature.
- Reports with long descriptive results (Urine, morphology, peripheral smear) — must paginate without clipping.
