

# Trim Extra Spaces from Patient Name

## Problem
Patient names can contain leading, trailing, or multiple consecutive spaces, leading to messy records.

## Solution
Apply `.replace(/\s+/g, ' ').trim()` before `.toUpperCase()` on `patientName` in three files:

### Files to modify

1. **`src/components/lims/PatientRegistration.tsx`** — Two occurrences (insert into `patient_registrations` and `patient_master` upsert): change `patientName.toUpperCase()` to `patientName.replace(/\s+/g, ' ').trim().toUpperCase()`

2. **`src/components/lims/EditRegistrationDialog.tsx`** — One occurrence (update `patient_registrations`): same transformation

3. **`src/components/lims/EditAndRegisterHomeVisitDialog.tsx`** — Two occurrences (update `estimates` and insert `patient_registrations`): same transformation

This ensures all extra spaces are collapsed to a single space and leading/trailing spaces are removed before saving.

