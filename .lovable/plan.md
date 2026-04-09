

# Fix: Result Verification and Doctor Approval Flow

## Problem
Records appear in Result Verification and Doctor Approval even when no results have been "Saved & Verified" in the Results section. The outsourced section creates `outsourced_test_snips` records (with `outsource_status: pending`), and the Verification/Approval pages incorrectly treat the mere existence of these records as a reason to display the patient.

**Root cause**: The data flow should be:
1. Outsourced section saves results (manual or snip) → updates Patient-wise/Machine-wise views only
2. Only when "Save & Verify" is clicked in Results section (Patient-wise/Machine-wise) should records move to Result Verification
3. Only "Verify" in Result Verification moves records to Doctor Approval

Currently, `outsourced_test_snips` records with any status (including `pending`, `sent`, `results_saved`) cause patients to appear in Verification and Approval prematurely.

## Changes

### 1. ResultVerification.tsx — Filter outsourced snips properly

**Query change (line ~109-118)**: Filter `outsourced_test_snips` to only include records where `outsource_status` is `entered` (meaning "Save & Verify" was clicked in the Results section, which sets `patient_results.status = 'entered'`).

**Build logic (line 288)**: Change the condition so that a snip record alone is not enough — require that the test has `entered`-status results in `patient_results` OR the snip's `outsource_status` indicates it has been through the Results section's "Save & Verify" step. Specifically, only show outsourced tests when their snip `outsource_status` is in `['results_entered', 'entered']` — NOT `pending`, `sent`, or `results_saved`.

### 2. DoctorApproval.tsx — Filter outsourced snips properly

**Query change (line ~68-75)**: Filter `outsourced_test_snips` to only include records where `outsource_status = 'verified'`.

### 3. ResultsEntry.tsx — Update outsource_status on Save & Verify

**Save mutation (~line 682)**: After saving results with `status: 'entered'`, also update the corresponding `outsourced_test_snips` record's `outsource_status` from `results_saved` to `results_entered` (or a similar status that signals it passed through Save & Verify).

This ensures the lifecycle is:
```text
Outsourced section saves → outsource_status = 'results_saved' (visible in Results section only)
Results "Save & Verify"  → patient_results.status = 'entered', outsource_status = 'results_entered' (→ Verification)
Verification "Verify"    → patient_results.status = 'verified', outsource_status = 'verified' (→ Doctor Approval)
Doctor "Approve"          → patient_results.status = 'approved', outsource_status = 'approved' (→ Dispatch)
```

## Summary of File Changes
- **ResultVerification.tsx**: Filter snips query to only `outsource_status IN ('results_entered')`, and adjust build logic to not show tests based solely on snip existence
- **DoctorApproval.tsx**: Filter snips query to only `outsource_status = 'verified'`
- **ResultsEntry.tsx**: In `saveMutation`, update `outsource_status` to `results_entered` when "Save & Verify" is clicked

