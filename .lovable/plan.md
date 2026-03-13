

## Problem Analysis

The core issue is a **mismatch between the estimated height used for chunking abnormal rows and the actual rendered height**. The estimation constants (`ABNORMAL_ROW_MM`, `ABNORMAL_SUMMARY_BASE_MM`, etc.) are guesses that don't match reality, causing either:
1. Too many rows crammed into one page (overflow, ignoring bottom margin)
2. Too few rows (wasted space)

Additionally, the current approach of estimating row heights based on character counts is fragile. The real problem is that the **chunking algorithm needs to be more conservative and empirically calibrated**.

## Root Cause

Looking at the code flow:
1. `abnormalUsableHeight` = 297 - topMargin - bottomMargin - 32 (header) - 10 (page num reserve) - 4 (safety) = ~**219mm** (with 2.5cm top, 1.5cm bottom)
2. `abnormalBodyMaxHeight` = 219 - 17 (base) - 2 (chunk safety) = ~**200mm**
3. With `ABNORMAL_ROW_MM = 6.2`, that allows ~32 rows per page

But the actual rendered abnormal summary table rows are likely **smaller** than 6.2mm, meaning the estimation thinks fewer rows fit than actually do — OR the page container (`overflow: hidden` at 297mm) clips content that the estimation said would fit.

The real fix: **measure the actual rendered height rather than guessing**, or use much more accurate constants. Since we can't measure at estimation time, we need to calibrate the constants properly.

## Plan

### 1. Fix the abnormal summary chunking to use realistic row heights

- Set `ABNORMAL_ROW_MM = 5.0` (actual table rows with `text-sm` and `py-0.5` are ~4-5mm)
- Set `ABNORMAL_SUMMARY_BASE_MM = 14` (heading + table header + border/padding)  
- Remove `ABNORMAL_CHUNK_SAFETY_MM` and `SAFETY_BUFFER_MM` from abnormal calculation — instead use a single `3mm` buffer
- Reduce `ABNORMAL_EXTRA_LINE_MM` to `3.5` for wrapped text lines

### 2. Fix the `abnormalUsableHeight` calculation to exactly match the page container

The page container is `297mm` with `paddingTop: topMarginMm` and `paddingBottom: bottomMarginMm`. The content area inside has `paddingBottom: contentBottomReserveMm` which for abnormal pages = `PAGE_NUM_HEIGHT_MM + 2 = 10mm`.

So actual usable content height = `297 - topMarginMm - bottomMarginMm - HEADER_HEIGHT_MM - (PAGE_NUM_HEIGHT_MM + 2)`.

The current code adds an extra `SAFETY_BUFFER_MM` on top of this, which wastes space. Remove it for abnormal pages.

### 3. Ensure the section content div doesn't have extra spacing eating into the usable area

The content div uses `space-y-1` (4px gaps) and `paddingBottom: contentBottomReserveMm`. Verify these are accounted for in the height budget.

### 4. Summary of constant changes in `ViewReport.tsx`

```
ABNORMAL_SUMMARY_BASE_MM: 17 → 14
ABNORMAL_ROW_MM: 6.2 → 5.0  
ABNORMAL_EXTRA_LINE_MM: 5 → 3.5
ABNORMAL_PARAM_CHARS_PER_LINE: 32 → 28
ABNORMAL_RANGE_CHARS_PER_LINE: 20 → 18
Remove ABNORMAL_CHUNK_SAFETY_MM constant
```

### 5. Update `abnormalUsableHeight` formula

```typescript
const abnormalContentReserve = PAGE_NUM_HEIGHT_MM + 2;
const abnormalUsableHeight = PAGE_HEIGHT_MM - topMarginMm - bottomMarginMm - HEADER_HEIGHT_MM - abnormalContentReserve;
const abnormalBodyMaxHeight = Math.max(20, abnormalUsableHeight - ABNORMAL_SUMMARY_BASE_MM);
```

No extra safety buffer — the `contentBottomReserveMm` in the render already handles the page number spacing.

### 6. No changes needed to pagination logic

The `paginateSections` function correctly isolates abnormal pages (`isAbnormalOnly`) and pushes remaining sections (any profile, not just CBC) to subsequent pages. The issue is purely that the estimated chunk sizes are wrong, causing all abnormals to fit in one chunk when they shouldn't.

