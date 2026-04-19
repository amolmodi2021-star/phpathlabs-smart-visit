
## Goal
When **profiles (PRL)** or **health check-ups (HLT)** are added during patient registration, generate **grouped sample tubes** based on their underlying tests' tube types — exactly like individually selected tests. When tests + profiles + checkups are all selected together, group everything by tube type (so one EDTA tube can carry tests from a profile + a standalone test + a checkup).

## Root cause of current bug
The `tube_type` lookup in `PatientRegistration.tsx` and `EditAndRegisterHomeVisitDialog.tsx` queries the `tests` table by ID. But when a row in `calculations.testDetails` is actually a profile (`item_type: "profile"`) or checkup (`"package"`), the ID belongs to `billing_profiles` / `health_checkups` — so no match → all such items collapse into a single `"DEFAULT"` tube with no leaf-test breakdown. They show in Sample Collection as one undifferentiated tube and don't propagate to Sample Acceptance/Results Entry properly.

## Approach

### 1. New helper — `src/lib/sampleTubeGrouping.ts` (NEW)
Single shared function used by both registration entry points:

```ts
export interface TubeGroup {
  tubeType: string; tubeColor: string; sampleType: string;
  suffix: string; testIds: string[]; testNames: string[];
}
export async function buildSampleTubeGroups(
  selectedItems: { test_id: string; test_name: string; item_type?: "test" | "profile" | "package" }[],
  cancelledTestIds?: Set<string>,
): Promise<TubeGroup[]>
```

Steps inside:
1. Walk `selectedItems`. For each:
   - `item_type === "test"` (or undefined): keep ID as-is.
   - `item_type === "profile"`: expand via `billing_profile_tests` → leaf test IDs.
   - `item_type === "package"`: expand via `health_checkup_tests` → leaf test IDs **plus** `health_checkup_profiles` → those profile IDs → expanded again via `billing_profile_tests` (handles the nested HLT→PRL→TST chain).
2. Collect unified `leafTestIds` (preserving an origin label for naming, e.g. `"GLUCOSE (CBC Profile)"` or just `"GLUCOSE"` for direct).
3. One batched fetch from `tests`: `id, test_name, sample_tube, tube_color, sample_type`.
4. One batched fetch from `test_parameters`+`report_test_parameters` for `custom_sample_suffix` (existing logic).
5. Group by `${tube_type}||${suffix}`, dedupe leaf test IDs across origins, return array of `TubeGroup`.

### 2. Refactor `src/components/lims/PatientRegistration.tsx`
- Pass `item_type` through `SelectedTest` interface (currently dropped at line 257) and through `calculations.testDetails`.
- Replace lines 389–442 (the inline tube-grouping block) with a single call to `buildSampleTubeGroups(...)` + the existing insert loop.

### 3. Refactor `src/components/lims/EditAndRegisterHomeVisitDialog.tsx`
- Same: thread `item_type` through the selected items list and replace lines 318–369 with the helper.
- Estimates already store the original test IDs (which can be profile/checkup IDs from CreateEstimate / AddHomeVisitDialog), so we need to also persist `item_type` on `estimate_tests` rows so the dialog knows which to expand. Quick check: the `estimate_tests` table has `test_id` only — we'll add `item_type text` column via migration (default `'test'`) and populate it on writes from the three estimate dialogs.

### 4. Schema migration
- Add `item_type text NOT NULL DEFAULT 'test'` to `estimate_tests` so the registration flow downstream of an estimate (Edit&Register) can correctly expand profiles/checkups. Existing rows default to `'test'` — they were saved as resolved test IDs already in many cases, but going forward we capture the original selection.
- Update writes in: `CreateEstimate.tsx`, `EditEstimateDialog.tsx`, `AddHomeVisitDialog.tsx`, `AddPatientToVisitDialog.tsx` to include `item_type: t.item_type ?? 'test'`.

### 5. Behaviour rules
- A profile's constituent tests sharing the same `sample_tube` as a separately added test → one tube, both test IDs/names listed.
- Tests from different sources requiring different tubes → separate tubes (existing behaviour, just now correct for profiles/checkups).
- Tube `test_names` will use raw test names (no source suffix) to keep barcode labels clean; downstream Sample Acceptance / Results Entry filter by `test_ids` only.
- If a leaf test has no `sample_tube` configured, it falls into the `"DEFAULT"` tube (existing behaviour preserved).

## Out of scope
- Changing `EditRegistrationDialog.tsx` add-test flow (that dialog only allows removing tests, not adding new profiles/checkups mid-registration).
- Backfilling sample_tubes for existing registrations created before this fix.
- Visual changes to the Sample Collection table.

## Files
- NEW `src/lib/sampleTubeGrouping.ts`
- EDIT `src/components/lims/PatientRegistration.tsx` — use helper + carry `item_type`
- EDIT `src/components/lims/EditAndRegisterHomeVisitDialog.tsx` — use helper
- EDIT `src/pages/CreateEstimate.tsx`, `src/components/EditEstimateDialog.tsx`, `src/components/AddHomeVisitDialog.tsx`, `src/components/AddPatientToVisitDialog.tsx` — persist `item_type` on `estimate_tests`
- MIGRATION: add `item_type` column to `estimate_tests`

## Expected outcome
Selecting "Lipid Profile (PRL)" + "CBC (test)" + "Master Health Check (HLT)" in registration → sample tubes are generated for every underlying test, grouped by tube type, with all constituent test names visible on the right barcode. Sample Acceptance and Results Entry then correctly see every leaf test attached to the right tube.
