

# Add Clinical Notes for Parameters/Tests/Profiles

## Overview
Add a "Note" capability at parameter, test, and profile levels across Results Entry, Result Verification, and Doctor Approval. Notes flow through the pipeline and appear in the final generated report. Parameter-level notes take priority over test/profile-level notes.

## Database Change

**Migration:** Add `note` column to `patient_results` table:
```sql
ALTER TABLE patient_results ADD COLUMN note text;
```

No new table needed — the note travels with each parameter result row. For test-level notes, all parameters of that test get the same note. For profile-level, same logic. Priority is resolved at report render time.

## Changes

### 1. Results Entry (`src/components/lims/ResultsEntry.tsx`)

- Add state: `editedNotes: Record<string, string>` (keyed by `regId||parameterId`)
- Add state: `testNotes: Record<string, string>` (keyed by `regId||testId`) for test-level notes
- Add "Add Note" button (small icon) next to each parameter row. Clicking it populates a text input with default "Kindly correlate clinically". Users can edit.
- Add "Add Note" button at test header level (next to Save & Verify button).
- When saving (auto-save and Save & Verify), include `note` field in the upsert to `patient_results`. For test-level notes, apply the note to all parameters of that test unless a parameter already has its own note.

### 2. Result Verification (`src/components/lims/ResultVerification.tsx`)

- Read `note` from `patient_results` query results and display in the parameter table.
- Add same "Add Note" / edit capability at parameter and test levels.
- On verify, preserve/update the `note` field in the upsert.

### 3. Doctor Approval (`src/components/lims/DoctorApproval.tsx`)

- Read and display notes from verified results.
- Allow editing notes before approval.
- On approve, include `note` in the `patient_results` upsert AND in the `approved_reports` test_results snapshot (as a `note` field on each parameter entry).

### 4. Report Rendering

**`src/pages/LimsReportView.tsx`:**
- Add `note` to `TestResultEntry` interface.
- Pass `note` through to `mapParamToTestResult` → map to `remark` field on `TestResult`.
- Priority logic: if a parameter has its own note, use it. If not but the test-level note exists (all params of that test share the same note), use test note. This is resolved when building the snapshot — parameter-level note wins.

**`src/components/report/ReportResultsSection.tsx`:**
- Already renders `r.remark` below each parameter row in bold italic. Change to **bold** (remove italic) per requirement.

### 5. ParameterResult Interface Updates

Add `note?: string` to the `ParameterResult` interface in all three components, populated from the `patient_results.note` column.

## UI Design

- Small "📝" or `StickyNote` icon button appears in the rightmost column of each parameter row.
- Clicking toggles a small inline text input below the row with the note text (default: "Kindly correlate clinically").
- Test-level: "Add Note" text button next to the test name header.
- Notes display as a subtle tag/badge when set, clickable to edit.

## Note Priority in Reports

When rendering the report, `remark` on `TestResult` is set as:
1. Parameter's own `note` (highest priority)
2. If all params of a test share the same note (test-level note), show it only once under the test — but since ReportResultsSection renders per-parameter, each param gets the note. To avoid duplication: if note is test-level (same across all params), show it only on the first parameter.

## Technical Flow
```text
Results Entry → saves note to patient_results.note
         ↓
Result Verification → reads/edits note from patient_results.note
         ↓
Doctor Approval → reads/edits note, writes to patient_results.note
                  AND to approved_reports.test_results[].note
         ↓
LimsReportView → reads note from approved_reports snapshot
                  maps to remark field → ReportResultsSection renders it bold
```

