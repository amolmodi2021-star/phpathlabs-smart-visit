

# Plan: Redesign LIMS Sample Flow Pipeline

## Overview
Replace the current JSONB-based sample tracking with a dedicated `sample_tubes` table using unique sequential IDs. Introduce granular status progression driven by sample-level and result-level state rather than fragile registration-level status filters.

## New Status Lifecycle
```text
registered → partially_collected → sample_collected → partially_accepted → sample_accepted
→ processing → partial_processing → processed → partial_verified → verified
→ partially_approved → approved → partially_dispatched → dispatched
```
Special: `repeat_collection` loops back to Sample Collection pending.

## Database Changes

### 1. New table: `sample_tubes`
Tracks each physical tube with a unique ID.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| sample_uid | text UNIQUE NOT NULL | e.g. `S26041000001` |
| registration_id | uuid NOT NULL | FK to patient_registrations |
| tube_type | text | e.g. "EDTA", "Plain" |
| tube_color | text | |
| sample_type | text | |
| suffix | text | Custom suffix if any |
| test_ids | jsonb | Array of test IDs in this tube |
| test_names | jsonb | Array of test names |
| status | text DEFAULT 'pending' | pending → collected → accepted |
| collected_at | timestamptz | |
| accepted_at | timestamptz | |
| created_at | timestamptz DEFAULT now() | |

### 2. New table: `sample_tube_counter`
Auto-incrementing per-date counter for unique IDs.

| Column | Type | Notes |
|---|---|---|
| date_key | text PK | e.g. "260410" |
| last_sequence | integer DEFAULT 0 | |

### 3. New DB function: `generate_sample_uid()`
Returns next `S{YYMMDD}{5-digit seq}`.

### 4. Remove columns (later migration)
- `collected_samples` and `accepted_samples` JSONB columns on `patient_registrations` — no longer used. Will be ignored in code immediately; dropped in a follow-up migration after confirming stability.

### 5. Update `patient_registrations.status` allowed values
Add: `partially_collected`, `partially_accepted`, `processing`, `partial_processing`, `processed`, `partial_verified`, `partially_approved`, `partially_dispatched`

## Code Changes

### Registration (`PatientRegistration.tsx`)
- After saving a registration, auto-create `sample_tubes` rows by grouping tests by tube type + suffix (same logic as current `buildBarcodeGroups`).
- Call `generate_sample_uid()` for each tube row.
- No other changes to registration flow.

### Sample Collection (`SampleCollection.tsx`) — Full rewrite of data layer
**Pending tab**: Query `sample_tubes` WHERE `status = 'pending'`, grouped by `registration_id`. Show patient info with expandable tube list. User selects tubes → prints barcodes (barcode value = `sample_uid`) → mark selected tubes as `collected` with timestamp.

**Status update logic**:
- If ALL tubes for a registration are collected → set registration status to `sample_collected`
- If SOME tubes collected → set status to `partially_collected`
- Show `PARTIAL` badge accordingly

**Collected tab**: Query `sample_tubes` WHERE `status = 'collected'`, grouped by registration. Hide tubes that are already `accepted`.

### Sample Acceptance (`SampleAcceptance.tsx`) — Full rewrite of data layer
**Pending tab**: Query `sample_tubes` WHERE `status = 'collected'`, grouped by registration. User accepts tubes individually or in batch.

**Status update logic**:
- Accepted tube → update `sample_tubes.status = 'accepted'` with timestamp
- If ALL tubes accepted → registration status = `sample_accepted`
- If SOME → `partially_accepted`
- Show `PARTIAL` badge

**Accepted tab**: Query `sample_tubes` WHERE `status = 'accepted'`, grouped by registration. Show status badges reflecting downstream progress (processing, verified, approved, etc.). Remove from this tab only when registration status = `dispatched`.

### Results Entry (`ResultsEntry.tsx`) — Query changes only
- Query registrations WHERE status IN (`sample_accepted`, `partially_accepted`, `processing`, `partial_processing`)
- Exclude: `processed`, `partial_verified`, `verified`, `partially_approved`, `approved`, `partially_dispatched`, `dispatched`
- **Status update logic** (on save):
  - Any parameter has result entered → `processing`
  - Some tests fully entered, some not → `partial_processing`
  - ALL parameters entered → `processed`

### Result Verification (`ResultVerification.tsx`) — Query changes only
- Query WHERE status IN (`processing`, `partial_processing`, `processed`, `partial_verified`)
- Exclude: `verified`, `partially_approved`, `approved`, `dispatched`
- **Status update logic**:
  - Some verified → `partial_verified`
  - All verified → `verified`

### Doctor Approval (`DoctorApproval.tsx`) — Query changes only
- Query WHERE status IN (`partial_verified`, `verified`, `partially_approved`)
- Exclude: `approved`, `dispatched`
- **Status update logic**:
  - Some approved → `partially_approved`
  - All approved → `approved`

### Dispatch (`Dispatch.tsx`) — Query changes only
- Query WHERE status IN (`partially_approved`, `approved`, `partially_dispatched`)
- Exclude: `dispatched`
- **Status update logic**:
  - Some dispatched → `partially_dispatched`
  - All dispatched → `dispatched`
  - On full dispatch → remove from Sample Acceptance accepted tab

### Registered Patients (`RegisteredPatients.tsx`)
- Status badge display updated to show new statuses with appropriate colors

### Repeat Collection
- When marked as repeat collection, create new `sample_tubes` rows for the repeat tests, set registration status back to include those pending tubes (the status recalculation handles this).

## Status Recalculation Helper
A shared utility function `recalculateRegistrationStatus(registrationId)` will:
1. Check sample_tubes statuses (pending/collected/accepted)
2. Check patient_results statuses (pending/entered/verified/approved)
3. Check dispatch state
4. Derive and update the correct registration status

This prevents every module from having its own status logic.

## Files Modified
1. **Migration SQL** — create `sample_tubes`, `sample_tube_counter`, `generate_sample_uid()` function
2. `src/lib/limsStatus.ts` — NEW shared status recalculation helper
3. `src/components/lims/PatientRegistration.tsx` — create sample_tubes on save
4. `src/components/lims/SampleCollection.tsx` — rewrite to use sample_tubes table
5. `src/components/lims/SampleAcceptance.tsx` — rewrite to use sample_tubes table
6. `src/components/lims/ResultsEntry.tsx` — update query filters + call status helper
7. `src/components/lims/ResultVerification.tsx` — update query filters + call status helper
8. `src/components/lims/DoctorApproval.tsx` — update query filters + call status helper
9. `src/components/lims/Dispatch.tsx` — update query filters + call status helper
10. `src/components/lims/RegisteredPatients.tsx` — update status badge display
11. `src/hooks/useRealtimeSync.ts` — add `sample_tubes` to TableName union

## What I'm NOT building (to avoid overbuilding)
- No changes to report generation, approved_reports, or the print/PDF pipeline
- No changes to outsourced results flow (it continues working via patient_results)
- No changes to the LIMS interface/machine integration
- Not dropping the old JSONB columns yet (just ignoring them)
- Not adding barcode scanning hardware integration

