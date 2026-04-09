

# Plan: Modified Approval Section + Hold for Dispatch

## What it does
1. Adds a **"Modified Approval"** tab/section under Doctor Approval that shows all previously approved reports
2. Allows editing result values, units, reference ranges, and flags — then re-saves the snapshot to `approved_reports`
3. Adds a **"Hold for Dispatch"** toggle per report in `approved_reports` — when ON, the report is hidden from the Dispatch section

## Database Changes

### Migration: Add `is_held` column to `approved_reports`
```sql
ALTER TABLE approved_reports ADD COLUMN is_held boolean NOT NULL DEFAULT false;
```
This single column controls dispatch visibility. No new tables needed.

## Code Changes

### 1. `src/components/lims/DoctorApproval.tsx`

- Add a new tab: `"approval"` (existing) | `"modified"` (new)
- **Modified Approval tab** queries:
  - `approved_reports` (all records) — searchable by patient name, mobile, invoice, UMR
  - `patient_results` where `status = 'approved'` for those registration IDs
  - `outsourced_test_snips` where `outsource_status = 'approved'`
  - Same test/parameter metadata as the main approval tab
- **Rendering**: Same editable parameter table as existing approval view (reuse `renderParamRow` pattern), but with:
  - A **"Hold for Dispatch"** toggle (Switch component) per patient card — updates `approved_reports.is_held`
  - A **"Save Changes"** button that:
    1. Updates `patient_results` with edited values (keeping status = 'approved')
    2. Re-generates the `approved_reports.test_results` JSONB snapshot with updated values
    3. Updates `approved_reports.approval_date` to current time
- Show hold status with a visual badge (amber "On Hold" / green "Ready for Dispatch")

### 2. `src/components/lims/Dispatch.tsx`

- Fetch `approved_reports` for all visible registration IDs
- Filter out registrations where `approved_reports.is_held = true`
- Or more simply: in the dispatch query, join/check `approved_reports` and exclude held ones
- Approach: fetch `approved_reports` with `is_held = true` → collect those `registration_id`s → exclude from dispatch entries

## Files Changed
- **Migration**: Add `is_held` column to `approved_reports`
- `src/components/lims/DoctorApproval.tsx` — add "Modified Approval" tab with editable results + hold toggle
- `src/components/lims/Dispatch.tsx` — filter out held reports

