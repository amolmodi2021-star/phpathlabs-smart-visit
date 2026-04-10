

# Plan: Fix Registration Status Not Advancing After Approval

## Problem
When tests are approved in Doctor Approval, the `patient_registrations.status` is never updated from `sample_accepted` to `approved`. This causes:
- The Results Entry query keeps fetching the registration
- All parameters are filtered out (status = "approved"), leaving only incomplete test warnings
- The patient appears stuck or invisible in Results Entry

## Root Cause
`DoctorApproval` updates `patient_results.status` to "approved" but never updates `patient_registrations.status`. The registration stays at `sample_accepted` indefinitely.

## Changes

### 1. `src/components/lims/DoctorApproval.tsx`
**In `approveAllForPatient`** (after line 341, after archiving snapshot): Check if ALL tests for the registration have approved results. If so, update `patient_registrations.status` to `"approved"`.

**In `approveTest`** (after line 288): Same check — after approving a single test, query all `patient_results` for this registration. If all are "approved", update the registration status to `"approved"`.

### 2. `src/components/lims/ResultsEntry.tsx`
**Line 124** — Add exclusion for registrations already past the results stage. Change the query from:
```
.or("status.eq.sample_accepted,accepted_samples.neq.[]")
```
to:
```
.or("status.eq.sample_accepted,accepted_samples.neq.[]")
.not("status", "in", "(approved,dispatched)")
```

This ensures approved/dispatched registrations are excluded from Results Entry even if `accepted_samples` is non-empty.

### 3. Similarly update queries in:
- **ResultVerification.tsx** — exclude "approved"/"dispatched" registrations
- **DoctorApproval.tsx** query — should only fetch registrations with verified results (existing behavior check)

### Files Modified
- `src/components/lims/DoctorApproval.tsx` — add registration status update after approval
- `src/components/lims/ResultsEntry.tsx` — exclude approved/dispatched from query
