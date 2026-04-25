## Problem

Two related bugs are causing units to be appended to result values for **all** range types (numeric, qualitative, descriptive, text), instead of only "undefined":

1. **Edge function `lims-interface`** uses a fallback heuristic (`applyInterfaceUnitSuffix` checks "no numeric bounds") instead of checking `range_type`. This wrongly suffixes:
   - Qualitative parameters (e.g. POSITIVE/NEGATIVE) — no numeric bounds
   - Descriptive parameters — no numeric bounds
   - Text-range parameters that happen to lack low/high
2. **Same edge function** stores the unit field as `sr.unit || param.unit` — preferring the interface-supplied unit over the configured Test Management unit.

Manual entry components (`ResultsEntry`, `ResultVerification`, `DoctorApproval`, `ModifiedApproval`) already correctly gate `applyUnitSuffix` on `rangeType === "undefined"`, so those are fine and stay untouched.

## Required behavior (restated)

- **Unit suffix on result_value**: ONLY when parameter's `range_type === "undefined"` AND the parameter has a configured unit.
- If undefined-range parameter has no unit → store the raw value, no suffix.
- **Unit field stored**: ALWAYS the unit configured in Test Management (`param.unit`). Ignore any unit sent by the interface/instrument.

## Changes

### `supabase/functions/lims-interface/index.ts`

1. Add `range_type` to the two `report_test_parameters` SELECT columns (lines 197 and 617).
2. Rewrite `applyInterfaceUnitSuffix` (lines 44–53) to:
   ```ts
   function applyInterfaceUnitSuffix(value: string, param: any): string {
     if (!value) return value;
     if (param?.range_type !== "undefined") return value;
     const u = (param?.unit || "").toString().trim();
     if (!u) return value;
     const trimmed = value.trim();
     if (trimmed.toLowerCase().endsWith(u.toLowerCase())) return trimmed;
     return `${trimmed} ${u}`;
   }
   ```
   - Removes the `sr.unit` parameter entirely — only the configured unit is ever used.
   - Replaces the "no numeric bounds" heuristic with an explicit `range_type === "undefined"` check.
3. Update the 4 call-sites (lines 247, 249, 268, 269, 671, 673, 692, 693):
   - `result_value: applyInterfaceUnitSuffix(convertedValue, param)`
   - `unit: param.unit || ""`  (drop the `sr.unit ||` preference so interface-supplied unit is ignored everywhere it lands in `patient_results`)

### Files NOT changed

- `src/components/lims/ResultsEntry.tsx`, `ResultVerification.tsx`, `DoctorApproval.tsx`, `ModifiedApproval.tsx` — their `applyUnitSuffix` already correctly gates on `rangeType === "undefined"`.
- `src/components/report/ReportResultsSection.tsx` — only formats the reference range column, not the result.

## Result

After this fix:
- Numeric, qualitative, descriptive, and text-range parameters will have a clean `result_value` (no unit appended), exactly as before the regression.
- Only "undefined" range-type parameters with a configured unit get `"<value> <unit>"`.
- Interface-supplied units are ignored — Test Management is the single source of truth for the unit field.

Approve to proceed.