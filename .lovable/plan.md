

## Goal
Add a new **Combo** section under Test Management that mirrors Health Check-Ups: combos can bundle Tests + Profiles, get auto-codes `CMB0001`, and behave like a package everywhere (selection, billing, sample-tube grouping, leaf expansion).

## Approach

### 1. Database (migration)

```sql
-- Sequence + table
CREATE SEQUENCE combo_code_seq START 1;

CREATE TABLE public.combos (
  id uuid PK default gen_random_uuid(),
  combo_code text UNIQUE,                -- auto: CMB0001
  combo_name text NOT NULL,
  display_name text,
  price numeric NOT NULL DEFAULT 0,
  fasting_required bool DEFAULT false,
  discount_applicable bool DEFAULT false,
  bold_in_report bool DEFAULT true,
  show_in_report bool DEFAULT true,
  incentive_allowed bool DEFAULT false,
  incentive_amount numeric DEFAULT 0,
  is_active bool DEFAULT true,
  created_at, updated_at
);

CREATE TABLE public.combo_tests (
  id uuid PK, combo_id uuid → combos(id) ON DELETE CASCADE,
  test_id uuid NOT NULL, display_order int DEFAULT 0, created_at
);

CREATE TABLE public.combo_profiles (
  id uuid PK, combo_id uuid → combos(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL, display_order int DEFAULT 0, created_at
);

-- Trigger to auto-assign CMB0001 code (mirrors auto_assign_health_checkup_code)
CREATE FUNCTION auto_assign_combo_code() ...;
CREATE TRIGGER trg_combo_code BEFORE INSERT ON combos ...;

-- Open RLS like sibling tables
ALTER TABLE … ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on combos/combo_tests/combo_profiles" ...;
```

### 2. New helper file `src/lib/combos.ts`
Direct clone of `healthCheckups.ts` API:
- `getCombos()`, `saveCombo()`, `deleteCombo()`
- `getComboTests()`, `linkTestToCombo()`, `unlinkTestFromCombo()`
- `getComboProfiles()`, `linkProfileToCombo()`, `unlinkProfileFromCombo()`

### 3. New UI component `src/components/ComboManagement.tsx`
Cloned from `HealthCheckUpManagement.tsx`, with labels swapped to "Combo" and the badge changed from "Package" to "Combo". Reuses existing `<TestLinker>` and `<ProfileLinker>` components.

### 4. Wire into Test Management tabs
In `src/pages/TestManagement.tsx`:
- TabsList: change `grid-cols-6` → `grid-cols-7`, add `<TabsTrigger value="combos">Combos</TabsTrigger>` between Health Check-Ups and Profiles.
- Add `<TabsContent value="combos"><ComboManagement /></TabsContent>`.

### 5. Selectable item integration
Treat combos as a fourth `item_type` that **behaves like `package`** (since both expand to leaf tests + nested profiles):

- `src/lib/allSelectableTests.ts` — fetch `combos` and append with `item_type: "combo"`. Extend the union type to include `"combo"`.
- `src/lib/sampleTubeGrouping.ts` — when type is `"combo"`, look up its tests via `combo_tests` and nested profiles via `combo_profiles` (analogous to the existing `package` branch).
- `expandRegistrationTests.ts` — already works via `leafTestIds`, no change needed.
- All 8 selection UIs (Estimate, PatientRegistration, AddHomeVisit, EditHomeVisit, EditEstimate, AddPatientToVisit, EditAndRegisterHomeVisit, CreateEstimate) — add `"combo"` to the `item_type` union and render a 🧩 icon next to combo names in the dropdown. The selection handler logic itself is generic.
- `PhleboExportDialog.tsx` — include combos in incentive map ("(Combo)" suffix).

### 6. Billing / report / phlebo behavior
No special-cased pricing. Combos use their own `price` like Health Check-Ups, get expanded to leaf tests for sample tubes & technical modules, and appear with their `combo_name` (or `display_name`) in invoices/reports.

## Files
- **MIGRATION** new SQL: combos + combo_tests + combo_profiles + sequence + auto-code trigger + RLS.
- **NEW** `src/lib/combos.ts`
- **NEW** `src/components/ComboManagement.tsx`
- **EDIT** `src/pages/TestManagement.tsx` — add tab.
- **EDIT** `src/lib/allSelectableTests.ts` — fetch + emit `item_type: "combo"`.
- **EDIT** `src/lib/sampleTubeGrouping.ts` — expand combos like packages.
- **EDIT** the 8 selection components — extend `item_type` union + 🧩 icon.
- **EDIT** `src/components/PhleboExportDialog.tsx` — combo incentives.

## Out of scope (ask if you want)
- Excel template/import for combos.
- Bulk price editor.
- Combos referencing other combos (nested combos).

