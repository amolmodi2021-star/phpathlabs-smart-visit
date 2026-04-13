

# Fix Missing Audit Trail "By" Fields in LIMS Workflow

## Problem
The dispatch section shows timestamps for each stage but the "by" names (who collected, accepted, entered, verified) are blank. Investigation of the database confirms:
- `collected_by`, `accepted_by` on `sample_tubes` = always null
- `entered_by`, `verified_by` on `patient_results` = always null
- `approved_by` works correctly

## Root Causes

**Cause 1 — Delete+Reinsert loses previous stage data:**
- When Result Verification saves, it deletes existing results and reinserts new ones with `verified_by` but does NOT carry forward `entered_by` from the previous stage
- When Doctor Approval saves, it deletes and reinserts with `approved_by` but does NOT carry forward `entered_by` or `verified_by`

**Cause 2 — Sample tube "by" fields:**
- The `.update()` calls in SampleCollection and SampleAcceptance include `collected_by` and `accepted_by` correctly, but data shows all null. This may be due to a stale browser cache from before the code was added. The code itself is correct.

## Fix

### File: `src/components/lims/ResultVerification.tsx`
- In the verify upsert object (~line 568), add `entered_by: p.enteredBy || null` to carry forward the entered_by from the loaded result data
- Ensure the parameter data type includes `enteredBy` (check if it's already loaded from the query)

### File: `src/components/lims/DoctorApproval.tsx`
- In both approve upsert paths (~lines 290, 397), add:
  - `entered_by: p.enteredBy || null`
  - `verified_by: p.verifiedBy || null`
- Ensure the parameter data type includes both fields from the query

### File: `src/components/lims/ResultsEntry.tsx`, `ResultVerification.tsx`, `DoctorApproval.tsx`
- Verify that the data-loading queries for parameters include `entered_by` and `verified_by` from `patient_results` and map them into the parameter objects so they're available to carry forward during re-insertion.

### No database changes needed — all columns already exist.

