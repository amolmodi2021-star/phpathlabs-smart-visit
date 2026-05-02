## Problem

Two related issues in **LIMS → Results → Outsourced** section:

1. **Saved values disappear on reopen.** After entering and saving manual results for an outsourced test, reopening the same test shows a blank entry table. The data is in the database, but the UI hides every parameter that already has a value.

2. **Tests pushed back from Verification disappear from Outsourced.** When Verification sends a record back, the snip's `outsource_status` is correctly reset to `results_saved`, but the Outsourced patient-card filter then hides the test because "all params still have values" — so the user has nowhere to re-edit it.

The second behaviour the user described — *tests should not appear in Outsourced once moved to Verification* — is already working correctly (`results_entered` / `verified` / `approved` / `dispatched` snip statuses are filtered out). No change needed there.

## Root cause

`src/components/lims/OutsourcedResults.tsx`:

- **Line ~964** (manual entry table): rows are returned `null` when an existing saved value exists, instead of pre-filling and allowing edit.
- **Line ~1080-1090** (`visibleTests` filter for `results_saved` manual mode): hides the test when `hasAllResultsFilled` is true, which is always true after a send-back from Verification because the values remain (only `status` flips back to `pending`).

## Fix

### Single file: `src/components/lims/OutsourcedResults.tsx`

**1. Manual entry table — render saved values, don't hide them**

Replace the early `return null` for rows that have a saved value. Always render the row pre-filled with the existing value (or the in-memory edit), so on reopen the user sees what was saved and can edit it.

**2. Card visibility — keep showing tests after send-back**

Adjust the `visibleTests` filter so a `results_saved` test in **manual** mode stays visible whenever any of its `patient_results` rows are at `status='pending'` (which is exactly the state Verification leaves them in after pushing back). If all rows are still `verified`/`approved`/etc., keep the existing "hide" behaviour so the Outsourced list isn't cluttered with already-finalised work.

Same logic for the stats counter (`stats` memo) so the "Results Saved" count stays accurate.

**3. Save flow — preserve the just-saved values in `editedValues`**

After `saveManualResults` succeeds, **stop wiping** the edited values for that registration. This avoids a flash of blank inputs immediately after save, and the next reopen will render directly from `existingResults` anyway.

(Alternative considered: re-seeding `editedValues` from `existingResults` on expand. Rejected — pre-filling from `existing.result_value` directly in the row render is simpler and avoids stale state.)

## Out of scope

- No DB migration. No change to verification / save-and-verify / send-back logic in `ResultsEntry.tsx` or `ResultVerification.tsx` — those already set the correct `outsource_status` transitions.
- No change to the patient-row layout, sort order, or age/gender badge.
- No change to snip-mode behaviour (snip pages already persist visibly on reopen).
