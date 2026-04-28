## Goal
Show patient age and gender in the format `36/M` (M=Male, F=Female, O=Other) across the LIMS workflow:

1. Sample Collection — Pending and Collected
2. Sample Acceptance — Pending Acceptance and Accepted
3. Results Entry
4. Result Verification
5. Doctor Approval
6. Dispatch

## Approach

### Shared helper
Create `src/lib/ageGender.ts` exporting:
- `calcAgeYears(dob)` → integer years from date-of-birth
- `formatAgeGender(dob, gender)` → `"36/M"`, `"28/F"`, `"5/O"`, or `"—"` when missing

This centralises the logic that currently lives only inside `SampleCollection.tsx`.

### Per-file changes

For each component:
- Ensure the patient query selects `dob` and `gender` (most already do; Dispatch needs to add them).
- Add a new column **Age/Gender** immediately after the Patient Name column in the table header, and render `formatAgeGender(reg.dob, reg.gender)` in the corresponding row cell.
- Update any colSpan values (loading/empty rows) by +1 where applicable.

Files to edit:
- `src/components/lims/SampleCollection.tsx` — switch local `calcAge` to the shared helper; add column in pending + collected tables.
- `src/components/lims/SampleAcceptance.tsx` — add `dob, gender` to select; add column in pending + accepted tables.
- `src/components/lims/ResultsEntry.tsx` — add `dob, gender` to select; add column in patient list table.
- `src/components/lims/ResultVerification.tsx` — same.
- `src/components/lims/DoctorApproval.tsx` — already selects dob/gender; just add column.
- `src/components/lims/Dispatch.tsx` — add `dob, gender` to select (line 90); render badge next to patient name in its card layout (Dispatch uses cards, not a table — show `36/M` next to the name).

### Format rules
- Gender mapping: `Male → M`, `Female → F`, anything else → `O`. Case-insensitive.
- If DOB missing → show `—/{G}`; if both missing → `—`.
- Age rounded down to whole years from today.

No database changes required — all data already exists on `patient_registrations`.