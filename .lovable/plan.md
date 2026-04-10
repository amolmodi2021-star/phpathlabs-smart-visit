

# Plan: Add "Fit to Page" and "Dedicated Page" Toggles

## Recommendation on Fit-to-Page Approach

**Plan A (AutoScaleContent) is more reliable.** The existing page layout already uses flexbox with `flex-1 overflow-hidden` for content and `mt-auto` for the signature block — they cannot overlap by design. The `AutoScaleContent` component already exists in the codebase and handles CSS `transform: scale()` to shrink content. We just need to calculate the correct available height per page (subtracting top margin, demographics header, signature block, bottom margin) and wrap the test content. This is cleaner than embedding signatures into bottom margins, which would complicate layout settings and break the current signature rendering.

## Changes

### 1. Database Migration — add two columns to `tests` table
```sql
ALTER TABLE tests ADD COLUMN fit_to_page boolean NOT NULL DEFAULT false;
ALTER TABLE tests ADD COLUMN dedicated_page boolean NOT NULL DEFAULT false;
```

### 2. `src/pages/TestManagement.tsx` — add toggles to test form
- Add `fit_to_page: false, dedicated_page: false` to `defaultForm`
- Add two Switch toggles next to existing "Bold in Report" / "Show Display Name" toggles
- Map values in save and edit flows

### 3. `src/pages/LimsReportView.tsx` — pagination logic changes

**Fetch:** Add `fit_to_page, dedicated_page` to the tests select query (line 136).

**Dedicated Page:** In the pagination loop (line 317-335), if a test block has `dedicated_page: true`, flush the current page first, then put this test alone on its own page under its department header.

**Fit to Page:** For test blocks with `fit_to_page: true`, add a flag to the `TestBlock` interface. When rendering, wrap the content in `AutoScaleContent` with `maxHeightMm` calculated as:
```
availableHeight = PAGE_HEIGHT_MM - topMm - bottomMm - HEADER_HEIGHT_MM - SIGNATURE_HEIGHT_MM - PAGE_NUM_HEIGHT_MM
```
This ensures the test content scales down to fit without overflowing into the signature area.

### 4. `src/components/report/ReportResultsSection.tsx` — no changes needed
The scaling happens at the page level via `AutoScaleContent` wrapping the `ReportResultsSection` output.

### Files Modified
- **Migration:** Add `fit_to_page` and `dedicated_page` columns to `tests`
- **`src/pages/TestManagement.tsx`** — form fields + toggles
- **`src/pages/LimsReportView.tsx`** — fetch columns, pagination logic, AutoScaleContent wrapping
- **`src/lib/tests.ts`** — add fields to `TestItem` interface

