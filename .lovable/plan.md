

## Diagnosis

`Invoice 2604200019 → ANTENATAL PROFILE` is actually a **combo** (`CMB0001`), but the registration row stores it as a plain test (no `item_type:"combo"`). So `buildSampleTubeGroups` never expands it into its leaf tests → no tube created → "No tubes" shown.

Two root causes:

1. **Type unions weren't widened to include `"combo"`** in the `SelectedTest` interface across these files:
   - `src/components/lims/PatientRegistration.tsx`
   - `src/components/AddPatientToVisitDialog.tsx`
   - `src/components/lims/EditAndRegisterHomeVisitDialog.tsx`
   - (likely `EditEstimateDialog.tsx`, `AddHomeVisitDialog.tsx`, `EditHomeVisitDialog.tsx`, `CreateEstimate.tsx` too — will audit)
   
   TypeScript narrowing then dropped `"combo"` and stored it as `"test"`.

2. **`SampleCollection.recalcTubesForRegistration` doesn't detect combos**. When `item_type` is missing on legacy/saved rows, it queries only `billing_profiles` + `health_checkups` to back-fill type — combos are not checked, so they're treated as plain tests and never expanded.

## Plan

### 1. Widen the `item_type` union to include `"combo"` (8 files)
In each `SelectedTest` interface and any `as` casts, change:
```
item_type?: "test" | "profile" | "package"
```
to:
```
item_type?: "test" | "profile" | "package" | "combo"
```
Files: `PatientRegistration.tsx`, `AddPatientToVisitDialog.tsx`, `EditAndRegisterHomeVisitDialog.tsx`, `EditEstimateDialog.tsx`, `AddHomeVisitDialog.tsx`, `EditHomeVisitDialog.tsx`, `CreateEstimate.tsx`, `EditRegistrationDialog.tsx`. Also add the 🧩 icon for combos in the dropdown render (`item_type === "combo" ? " 🧩" : ...`).

### 2. Fix `SampleCollection.recalcTubesForRegistration`
Add a third lookup against `combos` table so legacy registrations whose JSONB is missing `item_type:"combo"` (like invoice **2604200019**) get correctly classified at recalc time:

```ts
const [profRes, pkgRes, cmbRes] = await Promise.all([
  supabase.from("billing_profiles").select("id").in("id", allIds),
  supabase.from("health_checkups").select("id").in("id", allIds),
  supabase.from("combos").select("id").in("id", allIds),
]);
const comboIds = new Set((cmbRes.data || []).map((r: any) => r.id));
// fallback chain: package > combo > profile > test
item_type: t.item_type || (packageIds.has(t.test_id) ? "package"
                          : comboIds.has(t.test_id) ? "combo"
                          : profileIds.has(t.test_id) ? "profile"
                          : "test"),
```

### 3. Backfill the existing broken registration
One-time migration: for any `patient_registrations` row whose `tests[].test_id` matches an existing `combos.id`, set `tests[].item_type = "combo"`. This unsticks invoice 2604200019 and any other combos saved before the fix without manual re-entry.

### 4. Trigger a tube recalc
After the backfill migration runs, the user just needs to expand the patient row in Sample Collection — `recalcTubesForRegistration` will now correctly expand the combo and create the right tube(s). No manual button needed.

## Files
- **EDIT** `src/components/lims/SampleCollection.tsx` — add combos to the type-detection lookup.
- **EDIT** the 8 selection components — widen `item_type` union to include `"combo"` + add 🧩 icon in dropdowns.
- **MIGRATION** SQL: backfill `patient_registrations.tests` JSONB to set `item_type:"combo"` for existing combo entries; same for `estimates` → `estimate_tests` rows.

## Out of scope
- UI showing the combo as a "Combo" badge in registration summaries (cosmetic).
- Backfill of invoices/receipts (they only need the tube grouping working forward).

