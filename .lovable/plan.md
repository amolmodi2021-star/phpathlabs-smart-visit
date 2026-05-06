## Goal

Use `patient_master` as the single source of truth for patient demographics (title, name, gender, DOB, mobile, address). Old-LIMS data is imported into `patient_master` via Excel. New-registration mobile lookup pulls from `patient_master` so old patients auto-fill on revisit. `ref_doctor` stays only on `patient_registrations` (doctors change per visit). All current functionality remains intact.

---

## 1. Schema changes (migration)

`patient_master` (additive, non-breaking):
- Add `title text` (e.g. MR./MRS./BABY OF)
- Add `address text`
- Add `source text default 'lims'` — `'lims'` (created from a registration) vs `'legacy'` (imported from old LIMS, no DOB)
- Add `legacy_imported_at timestamptz` (nullable) — audit timestamp
- Drop `ref_doctor` column (doctor belongs to the visit, not the patient). Existing values are discarded — already mirrored on each `patient_registrations` row, which remains untouched.
- Indexes: unique index on `umr_id` (treat as logical PK going forward — keeping existing `id uuid` PK so foreign references and RLS stay intact), btree index on `mobile_number` for fast 10-digit lookup.

We do NOT change the actual primary key column (still `id uuid`) to avoid breaking any existing foreign references / sync code. Adding a UNIQUE constraint on `umr_id` gives us the same guarantee with zero ripple risk.

`patient_registrations` — no schema changes. `title`, `address`, `doctor_name` stay where they are. Going forward they're written from `patient_master` (except `doctor_name`, which is per-visit input).

---

## 2. Excel import flow (legacy migration)

New section in **LIMS → Settings** tab: **"Legacy Patient Import"**, gated by the standard 9819111107 password.

- Download template button → produces `.xlsx` with columns: `umr_number, mobile_number, title, patient_name, gender, address` (no DOB column, per user).
- Upload `.xlsx`:
  - Normalize: mobile → last 10 digits; name/address/title → UPPERCASE, single-spaced; gender → Male/Female/Unspecified.
  - Skip rows missing `umr_number` or `mobile_number` (report them in the result summary).
  - **Upsert by `umr_id`** into `patient_master`:
    - If UMR exists → update title/name/gender/mobile/address only when current value is null/empty (don't overwrite richer data already in the system).
    - If UMR is new → insert with `source='legacy'`, `legacy_imported_at=now()`, `date_of_birth=null`.
  - Show summary: inserted / updated / skipped (with reasons), downloadable as CSV.

Files: new `src/components/lims/LegacyPatientImport.tsx`, new `src/lib/legacyPatientsImport.ts`, add tab in `src/components/lims/LimsSettings.tsx`.

---

## 3. Patient lookup on New Registration

`PatientRegistration.tsx` currently searches `patient_registrations` first, then `patient_master`, then `estimates`. Change the priority to:

1. `patient_master` (canonical) — by mobile, returns title, name, gender, DOB, address, UMR.
2. `patient_registrations` (only for UMRs not already returned by step 1, as a fallback for any historical row whose UMR somehow isn't in `patient_master`).
3. `estimates` (unchanged).

`PatientSelectDialog.tsx` (the popup) — same change: read primarily from `patient_master`, fall back to `patient_registrations`. Edits in the popup write to `patient_master` (canonical) AND continue to fan out via `syncPatientDemographicsByUmr` so all historical rows in `patient_registrations`, `approved_reports`, `estimates`, `lims_test_orders` reflect the corrected demographics. Behaviour the user already approved (lock fields after select, "Change patient" reopens dialog) is preserved.

Doctor name is **not** pre-filled from `patient_master` — it defaults to the registration's last `doctor_name` for that UMR (existing behavior in `selectPatient`), or "SELF".

---

## 4. Save flow

In `PatientRegistration.tsx` save:
- Continue inserting the full row in `patient_registrations` (title/address/doctor_name still stored there — required for invoice/report snapshots).
- Upsert `patient_master` keyed on `umr_id` (not mobile, which can change). Write: title, patient_name, gender, mobile_number, date_of_birth, email, address, last_visit_date. Do NOT write `ref_doctor` (column removed).
- Existing `syncPatientDemographicsByUmr` call stays as-is — but the `patient_master` block inside it is updated to also sync `title` + `address` and to drop `ref_doctor`.

---

## 5. Files touched

- `supabase/migrations/<ts>_patient_master_canonical.sql` — add columns, unique index, drop `ref_doctor`.
- `src/lib/syncPatientDemographics.ts` — sync `title` + `address` to `patient_master`; remove `ref_doctor` write.
- `src/components/lims/PatientRegistration.tsx` — reorder lookup, update upsert payload.
- `src/components/lims/PatientSelectDialog.tsx` — read from `patient_master` first.
- `src/components/lims/LimsSettings.tsx` — add new tab.
- `src/components/lims/LegacyPatientImport.tsx` (new) — UI for download template + upload + result summary.
- `src/lib/legacyPatientsImport.ts` (new) — parsing, normalization, batched upsert.
- `public/samples/Sample_Legacy_Patient_Import.xlsx` (new) — downloadable template.

---

## 6. Safety / non-regression

- All schema changes are additive except dropping `patient_master.ref_doctor` — and that column is not read anywhere except inside the lookup mapping (which we're updating in the same change). `patient_registrations.doctor_name` is unaffected; reports/invoices still work.
- Lookup change is order-of-priority only; if `patient_master` is empty for a mobile, behaviour is identical to today.
- `RegisteredPatients.tsx` factory-reset already wipes `patient_master` — still works.
- No changes to RLS, realtime publication, or report generation.
- Storage: dropping `ref_doctor` and avoiding duplicated writes shrinks `patient_master` slightly; main savings come from not re-storing data, not from changing what `patient_registrations` stores (we keep that for snapshot integrity of historical bills/reports).

---

## Out of scope (confirm if needed)

- Importing old test results / invoices.
- Changing `patient_registrations` to stop storing title/address (would break invoice & report snapshots — kept as-is intentionally).
- Migrating existing `patient_master.ref_doctor` values somewhere before drop (not needed — registrations already carry doctor history).
