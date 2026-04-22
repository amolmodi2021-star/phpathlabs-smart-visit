

# Add a "Parameter Description" sub-line under parameter names in reports

## What you'll get

In Test Management → Parameters, each parameter gets a new optional **Description** field. When a value is entered, the report renders that description as a small italic line **directly under the parameter name** (smaller font, muted color, left-aligned in the Parameter column). Empty descriptions render nothing — existing reports stay unchanged.

Example:

```
Triglycerides                    140    < 150 mg/dL
   Used to assess cardiovascular risk.
HDL Cholesterol                   45    > 40 mg/dL
LDL Cholesterol                  110    < 100 mg/dL
   Calculated using Friedewald formula.
```

## Changes

### 1. Database — add column
- `report_test_parameters.parameter_description` (text, nullable). One additive migration.

### 2. Test Management → Parameters dialog (`src/pages/ReportParameters.tsx`)
- Add `parameter_description` to the form state, the save payload, the edit handler, and the reset handler.
- Add a `Textarea` input under the "Parameter Name" field labelled **"Description (shown below parameter name on report)"** with helper text "Keep it short — one short line.".
- Include the column in Excel import/export rows.

### 3. Carry the field through the read paths
Three queries that hydrate parameters need the new column added to their `select(...)`:
- `src/lib/tests.ts` → `getTestParameters` (also propagate to the returned object).
- `src/components/lims/ResultsEntry.tsx` → params query at line 226.
- `src/components/lims/ModifiedApproval.tsx` → identical query at line 81.

Then thread `parameter_description` into the result rows produced for the report:
- `ResultsEntry.tsx` writes `lims_test_results` rows. Add `parameter_description: p.parameterDescription` (or pull it from the param def) when persisting, OR — to avoid storing redundant data — read it live from the param map at render time. **Recommended:** read at render time so edits to the description propagate to old results without rewriting history.

### 4. Render the description in the report
- `src/components/report/ReportResultsSection.tsx` — extend `TestResult` with optional `parameter_description?: string`. In `ParamRow`, after `{r.parameter_name}` render:
  ```tsx
  {r.parameter_description && (
    <div className="italic text-gray-500 leading-tight" style={{ fontSize: '0.75em', marginTop: '1px' }}>
      {r.parameter_description}
    </div>
  )}
  ```
  Same `<td>`, just a second line.
- `src/pages/LimsReportView.tsx` — in `transformBlocksToGrouped` / `mapParamToTestResult`, look up the parameter description from `testParamsMap[testId]` (already loaded) by `parameter_id` and attach it to the `TestResult`. Skip for single-parameter tests where the parameter row is overridden by the test name.

### 5. Approved reports archive
- `approved_reports.test_results` (JSONB snapshot at approval time) does **not** carry the description today. Two options:
  - **A. Live lookup at view time** — re-read description from `report_test_parameters` when rendering an approved report. Pros: edits propagate; no archive change. Cons: one extra small read.
  - **B. Snapshot at approval** — write `parameter_description` into the JSONB at approval. Pros: fully immutable. Cons: edits to description don't reflect on past reports.

Going with **A (live lookup)** — descriptions are explanatory text, not clinical data, so propagating fixes is desirable and it keeps the immutability rule (`mem://logic/lims/report-immutability-archive`) intact for actual results.

## Files changing

| File | Change |
|---|---|
| `supabase/migrations/<new>` | `ALTER TABLE report_test_parameters ADD COLUMN parameter_description text` |
| `src/pages/ReportParameters.tsx` | Form field, save/edit/reset, Excel import/export |
| `src/lib/tests.ts` | Add column to `getTestParameters` select + return shape |
| `src/components/lims/ResultsEntry.tsx` | Add column to params query select |
| `src/components/lims/ModifiedApproval.tsx` | Add column to params query select |
| `src/pages/LimsReportView.tsx` | Look up description from param map; attach to `TestResult`; skip for single-parameter override |
| `src/components/report/ReportResultsSection.tsx` | Extend `TestResult` type; render small italic line under parameter name |

## What stays untouched

- Abnormal summary table, trend charts, PDF pagination engine, all other report sections.
- Existing parameters: description is `null` by default → renders nothing → zero visual change to existing reports.
- Schema for `lims_test_results`, `approved_reports`, `parameter_normal_ranges`.
- Sample collection, billing, dispatch, doctor approval flows.

## Verification

1. Test Management → Parameters → edit any parameter → fill **Description** = "Used to assess cardiovascular risk." → Save.
2. Open an approved report containing that parameter → the line appears in italic small grey text directly under the parameter name.
3. Clear the description → reload report → line disappears.
4. Parameters without a description render exactly as today.
5. Excel export contains a "Description" column; re-importing preserves the value.

## Risk

Low. Additive column, optional UI field, presentational-only render change. No impact on result calculation, status flow, PDF pagination, or archived data.

