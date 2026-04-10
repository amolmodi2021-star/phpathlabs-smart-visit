

# Plan: Increase Report Font Sizes and Fix Descriptive Result Spanning

## Problem
1. Font sizes across the report (demographics, department headers, table headers, result rows) are too small to read on mobile
2. Descriptive results (no unit/ref range) are still constrained to the narrow "Result" column due to the `colgroup` fixed widths — the `colSpan={3}` spans 3 narrow columns but `tableLayout: fixed` keeps them small

## Changes

### 1. `src/components/report/LimsReportHeader.tsx`
- Increase demographics font from `11px` to `13px`

### 2. `src/components/report/ReportResultsSection.tsx`

**Font size increases:**
- Department banner: `text-base` (16px) → `text-lg` (18px)
- Profile name header: `text-base` → `text-lg`
- Table column headers (Parameter/Result/Unit/Ref Range): `text-sm` (14px) → `text-base` (16px)
- Result row text: add explicit `text-base` to all `<td>` cells
- Test group sub-headers: `text-sm` → `text-base`
- Flag badge: `text-[10px]` → `text-xs` (12px), increase badge size
- Interpretation text: `text-[9px]` → `text-xs`
- Meta/remark text: `text-[10px]` → `text-xs`

**Fix descriptive result spanning:**
- Remove `tableLayout: 'fixed'` from both tables — this is what prevents `colSpan` from utilizing the full width
- Remove the `<colgroup>` entirely — let the browser auto-size columns
- Instead, apply `width` styles directly on `<th>` headers so normal rows get proper widths, but `colSpan={3}` rows can naturally expand to fill the remaining space

### Files Modified
- `src/components/report/LimsReportHeader.tsx`
- `src/components/report/ReportResultsSection.tsx`

