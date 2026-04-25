## Problem

Packages (HLT), Profiles (PRL) and Combos selected in a home visit are NOT being marked as Completed (or, when they are, the resulting registration ends up with no real tests). The root cause is that the home-visit completion path **drops the `item_type` field**, so a package/profile/combo row ends up stored as a generic `test` row whose `test_id` does not exist in the `tests` table. Downstream this breaks:

- Sample-tube expansion (`buildSampleTubeGroups` only expands rows where `item_type` is `package`/`profile`/`combo`)
- Registration leaf-test reconciliation (`expandRegistrationTests` drops the unknown id)
- The completion → registration handoff (rows look broken, registration may fail or produce a registration with zero usable tests)

## Where the field is lost

1. **`src/components/EditHomeVisitDialog.tsx`** — the dialog opened in completion mode (`completionEditVisit`).
   - `EditTest` interface has no `item_type`.
   - `existingTests` mapping (line 181) drops it when loading the saved estimate.
   - `addTest` (line 200) drops it when adding a new package/profile/combo from the search.
   - `saveMutation` insert into `estimate_tests` (line 287) never writes it, so the column reverts to its default `'test'`.

2. **`src/components/lims/CompletedHomeVisits.tsx`** — `registerMutation` (line 101) builds the `tests` JSON for `patient_registrations` without `item_type`, so even if the estimate row is correct, the registration loses it again.

The other dialogs (`AddHomeVisitDialog`, `CreateEstimate`, `EditEstimateDialog`) already handle `item_type` correctly, which is why brand-new visits with packages work, and only edits/completions break.

## Fix

### 1. `src/components/EditHomeVisitDialog.tsx`
- Add `item_type?: "test" | "profile" | "package" | "combo"` to the `EditTest` interface.
- When mapping `est.estimate_tests` into `existingTests`, carry `item_type` through (default `"test"`).
- In `addTest`, copy `t.item_type` from the selectable item into the new row.
- In `saveMutation`'s `testRows`, include `item_type: t.item_type || "test"` on each insert.
- In `calculations.testDetails`, ensure `item_type` survives the spread (it will, but keep the type).

### 2. `src/components/lims/CompletedHomeVisits.tsx`
- In `registerMutation`, when mapping `tests` → `testList`, include `item_type: t.item_type || "test"` so the registration row carries the correct container type into `patient_registrations.tests`.

### 3. One-shot data repair (migration)
Existing completed visits whose `estimate_tests` rows already lost `item_type` need backfill, otherwise re-registering them will still fail. Run a migration that:
- Sets `estimate_tests.item_type = 'package'` where `test_id` matches a `health_checkups.id`.
- Sets `estimate_tests.item_type = 'profile'` where `test_id` matches a `billing_profiles.id`.
- (`combo` backfill already exists from a prior migration — leave that as is, but re-run defensively.)
- Mirror the same backfill on `patient_registrations.tests` (JSONB) for any home-visit registration whose `tests[].item_type` is missing or `'test'` but whose `test_id` matches a package/profile/combo.

### 4. Verification
After the fix, completing a home visit that contains a package/profile/combo will:
- Save the estimate row with the correct `item_type`.
- Allow `Mark as Completed` to succeed.
- Allow registration from the Completed Home Visits tab to expand the package/profile/combo into the correct leaf tests and sample tubes.

## Out of scope
- No UI redesign of the dialog; only data-correctness fixes.
- No change to `AddHomeVisitDialog`, `CreateEstimate`, or `EditEstimateDialog` (already correct).
