
Fix the cancellation behavior so shared tubes are edited, not deleted.

What’s happening now
- I checked the live data for bill `2604150004`.
- CBC and HBA1C both use the same tube definition: `EDTA / PURPLE / WHOLE BLOOD`.
- `sample_tubes` stores one row per physical tube with `test_ids` and `test_names` arrays.
- The current cancellation code in `EditRegistrationDialog.tsx` deletes any tube row whose `test_ids` contains the cancelled test.
- That is correct only when the cancelled test is the only test in that tube. It is wrong for shared tubes, because cancelling CBC also removes the HBA1C tube row.

Evidence from code
- `PatientRegistration.tsx` groups tests into shared tubes by `sample_tube + suffix`.
- `EditRegistrationDialog.tsx` currently does:
  - fetch registration tubes
  - if `tube.test_ids.includes(testId)` → delete full tube row
- `SampleCollection.tsx` then only renders whatever tube rows still exist, so HBA1C disappears too.

Implementation plan
1. Update cancellation cleanup in `src/components/lims/EditRegistrationDialog.tsx`
- Replace full-tube deletion with partial tube update logic.
- For each affected tube:
  - remove only the cancelled `testId` from `test_ids`
  - remove only the matching test name from `test_names`
  - if other tests remain, `update` the tube row
  - if no tests remain, then `delete` the tube row
- Keep the existing downstream cleanup for:
  - `patient_results`
  - `outsourced_test_snips`
  - `lims_test_orders`
- Keep `recalculateRegistrationStatus` and query invalidations.

2. Make the tube update robust
- Build a `testNameById` map from `reg.tests` so the code knows which display name to remove.
- Prefer filtering `test_ids` first, then rebuild `test_names` in the same order from remaining active IDs.
- This avoids index mismatch bugs if names and ids arrays ever drift.

3. Add safety filtering in `src/components/lims/SampleCollection.tsx`
- Keep the existing “hide fully cancelled tube” logic.
- Improve it so a partially cancelled tube is still shown, but only with active tests displayed.
- Add a derived helper that returns:
  - active `test_ids`
  - active `test_names`
  after excluding cancelled tests.
- Use those derived values in the UI instead of raw `tube.test_names`.
- Result:
  - if tube has only cancelled tests → hidden
  - if tube has CBC + HBA1C and CBC is cancelled → tube still visible, showing HBA1C only

4. Apply the same defensive filtering in downstream tube-based views
- `SampleAcceptance.tsx` should also derive active tests per tube before rendering badges and before generating interface orders.
- This prevents old/stale shared-tube rows from accidentally accepting or ordering cancelled tests.
- Acceptance should generate interface orders only for remaining active test IDs.

5. Verify the specific broken case
- Re-test bill `2604150004`:
  - CBC cancelled
  - HBA1C should still appear in Sample Collection on the same purple EDTA tube
  - tube label should show only HBA1C
- Re-test bill `2604150003`:
  - cancelled-only tube should disappear fully
- Also verify Sample Acceptance and interface order generation behave correctly after partial cancellation.

Technical notes
- No database schema change is needed.
- The bug is in application logic, not table structure.
- Core fix is:
  - delete tube only when remaining `test_ids.length === 0`
  - otherwise update the same tube row in place
- This aligns with project memory: technical queues must show only active, non-cancelled tests, while preserving shared tube continuity.
