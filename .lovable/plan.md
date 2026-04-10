

# Plan: Consolidate to Single Report Rendering Format

## Current Situation

There are **two separate report renderers** with duplicated logic:

1. **`src/pages/ViewReport.tsx`** — uses `ReportResultsSection` component (for uploaded reports)
2. **`src/pages/LimsReportView.tsx`** — has its own inline table rendering with `renderParamRow()` / `renderParamsWithSubheaders()` (for LIMS approved reports)

Both render the same kind of data (parameters, results, units, reference ranges, flags) but with different code, different font sizes, and different layout logic. Any fix (like the font size or descriptive spanning) must be applied twice.

## Approach

**Refactor `LimsReportView.tsx` to use `ReportResultsSection`** instead of its own inline rendering.

### Steps

1. **Extend `ReportResultsSection` to support all LIMS features**
   - Add support for **subheaders** (already present in LIMS via `test_parameters` ordering)
   - Add support for the **Flag column** display (HIGH/LOW text — currently LIMS shows this but the component only shows H/L badges)
   - Ensure font sizes are consistent and large enough (apply the 13-15px sizing uniformly)
   - Ensure descriptive result spanning works correctly with `colSpan`

2. **Transform LIMS data into `ReportResultsSection` format**
   - In `LimsReportView.tsx`, convert the `TestBlock[]` data into the `grouped: Record<string, Record<string, TestResult[]>>` format that `ReportResultsSection` expects
   - Map `departmentName` → department key, `testName` → profile key, `params` → TestResult array
   - Pass subheader info and metadata through the existing `profileMetaMap` prop

3. **Replace inline rendering in `LimsReportView.tsx`**
   - Remove `renderParamRow()` and `renderParamsWithSubheaders()` functions
   - Replace the inline `<table>` block in each test block with `<ReportResultsSection>`
   - Keep the page layout, pagination, letterhead, snip pages, and PDF export logic unchanged

4. **Update pagination height estimates**
   - Adjust `ROW_HEIGHT_MM` and other constants to match the actual rendered heights from `ReportResultsSection`

### Files Modified
- `src/components/report/ReportResultsSection.tsx` — add subheader support, unify font sizes
- `src/pages/LimsReportView.tsx` — remove inline rendering, use `ReportResultsSection` with data transformation

### What Stays Unchanged
- `ViewReport.tsx` — already uses `ReportResultsSection`, no changes needed
- Page layout, letterhead, signatures, PDF export, snip pages — all stay in `LimsReportView.tsx`
- Database schema — no changes

### Benefit
One rendering component for all reports. Future font/layout changes apply everywhere automatically.

