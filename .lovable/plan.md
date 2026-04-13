

# Audit Trail: Capture Usernames at Every LIMS Stage

## Problem
Currently, no username is captured at registration, sample collection, sample acceptance, results entry, verification, or dispatch. Only the approval stage captures `approved_by`. The Dispatch audit trail shows timestamps but not who performed each action.

## Solution

### 1. Database Migration — Add `_by` columns

**`sample_tubes` table:**
- `collected_by TEXT` (nullable)
- `accepted_by TEXT` (nullable)

**`patient_results` table** (already has `entered_by` column but it's never populated):
- `verified_by TEXT` (nullable) — new column
- `approved_by TEXT` (nullable) — new column
- `dispatched_by TEXT` (nullable) — new column

**`patient_registrations` table:**
- `registered_by TEXT` (nullable) — new column

### 2. Capture username at each stage

Each module already calls `getCurrentUser()` or can import it from `@/lib/auth`.

| Stage | File | Change |
|---|---|---|
| Registration | `PatientRegistration.tsx` | Add `registered_by: getCurrentUser()?.display_name` when inserting registration |
| Collection | `SampleCollection.tsx` | Add `collected_by: getCurrentUser()?.display_name` when updating tube status to "collected" |
| Acceptance | `SampleAcceptance.tsx` | Add `accepted_by: getCurrentUser()?.display_name` when updating tube status to "accepted" |
| Results Entry | `ResultsEntry.tsx` | Set `entered_by: getCurrentUser()?.display_name` in the upsert (column exists, just unused) |
| Verification | `ResultVerification.tsx` | Add `verified_by: getCurrentUser()?.display_name` in the upsert |
| Approval | `DoctorApproval.tsx` | Add `approved_by: getCurrentUser()?.display_name` to patient_results update (already done for snapshot) |
| Dispatch | `Dispatch.tsx` | Add `dispatched_by: getCurrentUser()?.display_name` when marking dispatched |

### 3. Display in Dispatch audit trail

**`Dispatch.tsx`:**
- Fetch the new `_by` columns from `sample_tubes` and `patient_results` queries
- Add `_by` fields to `DispatchTest` interface (e.g., `collectedBy`, `acceptedBy`, `enteredBy`, `verifiedBy`, `approvedBy`, `dispatchedBy`)
- In `DispatchTest` computation, extract earliest `_by` values alongside timestamps
- In the audit trail grid, add a third column showing the username next to each timestamp

The audit trail row will change from:
```
● Sample Collected    13 Apr 2026, 10:30 AM
```
to:
```
● Sample Collected    13 Apr 2026, 10:30 AM    by Dr. Hemang
```

Also add "Registered" as the first audit step with `registered_by` from the registration record.

### Files to modify
- **New migration**: Add columns to `sample_tubes`, `patient_results`, `patient_registrations`
- **`src/components/lims/PatientRegistration.tsx`** — Set `registered_by`
- **`src/components/lims/SampleCollection.tsx`** — Set `collected_by`
- **`src/components/lims/SampleAcceptance.tsx`** — Set `accepted_by`
- **`src/components/lims/ResultsEntry.tsx`** — Set `entered_by`
- **`src/components/lims/ResultVerification.tsx`** — Set `verified_by`
- **`src/components/lims/DoctorApproval.tsx`** — Set `approved_by` on patient_results
- **`src/components/lims/Dispatch.tsx`** — Set `dispatched_by`, display all `_by` fields in audit trail

