

# Plan: Create Approved Reports Archive Table

## What it does
Creates a permanent archive table (`approved_reports`) that captures a complete snapshot of all patient demographics, test results, reference ranges, flags, and key timestamps at the moment of doctor approval. This ensures historical reports can be regenerated exactly as they were originally approved, regardless of future changes to reference ranges or test configurations.

## Database Migration

**New table: `approved_reports`**

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | auto-generated |
| registration_id | uuid | links to patient_registrations |
| invoice_number | text | |
| umr_number | text | |
| patient_name | text | |
| title | text | |
| gender | text | |
| dob | date | |
| mobile_number | text | |
| email | text | nullable |
| address | text | nullable |
| doctor_name | text | referring doctor |
| visit_type | text | |
| is_stat | boolean | |
| report_language | text | |
| approved_by | text | doctor/pathologist who approved |
| registration_date | timestamptz | from patient_registrations.created_at |
| sample_collection_date | timestamptz | nullable, from sample collection step |
| test_date | timestamptz | when results were entered |
| approval_date | timestamptz | now() at approval time |
| print_date | timestamptz | nullable, updated when printed |
| test_results | jsonb | full snapshot — see below |
| outsourced_snip_urls | jsonb | snip images if any |
| created_at | timestamptz | default now() |

**`test_results` JSONB structure** — array of objects, one per parameter:
```json
[{
  "test_id": "...", "test_name": "...",
  "parameter_id": "...", "param_code": "PRM0001", "parameter_name": "Hemoglobin",
  "result_value": "12.5", "unit": "g/dL",
  "reference_range": "11-16 g/dL", "normal_range_low": 11, "normal_range_high": 16,
  "flag": "N", "is_calculated": false, "is_outsourced": false,
  "outsource_lab_name": null
}]
```

RLS: permissive (matching existing pattern). Enable realtime not needed.

## Code Changes

### File: `src/components/lims/DoctorApproval.tsx`

**In `approveTest` function** (after successful status updates, ~line 236):
- Build a snapshot object from `entry.registration` demographics + the `upserts` array (which already contains frozen result values, reference ranges, flags)
- Collect outsourced snip URLs from `outsourcedSnipDetails`
- Insert one row into `approved_reports` with all captured data
- Use `approved_by` from a pathologist name (can default to "Doctor" or pull from app settings if configured)

**In `approveAllForPatient` function** (~line 263):
- Same logic but insert one `approved_reports` row per test (or one row per patient with all tests combined in the JSONB array)
- Combine all test parameters into a single `test_results` JSONB for that registration

**Duplicate prevention**: Before inserting, check if an `approved_reports` row already exists for the same `registration_id` + `test_id` combination (upsert or skip).

### Approach for timestamps
- `registration_date`: from `reg.created_at`
- `sample_collection_date`: query `patient_registrations.updated_at` when status was `sample_collected` (or store null if not tracked separately — can enhance later)
- `test_date`: from `patient_results.created_at` of the earliest result for this test
- `approval_date`: `new Date().toISOString()` at approval time
- `print_date`: null initially, updated when report is printed/dispatched

## Summary
1. **Migration**: Create `approved_reports` table with full demographic + result snapshot columns
2. **DoctorApproval.tsx**: Insert frozen snapshot into `approved_reports` during both `approveTest` and `approveAllForPatient` flows

