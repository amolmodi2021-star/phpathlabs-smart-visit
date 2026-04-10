

# Plan: Fix Stale "sample_accepted" Status in Registered Patients

## Problem
The registration `HARSHADA` (invoice 2604100001) has all `patient_results` in "approved" status, but `patient_registrations.status` is still "sample_accepted". This happened because the approval occurred before the recent code fix that advances the registration status.

## Solution

### 1. Fix the existing data
Use the database insert tool to update the stuck registration:
```sql
UPDATE patient_registrations SET status = 'approved' WHERE id = '48736dda-274e-4018-b1d6-33ff944eaf38';
```

### 2. Add a broader data fix for any other stuck registrations
Run a query to find and fix all registrations where every result is "approved" but the registration status hasn't advanced:
```sql
UPDATE patient_registrations pr
SET status = 'approved'
WHERE pr.status = 'sample_accepted'
  AND pr.bill_cancelled = false
  AND EXISTS (SELECT 1 FROM patient_results r WHERE r.registration_id = pr.id)
  AND NOT EXISTS (
    SELECT 1 FROM patient_results r 
    WHERE r.registration_id = pr.id AND r.status != 'approved'
  );
```

### Files Modified
- None — this is a data-only fix. The code fix from the previous change already handles future approvals correctly.

