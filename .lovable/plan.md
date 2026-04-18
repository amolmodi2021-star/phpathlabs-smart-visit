

## Root cause
`EditAndRegisterHomeVisitDialog.tsx` (the "Edit & Register" flow used from the Completed Home Visits tab) inserts the row into `patient_registrations` but **never creates `sample_tubes`** for the registered tests. Sample Collection queries the `sample_tubes` table (`SampleCollection.tsx` line 68–76, status in `pending`/`collected`), so any registration without tubes is invisible there. The standard `PatientRegistration.tsx` flow (line 389–446) does create tubes — that's why patients registered via "New Registration" appear in Sample Collection but home-visit-registered patients don't.

DB confirmation:
- `patient_registrations` row for invoice `2604180001` exists with status `registered`, 3 tests, `home_visit_id` set.
- `SELECT * FROM sample_tubes WHERE registration_id = '<that id>'` → **0 rows**.

## Fix

### 1. `src/components/lims/EditAndRegisterHomeVisitDialog.tsx` — add tube creation after line 316
After the successful `patient_registrations` insert (and before/after the `home_visits` update is fine), port the exact same tube-creation block from `PatientRegistration.tsx` (lines 389–446):
- Fetch `tests` rows (`id`, `sample_tube`, `tube_color`, `sample_type`) for the selected test IDs.
- Fetch `report_test_parameters.custom_sample_suffix` for each test.
- Group selected tests by `tube_type || suffix`.
- For each group, call `rpc("generate_sample_uid")` and `insert` a `sample_tubes` row with `status: "pending"`, the registration ID, tube/sample metadata, and the test IDs/names.
- Wrap in try/catch (non-fatal) — same pattern as the reference.

### 2. Backfill the existing stuck patient (`2604180001`)
One-off SQL to manually create the `sample_tubes` rows for `registration_id d13597ac-c2fa-4e47-b2ee-fc58fc9495ea` so it appears in Sample Collection right away. Read `tests` jsonb from the registration → group by tube_type/suffix as above → insert tubes with generated `sample_uid`s and `status='pending'`.

## Files to edit
- `src/components/lims/EditAndRegisterHomeVisitDialog.tsx` — insert the ~55-line sample-tube block after the successful registration insert.
- One-off data fix via the insert tool for the existing patient `2604180001`.

## Out of scope
- Sample Collection / Acceptance / Results Entry logic — already correct, will work as soon as tubes exist.
- `EditAndRegisterHomeVisitDialog`'s payment / discount / UMR logic.
- New Registration flow (already creates tubes correctly).

## Expected outcome
- Future patients registered via "Edit & Register" from Completed Home Visits will automatically appear in Sample Collection (and onwards through the LIMS pipeline) exactly like New Registration patients.
- Patient `2604180001` immediately becomes visible in Sample Collection after the backfill.

