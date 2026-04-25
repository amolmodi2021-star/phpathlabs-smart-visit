## Goal

Calculated parameters (e.g., MCH, MCHC, indirect bilirubin, A/G ratio) should auto-populate the moment their dependent values arrive — whether the value comes from the machine interface or is typed manually by any operator — without anyone clicking the Calculator (Recalculate) button.

## Current Behaviour

- **Manual typing in Results Entry**: `handleValueChange` already recalculates dependent calculated parameters in real time. ✅
- **Interface push (lims-interface edge function)**: The machine result is upserted directly into `patient_results`. The edge function does NOT compute any calculated parameter, and the client only re-evaluates calculations when the user manually edits a field. So the calculated row stays blank until the user opens the test and clicks the Calculator icon. ❌
- **Realtime arrival on another open screen**: Even though `useRealtimeSync("patient_results", ...)` refreshes the cache, the rebuilt `entries` only seed `resultValue` from DB — calculated rows that were never saved remain empty. ❌
- Same problem exists in **Result Verification** and **Doctor Approval** modules (both have a Calculator button but no auto-eval on load).

## Plan

### 1. Server-side auto-calc in `lims-interface` edge function
After the interface push writes/updates one or more `patient_results` rows for a `(registration_id, test_id)`, immediately:

1. Load the test's parameter list with `is_calculated` and `calculation_formula`.
2. Load all current `patient_results` for that `(registration_id, test_id)` to build a `parameter_id → value` map.
3. For every parameter where `is_calculated = true` and a formula exists:
   - Evaluate the formula using the same token logic used on the client (`bracket_open / bracket_close / parameter / fixed_value`, operators `+ - * /`, `toFixed(2)`).
   - If all dependent values resolve to numbers, upsert the calculated row into `patient_results` with `is_calculated: true`, `is_from_interface: false`, `status: "pending"`, `flag` derived from normal range, etc.
   - If any dependent is missing, skip silently (will be tried again on the next interface push).
4. Run this loop iteratively (up to 3 passes) so calculated parameters that themselves depend on other calculated parameters resolve in one shot.

### 2. Client-side auto-evaluation on data load (Results Entry, Result Verification, Doctor Approval)
Add a `useEffect` that runs whenever the `entries` memo rebuilds (i.e., after realtime/refresh):

- For each registration entry, for each calculated parameter whose stored `resultValue` is empty (or stale relative to the current dependent values), evaluate the formula with the current dependent values.
- If a result is produced and differs from the displayed value, write it into `editedValues` and trigger the existing auto-save flow so the new computed value is persisted as `pending` and visible across all sessions.
- A small dirty-check guard prevents re-firing in an infinite loop when the same value is already present.

### 3. Status recalculation
After the edge function inserts auto-calculated rows, call the existing `recalculateRegistrationStatus(registration_id)` helper (the same one already used elsewhere) so the registration status reflects the newly populated values.

### 4. UX
- The Calculator (Recalculate) button stays as a manual override — useful if a user changes a dependent value and wants to force re-evaluation, or wants to trust the manual override instead of the machine value.
- No new buttons or screens. The change is invisible: values just appear.

## Files to Edit

- `supabase/functions/lims-interface/index.ts` — add `evaluateFormula` helper + post-push auto-calc loop and status recalculation.
- `src/components/lims/ResultsEntry.tsx` — add auto-eval effect on entries rebuild.
- `src/components/lims/ResultVerification.tsx` — add auto-eval effect on entries rebuild.
- `src/components/lims/DoctorApproval.tsx` — add auto-eval effect on entries rebuild.

## Out of Scope

- No DB schema changes.
- No changes to formula authoring UI in Test Management.
- No changes to how flags or reference ranges are computed.
