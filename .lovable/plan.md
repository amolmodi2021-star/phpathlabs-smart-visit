
## Goal

Whenever a test contains any of the differential-count parameters
**PRM0090, PRM0080, PRM0086, PRM0048, PRM0019**, the sum of their result values
should equal **100**. If it doesn't, show a confirmation dialog that:

- Reports the current sum.
- Reports the difference using the user's sign convention:
  - sum 98 → show **2** (less)
  - sum 103 → show **-3** (more)
  - i.e. `100 − sum`
- Lets the user **Cancel** or **Continue Anyway** (save still proceeds).

This validation must fire on every save action in:
1. **Results Entry** — `Save & Send to Verification` (per-test)
2. **Result Verification** — `Verify Test` and `Verify All`
3. **Doctor Approval** — single-test approve and bulk approve
4. **Modified Approval** — re-approve

## Files to change

### New file: `src/lib/differentialCount.ts`
Shared helper used by all four components.

```ts
export const DIFFERENTIAL_PARAM_CODES = [
  "PRM0090", "PRM0080", "PRM0086", "PRM0048", "PRM0019",
];

export interface DiffCheckParam {
  paramCode?: string | null;
  value: string | number | null | undefined;
}

export interface DiffCheckResult {
  hasDifferential: boolean; // any of the 5 codes present
  sum: number;
  diff: number;             // 100 - sum (positive = less, negative = more)
  isOk: boolean;            // sum === 100 (with small tolerance)
  presentCodes: string[];
}

export function checkDifferentialSum(params: DiffCheckParam[]): DiffCheckResult;
```

The helper:
- Filters params whose `paramCode` is in the differential set.
- Parses each `value` with `parseFloat` (ignores empty / non-numeric → 0).
- Returns `isOk = Math.abs(100 - sum) < 0.001`.

### `src/components/lims/ResultsEntry.tsx`
- In `handleSaveAndVerify` (line ~1029): after the existing blank-check branch decides to save, compute `checkDifferentialSum` on the test's params using the same `editedValues / p.resultValue` resolution already used for blanks.
- If `hasDifferential && !isOk`, open a new `<Dialog>` (state `diffConfirm: { entry, testId, sum, diff, testName } | null`) instead of calling `saveMutation.mutate`. Dialog shows:
  > "Differential count for **{testName}** is **{sum}**. Difference to 100: **{diff}**."
  with **Cancel** + **Continue Anyway** buttons. "Continue" closes dialog and runs `saveMutation.mutate({ entry, testId })`.
- If existing blank-confirm dialog also fires, run the differential check after the user confirms blanks too (chain: blanks dialog → diff dialog → save).

### `src/components/lims/ResultVerification.tsx`
- In `handleVerifyTest` (line 628) and `handleVerifyAll` (line 654): before invoking the verify mutation, run `checkDifferentialSum` over the involved params (per-test for Verify Test; per-test loop for Verify All — show one dialog listing each offending test, OR sequentially confirm — see "Verify All" note below).
- Add `diffConfirm` state + Dialog mirroring Results Entry.
- **Verify All:** aggregate offending tests into a single dialog body listing each `{testName} → sum X (diff Y)` and a single "Continue Anyway" button that proceeds with the original verify-all flow.

### `src/components/lims/DoctorApproval.tsx`
- Single approve (line ~480 mutation invocation site) and bulk approve (line ~560): same pattern. Run `checkDifferentialSum` per test prior to opening the approver-selection dialog (or right before the actual upsert — placement: right before `saveMutation`/approve action triggers, so the user sees the warning even after picking an approver).
- Recommended placement: just before the action that currently calls the approver dialog or upserts. Add `diffConfirm` state + Dialog. On "Continue Anyway", resume the original code path (store the pending action in state and re-invoke).

### `src/components/lims/ModifiedApproval.tsx`
- The re-approve action around line 356–369: same pattern. Add `diffConfirm` state + Dialog, intercept the upsert, allow continue.

## Dialog UX (consistent across all four screens)

```
Title: Differential Count Mismatch
Body:  Test: <Test Name>
       Current sum: <sum>
       Difference to 100: <diff>   ← positive = less, negative = more
       The sum should be exactly 100.
Footer: [Cancel]  [Continue Anyway]
```

Use existing `Dialog` (or `AlertDialog`) imports already present in each file; no new shadcn components required.

## Notes / scope guards

- Validation is **warn-only** — never blocks save (per requirement).
- If a test contains zero differential-count params, dialog never shows.
- Numeric parsing only — non-numeric values count as 0 (matches user intent of "sum"; blanks are still flagged by the existing blank-check workflow).
- No DB migration; param codes already live in `report_test_parameters.param_code` and are already loaded into each component's param list as `paramCode`.
- No realtime / propagation changes.
