

## Plan: Duplicate Report Merging by Registration Number

### What happens today
Every upload creates a brand-new `uploaded_reports` row, `extracted_report_data` row, and `raw_report_data` row -- even if a report with the same `reg_no` already exists. This leads to duplicate entries in the dashboard.

### What will change

When a PDF is uploaded and extraction completes, **before saving**, the system checks if an `uploaded_reports` record with the same `reg_no` already exists.

**If a match is found:**
1. Reuse the existing `uploaded_reports` row (update it, don't create a new one)
2. Load existing `extracted_report_data.test_results` for that report
3. Merge old + new test results using a composite key of `parameter_name + profile_name`:
   - **2 new parameters** (not in old data) → added to the list
   - **3 updated parameters** (same key, different result/range) → old values replaced with new
   - **10 unchanged parameters** (same key, same data) → kept as-is, no duplicates
4. Save the merged result set back to `extracted_report_data`
5. Update `raw_report_data` with latest raw JSON
6. Delete any previously `generated_reports` (since data changed)
7. Reset status to "Awaiting Review"
8. Delete the temporarily-created `uploaded_reports` row (the one made before extraction)

**If no match:** proceed with current flow (no change).

### Merge logic (pseudocode)

```text
composite_key = lowercase(parameter_name) + "::" + lowercase(profile_name)

Start with: mergedMap = Map of existing results keyed by composite_key
For each new result:
  mergedMap.set(composite_key, newResult)   // overwrites old if exists, adds if new
Final = Array.from(mergedMap.values())
```

This ensures: new params are added, changed params get latest values, unchanged params stay (no duplicates).

### Files modified
1. **`src/pages/UploadReport.tsx`** -- add duplicate check after extraction, merge logic, and conditional insert-vs-update flow

### Dashboard status additions
Also in this change:
- Add `"Dispatched"` status color to `ReportsDashboard.tsx` (purple badge) for reports where `mobile_number` is present
- In `ViewReport.tsx`, set status to `"Dispatched"` when mobile number is saved

### Files modified for status
2. **`src/pages/ReportsDashboard.tsx`** -- "Dispatched" status color + treat like "Completed" for actions
3. **`src/pages/ViewReport.tsx`** -- update status to "Dispatched" on mobile save

