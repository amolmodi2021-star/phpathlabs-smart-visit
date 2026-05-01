I found the root cause for invoice 2605010004.

Current database state now has only one result row for the TFT test:

```text
Invoice: 2605010004
Patient: MONIKA GUPTA
Test: THYROID FUNCTION TEST (TFT)
Configured parameters: T3, T4, TSH
Stored result rows now: only TSH = 0.5, status = entered
Registration status: processed
```

This matches your symptom: after entering TSH, the previously entered T3/T4 rows were removed, so T3/T4 appeared again in Result Entry.

Root cause: in `ResultsEntry.tsx`, when only part of a multi-parameter test is currently visible/pending, `Save & Verify` builds an upsert payload only for those visible parameters, but then deletes the entire test's existing `patient_results` rows before inserting the visible subset.

So for TFT:

```text
Step 1: T3/T4 saved -> rows exist for T3/T4
Step 2: Results Entry now shows only pending TSH
Step 3: Save & Verify TSH -> code deletes ALL TFT rows, including T3/T4
Step 4: inserts only TSH
Step 5: T3/T4 appear again
```

## Fix plan

1. Fix the destructive save logic in Result Entry
   - In `src/components/lims/ResultsEntry.tsx`, change `Save & Verify` so it only replaces/upserts the specific parameter rows being saved.
   - It must no longer run `delete where registration_id + test_id` for a partial parameter save.
   - Existing rows for sibling parameters in the same test, like T3/T4 when saving TSH, will be preserved.

2. Fix autosave with the same rule
   - `autoSaveTest` currently has the same full-test delete pattern.
   - Change autosave to upsert/delete only the parameter IDs it is actually saving, so background autosave cannot wipe sibling parameters either.

3. Add a live self-check after Save & Verify
   - After saving a partial test, re-read `patient_results` for that registration/test.
   - Confirm that previously saved sibling rows were not lost.
   - If the database write did not persist correctly, show an error instead of a success toast.

4. Repair invoice 2605010004 safely
   - Preserve the current TSH row.
   - Because the database no longer contains T3/T4 values, I cannot truthfully restore their numeric values unless they exist somewhere else. I will not invent results.
   - I will make sure the invoice is left in a consistent state where T3/T4 can be entered once, then saving them will preserve TSH and move the complete TFT forward.
   - If you remember the T3/T4 values, you can enter them again after the fix; they should not disappear anymore.

5. Recalculate status after repair
   - Run the normal LIMS status recalculation for this registration after the data repair so the row lands in the correct queue.

## Expected result after fix

For multi-parameter tests such as TFT:

```text
Enter T3/T4 -> Save & Verify -> T3/T4 stay stored
Enter TSH   -> Save & Verify -> T3/T4 are preserved + TSH is stored
Then all TFT parameters move together to Verification/Doctor Approval flow
```

This fix does not reintroduce realtime subscriptions or high-frequency polling.