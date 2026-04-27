# Fix RFT Getting Cut Off in PDF Report

## Problem

In invoice **2604270005** (JAGMOHAN AGARWAL), the **RFT (RENAL FUNCTION TEST)** appears at the bottom of page 3 but only shows **3 of its parameters** (Urea, Creatinine, Calcium) — the remaining parameters (Phosphorous, Uric Acid, Sodium, Potassium, Chloride, etc.) are silently lost. They never appear on page 4 (which jumps to DIABETOLOGY → HBA1C).

## Root Cause

The pagination logic in `src/pages/LimsReportView.tsx` (lines 360–500) decides whether a test fits on the current page using an **estimate** of the test's rendered height (`estimatedHeightMm`). The estimate is much lower than the real rendered height for several reasons:

1. **Profile/blue header bar is not budgeted** — the bar `LIPID PROFILE (Sample: SERUM)`, `RFT (RENAL FUNCTION TEST) (Sample: SERUM)`, etc. is ~7 mm but the formula only adds `TEST_HEADER_MM = 8 mm` which it also has to share with internal spacers (`1mm` + `2mm` between profiles).
2. **Multi-line reference ranges undercounted** — rows like HDL Cholesterol (`No Risk: > 60mg/dL / Moderate Risk: 40 - 60 mg/dL / High Risk: < 40 mg/dL`) take 3 line-heights but are budgeted as a single `ROW_HEIGHT_MM = 5.5 mm` row.
3. **Profile-level `test_note` and `outsourced_caption` ignored** — these render as additional rows below the table but are never added to `heightMm`.
4. **Instrument / Method line undercounted** — long instrument strings wrap to 2–3 lines, but only one `META_LINE_MM = 5 mm` is added.
5. **No safety margin** — the threshold check is `usedHeight + block.estimatedHeightMm > usableHeight`. Any underestimate of even 1 mm causes content to spill past the page.
6. **Silent clipping** — the page DOM is rendered with `maxHeight: 297mm` + `overflow-hidden` (line 846, 851). When the estimate is wrong, overflowing rows are **clipped, not pushed to the next page** — which is exactly what's happening to RFT's missing parameters.

## Fix

### 1. Make the per-test height estimate conservative and complete

In `src/pages/LimsReportView.tsx` (the `useMemo` block around lines 360–450), rebuild `heightMm` so it accounts for every visual element a profile renders:

```text
heightMm = PROFILE_HEADER_MM             // blue "LIPID PROFILE (Sample: SERUM)" bar
         + INSTRUMENT_LINE_MM            // wrapped Instrument/Method line (allow 2 lines)
         + TABLE_HEADER_MM               // "Parameter | Result | Reference Range | Flag"
         + sum(rowHeight(param))         // see #2 below
         + subheaderCount * SUBHEADER_MM
         + (test_note ? TEST_NOTE_MM : 0)
         + (outsourced_caption ? OUTSOURCED_MM : 0)
         + (interpretation ? INTERPRETATION_MM_dynamic : 0)
         + INTER_PROFILE_GAP_MM          // 2mm + 1mm spacers between profiles
         + SAFETY_PAD_MM                 // 4mm cushion to absorb minor wrap differences
```

Concrete constants (mm):

```text
PROFILE_HEADER_MM      = 9
INSTRUMENT_LINE_MM     = 7   // covers up to 2 wrapped lines
TABLE_HEADER_MM        = 7
ROW_HEIGHT_MM          = 6   // raised from 5.5
SUBHEADER_MM           = 6
TEST_NOTE_MM           = 6
OUTSOURCED_MM          = 6
INTER_PROFILE_GAP_MM   = 4
SAFETY_PAD_MM          = 5
```

### 2. Per-row height that accounts for wrapped reference ranges

Compute each row's height from the reference-range text length, since long ranges (e.g. `No Risk: > 60mg/dL\nModerate Risk: 40 - 60 mg/dL\nHigh Risk: < 40 mg/dL`) wrap into multiple lines:

```ts
function rowHeightMm(p: TestResultEntry): number {
  const refText = (p.reference_range || '').trim();
  // ~38 chars per line in the Reference Range column at 13px
  const refLines = Math.max(
    1,
    Math.ceil(refText.length / 38),
    refText.split(/\r?\n/).length,
  );
  const remarkLines = p.note ? 1 : 0;
  const descLines   = (p as any).parameter_description ? 1 : 0;
  return Math.max(6, refLines * 5 + remarkLines * 5 + descLines * 4);
}
```

### 3. Dynamic interpretation height

Replace the flat `INTERPRETATION_MM = 10` with a length-based estimate:

```ts
function interpretationMm(html: string | null): number {
  if (!html) return 0;
  const text = html.replace(/<[^>]*>/g, '').trim();
  if (!text) return 0;
  const lines = Math.max(text.split(/\r?\n/).length, Math.ceil(text.length / 95));
  return 6 /* "Interpretation:" label */ + lines * 4 + 2 /* padding */;
}
```

### 4. Tighten the page-fit decision and force-flush oversized tests

In the per-block loop (around line 467):

```ts
const FIT_TOLERANCE_MM = 2; // never let an estimate spill onto signature

const fits = (used: number, h: number) => used + h <= (usableHeight - FIT_TOLERANCE_MM);

blocks.forEach(block => {
  if (block.dedicatedPage) { /* unchanged */ return; }

  // If the block alone is taller than a full page, keep current behavior
  // (still place it on a fresh page; downstream `fit_to_page` AutoScale will shrink it).
  if (currentPageBlocks.length > 0 && !fits(usedHeight, block.estimatedHeightMm)) {
    allPages.push({ type: "structured", departmentName: deptName, testBlocks: currentPageBlocks, approvers: collectApprovers(currentPageBlocks) });
    currentPageBlocks = [];
    usedHeight = DEPT_HEADER_MM;
  }
  currentPageBlocks.push(block);
  usedHeight += block.estimatedHeightMm;
});
```

This guarantees: **if a whole test's parameters cannot fit in the remaining space below the current content (and above the signature block), the entire test is moved to the next page** — exactly per the user's requirement.

### 5. Stop silent clipping (defense in depth)

Currently the page wrapper uses `overflow-hidden` + `maxHeight: 297mm`, so any pagination miss = lost content. Change the structured-content area only (not the snip-image area, which legitimately needs clipping) so overflow is **visible during preview** so any future regression is obvious instead of silently dropping rows:

In `src/pages/LimsReportView.tsx` around line 888:

```tsx
<div className="flex-1 overflow-visible">
  {/* structured content */}
</div>
```

The outer `data-page` wrapper keeps `overflow-hidden` for the actual print/PDF capture (so signature stays anchored), but with the conservative budget from steps 1–4 we will never reach overflow in practice.

## Files to Edit

- `src/pages/LimsReportView.tsx`
  - Constants block at top (lines 21–33): add new constants (`PROFILE_HEADER_MM`, `INSTRUMENT_LINE_MM`, `SUBHEADER_MM`, `TEST_NOTE_MM`, `OUTSOURCED_MM`, `INTER_PROFILE_GAP_MM`, `SAFETY_PAD_MM`, `FIT_TOLERANCE_MM`); raise `ROW_HEIGHT_MM` from 5.5 → 6.
  - Add helper functions `rowHeightMm()` and `interpretationMm()` near the top of the `useMemo` (around line 360).
  - Replace `heightMm` calculation (lines 412–418) with the new conservative formula.
  - Replace fit check (line 479) to use the `fits()` helper with `FIT_TOLERANCE_MM`.
  - Change `overflow-hidden` → `overflow-visible` on the inner structured-content `flex-1` (line 888).

No DB migration, no schema change, no new files.

## Verification

After the change, regenerate the report for invoice **2604270005**:

- Page 3 should end after **LIPID PROFILE** + interpretation (or earlier if needed).
- **RFT (RENAL FUNCTION TEST)** should start fresh on page 4 with **all parameters** (Urea, Creatinine, Calcium, Phosphorous, Uric Acid, Sodium, Potassium, Chloride, etc.) fully visible.
- **DIABETOLOGY → HBA1C** moves to page 5.
- Signature block stays anchored at bottom of every page; nothing is cut.
- Re-check 2–3 other large reports (any with CBC + Lipid + RFT or LFT) to confirm no regressions in pagination.
