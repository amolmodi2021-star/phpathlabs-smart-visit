# Fix: Modified Approval edits don't persist for some tests

## What the user sees
- In Modified Approval, you edit a result value and save.
- The PDF report shows the new value (because the snapshot in `approved_reports` is updated).
- But when you reopen the record in Modified Approval, the field is blank again — because the underlying `patient_results` row was never updated.

## Root cause
`ModifiedApproval.tsx` builds the parameter list for each test by combining:
1. Real rows from `patient_results` (these have a real `id`).
2. **Synthetic rows** injected from the test definition for parameters that had no saved `patient_results` row (calculated params that didn't auto-evaluate, params skipped during entry, etc.). These rows are tagged `__synthetic: true` and have **no `id`**.

In `saveChanges`, every param goes through:
```ts
await supabase.from("patient_results")
  .update({ result_value: ... })
  .eq("id", p.id);   // ← p.id is undefined for synthetic rows
```
For synthetic rows `p.id` is `undefined`, so the update silently affects nothing. The new value still gets pushed into the `approved_reports.test_results` JSONB snapshot (which the PDF reads), but `patient_results` never receives a row — so the next time Modified Approval loads from `patient_results`, the field is blank again.

## Fix
In `src/components/lims/ModifiedApproval.tsx` → `saveChanges`:

- For each param row, branch on whether `p.id` exists:
  - **Has `p.id`** (real row): keep current `.update().eq("id", p.id)` behaviour.
  - **No `p.id`** (synthetic row, only when the user actually entered a value — i.e. `newValue` is non-empty): `insert` a new `patient_results` row with:
    - `registration_id: regId`
    - `test_id: p.test_id`
    - `parameter_id: p.parameter_id`
    - `param_code`, `parameter_name`, `unit`, `reference_range`, `normal_range_low`, `normal_range_high` from `p`
    - `result_value`, `flag`, `note`, `test_note` from the edited values
    - `status: "approved"` (matches what the loader filters on at line 66)
    - `verified_by` / `approved_by` / timestamps mirroring how the original approval flow stamps them — copy the same fields used by `DoctorApproval` when it first writes approved rows, so the new row is indistinguishable from one created via the normal flow.
  - **No `p.id` and `newValue` is empty**: skip — nothing to persist.

- Keep the existing `approved_reports` snapshot rewrite as-is (it already handles synthetic rows correctly).

## Verification step (during implementation)
- Open `src/components/lims/DoctorApproval.tsx` to copy the exact field set it writes when creating approved `patient_results` rows, so the inserted row matches schema (especially audit columns like `verified_by`, `approved_by`, `verified_at`, `approved_at`).

## Files to change
- `src/components/lims/ModifiedApproval.tsx` — single function: `saveChanges`.

No DB migration, no schema change, no other components affected.
