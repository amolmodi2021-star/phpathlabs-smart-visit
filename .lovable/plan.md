# Backfill missing patient_master fields on revisit

## Problem
Today, when a patient revisits and the registration form is saved, `patient_master` is updated by overwriting every column — including with blanks. So:
- If address was missing in master and the user now enters one → it correctly saves. ✓
- But if a field is left blank in the new registration, the existing master value gets wiped to `null`. ✗

We want a true "fill-in-the-gaps" behavior: new non-empty values win, but blanks must never erase existing master data.

## Change

In `src/components/lims/PatientRegistration.tsx` (around lines 429–449), when an existing `patient_master` row is found for the UMR, build the update payload conditionally:

- For each demographic field (`title`, `mobile_number`, `gender`, `date_of_birth`, `email`, `address`, `patient_name`), include it in the UPDATE **only if** the new value is non-empty/non-null.
- Always update `last_visit_date`.
- Insert path (new master row) stays unchanged — it writes whatever was entered.

Also mirror the same "skip-blank" logic in `src/lib/syncPatientDemographics.ts` for the `patient_master` branch, so an edit from the Registered Section dialog with a blank field doesn't wipe the canonical row either. The fan-out to `patient_registrations` / `approved_reports` / `estimates` keeps current behavior (those are visit-specific snapshots).

## Files
- `src/components/lims/PatientRegistration.tsx` — conditional update payload for existing master row.
- `src/lib/syncPatientDemographics.ts` — same skip-blank rule for the `patient_master` update only.

No DB migration required.
