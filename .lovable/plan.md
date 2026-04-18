
## Goal
When a user edits result text/flag/unit/ref-range/note in **Result Verification** or **Doctor Approval** and then clicks **Send Back**, the edited values must be **persisted to the DB first**, so they appear in the previous stage (Results Entry / Verification) and then carry forward again unchanged.

## Root cause
Currently both `sendBackTest` (Verification) and `sendBackForVerification` (Doctor Approval) only run:
```
update({ status: "pending" / "entered" })
```
They never persist the user's local edits (`editedValues`, `editedFlags`, `editedUnits`, `editedRefRanges`, `editedNotes`). After send-back, the local edit state is also cleared — so the edits are lost completely. The previous stage shows the **original** value that was last saved, not what the verifier/doctor changed.

## Fix plan

### 1. `src/components/lims/ResultVerification.tsx` — `sendBackTest` (~line 646)
Before flipping status, persist edits for that test in a single delete+insert (mirroring how `verifyAllForPatient` writes rows):
- Find the patient entry + parameters for `(regId, testId)`.
- Build an `upserts` array. For each parameter `p`, key `k = ${regId}||${p.parameterId}`:
  - `result_value` = `editedValues[k] ?? p.resultValue` (then `|| null`)
  - `flag` = `editedFlags[k] ?? p.flag ?? autoFlag` (only if outsourced, else recompute)
  - `unit` = `editedUnits[k] ?? p.unit`
  - `reference_range` = `editedRefRanges[k] ?? p.referenceRange`
  - `note` = `editedNotes[k] ?? p.note`
  - `status: "pending"`, preserve `entered_at`, `entered_by`, clear `verified_at`/`verified_by`.
- `delete` rows where `(registration_id, test_id, status in ['entered','pending'])` then `insert` the upserts. (Rather than the current bare `update`.)
- Then run existing `outsourced_test_snips` update, `recalculateRegistrationStatus`, cache invalidations, local-state cleanup. Keep the local-state cleanup so re-render reads from the freshly persisted DB rows.

### 2. `src/components/lims/DoctorApproval.tsx` — `sendBackForVerification` (~line 500)
Same pattern, but flipping `verified` → `entered`:
- Build `upserts` from current parameters + edits.
- `result_value` / `unit` / `reference_range` / `flag` / `note` use `editedX[k] ?? p.X`.
- `status: "entered"`, preserve `entered_at`/`entered_by`, clear `verified_at`/`verified_by`.
- Delete current `(regId, testId, status='verified')` rows, insert new ones.
- Continue with snip status update, `recalculateRegistrationStatus`, `invalidateAll`, local-state cleanup.

### 3. Re-display in previous stage works automatically
- Results Entry already reads `result_value` from `patient_results` via `existing?.result_value ?? ""` — it will now show the verifier's edited text.
- Result Verification reads via the same `patient_results` query — it will now show the doctor's edited text after Doctor Approval send-back.
- `DescriptiveCombobox` is already an editable input, so any free text (predefined or hand-typed) renders correctly.

### 4. Carry-forward guarantee
Re-sending forward (Entry → Verify, or Verify → Approve) already does delete+insert from current values, so the just-persisted edits flow forward unchanged — same identical text at every stage.

## Files to edit
- `src/components/lims/ResultVerification.tsx` — rewrite `sendBackTest` to persist edits before status flip.
- `src/components/lims/DoctorApproval.tsx` — rewrite `sendBackForVerification` to persist edits before status flip.

## Out of scope
- Forward `Save & Send` / `Verify` flows — already persist edits correctly.
- `DescriptiveCombobox`, schema, RLS, edge functions, recalculation logic.

## Expected outcome
- Edit any field in Verification → click Send Back → Results Entry shows the **edited** value (not the original).
- Edit any field in Doctor Approval → click Send Back → Verification shows the **edited** value.
- Re-send forward → identical edited text appears in the next stage.
- Works for descriptive, numeric, qualitative, and outsourced fields uniformly.
