

# Plan: Test Selection Dialog Before Report Generation

## What Changes

When the user clicks "View Report" in the Dispatch section, instead of navigating directly to the report page, a dialog will appear listing all approved tests for that registration with checkboxes. The user can select/deselect individual tests or use "Select All." Clicking "Generate Report" navigates to the report page with only the selected tests.

## Implementation

### 1. Add Test Selection Dialog to `src/components/lims/Dispatch.tsx`

- Add state for: dialog open, selected registration entry, selected test IDs (Set)
- When "View Report" is clicked, open the dialog instead of navigating
- Dialog shows:
  - "Select All" checkbox at the top
  - Each approved test with a checkbox (test name as label)
  - All selected by default
  - "Generate Report" button that navigates to `/lims/report/{regId}?tests=id1,id2,id3`
- Only show tests that are approved (status === "approved" or "dispatched")

### 2. Update `src/pages/LimsReportView.tsx` to Filter by Selected Tests

- Read `tests` query parameter from URL (comma-separated test IDs)
- If present, filter the `approved_reports` test_results array to only include results matching those test IDs
- Also filter `outsourced_test_snips` to only matching test IDs
- If no `tests` param, show all tests (backward compatible)

### Technical Details

- The `DispatchEntry.tests` array already has `testId` and `testName` per test with status — perfect for populating checkboxes
- URL query params (`?tests=...`) keep the approach stateless and shareable
- No database changes needed

