

# Plan: Increase Report Font Sizes and Descriptive Result Spanning

## Changes

### 1. Patient Demographics — `src/components/report/LimsReportHeader.tsx`
- Increase font size from `9px` to `11px`
- Allow patient name to wrap (add `break-words` / `overflow-wrap`) so long names don't overflow

### 2. Department Header — `src/components/report/ReportResultsSection.tsx`
- Department banner: increase from `text-sm` (~14px) to `text-base` (~16px)
- Profile name header: increase from `text-sm` to `text-base`
- Test group sub-header: increase from `text-[10px]`/`text-xs` to `text-sm`

### 3. Table Column Headers (Parameter, Result, Unit, Reference Range)
- Increase from `text-[10px]`/`text-xs` (~12px) to `text-sm` (~14px)
- Apply to both standalone and profile table `<thead>` rows

### 4. Result Row Font Sizes
- Normal tables: keep `text-sm` (already fine after header bump)
- Compact tables: increase from `text-xs` to `text-sm`

### 5. Descriptive Result Spanning (key improvement)
- When a result row has **no unit AND no reference range** (both empty/null), treat it as a descriptive result
- Instead of rendering 3 separate columns (Result | Unit | Ref Range), render the result value with `colSpan={3}` spanning the full right side — same as morphology rows already do
- Detection logic: `!r.unit && !r.normal_range_text && !r.normal_range_low && !r.normal_range_high`
- Apply this in both the standalone (`_individual`) table and the profile table

### Files Modified
- `src/components/report/LimsReportHeader.tsx` — font size + name wrapping
- `src/components/report/ReportResultsSection.tsx` — all header/row font sizes + descriptive spanning

