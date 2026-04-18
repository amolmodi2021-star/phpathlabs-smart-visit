
## Goal
Ensure descriptive (and any) result text saved in Results Entry survives the round trip:
**Results Entry → Save & Send → Verification → Send Back → Results Entry** — the same text must reappear in Results Entry, and identically continue forward again to Verification and Doctor Approval.

## Investigation summary
Traced the full data flow:

- `Save & Send to Verification` (Results Entry) does `delete + insert` on `patient_results` with `status="entered"` and writes `result_value: value || null`. ✅ value persists.
- `Send Back` in Result Verification (`src/components/lims/ResultVerification.tsx` line 646–660) only runs `update({ status: "pending" })` — it does **not** touch `result_value`. ✅ value preserved in DB.
- `Send Back for verification` in Doctor Approval (`src/components/lims/DoctorApproval.tsx` line 497–507) only runs `update({ status: "entered" })`. ✅ value preserved.
- Results Entry's `existingResults` query (`select * from patient_results … in regIds`) loads ALL statuses including `pending`, and `param.resultValue = existing?.result_value || ""` populates the UI from DB.

So the DB row is preserved. The "text disappears" symptom in Results Entry after Send Back is caused by **two specific UI state issues**:

### Bug 1 — Skip rule keeps the test hidden
`src/components/lims/ResultsEntry.tsx` line 604:
```js
if (testParamResults.every(({ existing }) => existing?.status === "entered")) continue;
```
Reverse case: after Send Back, every param flips to `pending`, so the test correctly reappears. ✅ no fix needed here.

### Bug 2 — Stale React Query cache makes UI think the test is still "entered"
`sendBackTest` invalidates `patient_results_existing`, but the **Results Entry tab is unmounted** while the user is on Verification. When they switch back, the cache key contains the previous `regIds.join(",")` — same key, refetches fine. But the **registration row's `status` column** was last set during verification and is **not** updated by `sendBackTest`. So the registration may be at `processing`/`partial_verified` etc. and the patient still shows in Results Entry. The test, however, is rebuilt from DB rows whose `status` is now `pending` and whose `result_value` IS the saved text. UI should populate.

The actual gap: **after Send Back, the Results Entry's accepted-regs query is keyed only on `[debouncedSearch, rePage]` and is NOT invalidated**. If the patient's registration was paged out (e.g. moved to next page based on `updated_at` ordering), the test silently disappears. More critically, the **secondary query `results_outsourced_snips` and `patient_results_existing` are invalidated, but `results_accepted_regs` is NOT**, so any data dependent on freshly recomputed registration ordering can show a phantom row using old `tests`/`status` snapshot — for descriptive params this manifests as a re-render with `existingResults` not yet matched up against `regIds`, briefly showing blank, and any in-flight `editedValues` state being stale.

### Bug 3 (root cause for "text disappears") — `recalculateRegistrationStatus` not called on send-back
After Send Back, the registration's overall `status` should drop back from `processed` → `processing` (or `verified` → `partial_verified`). Currently neither `ResultVerification.sendBackTest` nor `DoctorApproval.sendBackForVerification` calls `recalculateRegistrationStatus(regId)`. As a result, the registration may stay at `verified` / `processed`, and the patient row in Results Entry is pulled from a stale list where the just-reverted test no longer appears as accepted-but-pending — leading to the "blank/missing" symptom the user observes.

## Fix plan

### 1. `src/components/lims/ResultVerification.tsx` — `sendBackTest`
- After the two `update` calls, call `await recalculateRegistrationStatus(regId)` so the parent `patient_registrations.status` reflects the reverted test.
- Add `qc.invalidateQueries({ queryKey: ["results_accepted_regs"] })` and `["verification_regs_v2"]` so both source lists refresh.

### 2. `src/components/lims/DoctorApproval.tsx` — `sendBackForVerification`
- Same: `await recalculateRegistrationStatus(regId)` after the updates.
- `invalidateAll()` already covers most queries; explicitly add `["verification_results_v2"]`, `["results_accepted_regs"]`, and `["patient_results_existing"]`.

### 3. `src/components/lims/ResultsEntry.tsx` — defensive read
- Line 626: change `resultValue: existing?.result_value || ""` to `resultValue: existing?.result_value ?? ""` so a saved empty-string value (rare, but possible for descriptive) is still treated correctly and a `null` falls through to "". (No behavioral change for normal cases; protects edge cases.)
- Line 604: tighten the skip rule so a test with mixed statuses (some `entered`, some `pending` after partial send-back) still appears in Results Entry — change `every(... === "entered")` to `every(... === "entered") && testParamResults.length === testParams.filter(tp => !tp.is_subheader && tp.report_test_parameters).length` (already equivalent, but make the intent explicit and skip ONLY when nothing reverted).

### 4. `src/components/lims/ResultVerification.tsx` — clear local edits on Send Back
- After Send Back, also clear `editedValues`, `editedFlags`, `editedUnits`, `editedRefRanges`, `editedNotes` for keys belonging to the sent-back test, so when the user revisits Verification later (after re-sending from Entry), they see the freshly persisted DB value, not stale local edits.

### 5. Same edit-state cleanup in `DoctorApproval.tsx` Send Back

## Files to edit
- `src/components/lims/ResultVerification.tsx` — `sendBackTest` (~line 646–660): add `recalculateRegistrationStatus` import-already-present call, expand cache invalidation, clear local edit state for sent-back test.
- `src/components/lims/DoctorApproval.tsx` — `sendBackForVerification` (~line 497–507): same three additions.
- `src/components/lims/ResultsEntry.tsx` — minor defensive change at line 626 (`||` → `??`) and a clarifying guard at line 604.

## Out of scope
- `DescriptiveCombobox` itself — already correct.
- Numeric / qualitative inputs.
- Schema / RLS / edge function changes.
- Doctor Approval → Modified Approval flow (separate path, already preserves values via `approved_reports` archive).

## Expected outcome
- Click **Send Back** in Result Verification → registration status auto-recomputes → Results Entry tab now shows the test with the **exact descriptive (or any) text that was saved**, fully editable.
- Click **Send Back** in Doctor Approval → same, reappears in Verification with original text intact.
- Re-sending the test forward (Entry → Verify → Approve) shows identical text at every stage.
- No data loss, no blanks, no stale UI cache.
