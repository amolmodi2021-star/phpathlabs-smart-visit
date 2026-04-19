

## Goal
Fix Results Entry (and the rest of the LIMS technical pipeline) so registrations containing **profiles (PRL)** or **health check-ups (HLT)** correctly expand into their leaf tests when looking up parameters and matching against accepted tubes.

## Root cause
- `patient_registrations.tests` stores the **original selection** — for invoice 2604190005 it's just the HLT row `AMOL HLT` (id `9f892dbc-…`).
- `sample_tubes.test_ids` correctly stores the **expanded leaf test IDs** (CBC, HBA1C, T3, T4, TSH, VIT B12, VIT D).
- `ResultsEntry.tsx` line 563 builds `activeTests` by intersecting `reg.tests[*].test_id` with `acceptedTestIds` from tubes. The HLT id is never present in tube ids → no test matches → patient is dropped (line 650 filter).
- `test_parameters` is also keyed by leaf `test_id`, so even if we kept the HLT row, we wouldn't find any params for it.

## Fix
Expand `reg.tests` into leaf tests at read time using the same logic the registration uses to build tubes — but with one important change: **derive the leaf test list from the existing `sample_tubes.test_ids`** (which already represent the correct, expanded leaves for that registration). This is bullet-proof because:
- It works for old registrations created before the tube-grouping fix (the data we just repaired for older invoices).
- It works for any future profile/HLT/test mix.
- It doesn't require re-fetching `billing_profile_tests` / `health_checkup_tests` at result-entry time.

### Approach
In each module's data builder, for any registration test row whose `test_id` is **not** found in tube `test_ids` (i.e., it's an HLT/PRL container), replace it with synthetic test rows for every leaf `test_id` in that registration's tubes that isn't already in `reg.tests`.

Concretely in `ResultsEntry.tsx`:

```ts
// Build a working tests list that includes leaf tests from tubes
const tubeTestIds = acceptedTestIds ? Array.from(acceptedTestIds) : [];
const directTestIds = new Set(tests.map((t: any) => t.test_id));
const isContainer = (id: string) => !tubeTestIds.includes(id);
const leafExtras = tubeTestIds
  .filter((id) => !directTestIds.has(id))
  .map((id) => ({ test_id: id, test_name: testsMap[id]?.test_name || "" }));
const expandedTests = [
  ...tests.filter((t: any) => !isContainer(t.test_id)), // keep direct leaf tests
  ...leafExtras, // add leaves derived from tubes (covers HLT/PRL contents)
];
const activeTests = expandedTests.filter((t: any) => !cancelledIds.has(t.test_id) && acceptedTestIds?.has(t.test_id));
```

This:
- Drops the HLT container row (it has no params anyway).
- Pulls in every leaf test that has an accepted tube → those have parameters in `test_parameters` → Results Entry shows them.
- Preserves cancellation and acceptance filtering.

### Modules to apply the same expansion
The exact same `reg.tests` walk pattern exists in every technical-stage module. To keep the LIMS internally consistent, apply the same expansion there:

1. **`src/components/lims/ResultsEntry.tsx`** — primary fix (line 558–651).
2. **`src/components/lims/SampleAcceptance.tsx`** — patient/test listing.
3. **`src/components/lims/ResultVerification.tsx`** — verification list.
4. **`src/components/lims/DoctorApproval.tsx`** — approval list.
5. **`src/components/lims/Dispatch.tsx`** — only if it iterates tests for selective generation; verify and patch if so.
6. **`src/components/lims/ModifiedApproval.tsx`** — same pattern check.

A single shared helper avoids duplication:

**NEW** `src/lib/expandRegistrationTests.ts`:
```ts
export function expandRegistrationTests(
  regTests: any[],
  tubeTestIds: Set<string>,
  testsMap: Record<string, any>,
): { test_id: string; test_name: string }[] {
  const direct = regTests.filter((t) => tubeTestIds.has(t.test_id));
  const directIds = new Set(direct.map((t) => t.test_id));
  const extras = Array.from(tubeTestIds)
    .filter((id) => !directIds.has(id))
    .map((id) => ({ test_id: id, test_name: testsMap[id]?.test_name || "" }));
  return [...direct, ...extras];
}
```

Each module then calls `expandRegistrationTests(reg.tests, acceptedTestIdsByReg[reg.id] ?? new Set(), testsMap)` before any per-test loop.

### Verification step for invoice 2604190005
After the fix, the registration should appear in Results Entry with the seven leaf tests (CBC, HBA1C, VIT B12, VIT D, T3, T4, TSH) grouped under the EDTA and PLAIN tubes — with parameters loaded from `test_parameters` for each leaf.

## Out of scope
- No DB migration needed; the data on `sample_tubes` is already correct.
- We do **not** rewrite `patient_registrations.tests` — keeping the original HLT/PRL container is required for billing accuracy, invoice display, and pricing.
- Sample Collection / billing screens that show "AMOL HLT" as a single billable line continue to work unchanged.

## Files
- NEW `src/lib/expandRegistrationTests.ts`
- EDIT `src/components/lims/ResultsEntry.tsx`
- EDIT `src/components/lims/SampleAcceptance.tsx`
- EDIT `src/components/lims/ResultVerification.tsx`
- EDIT `src/components/lims/DoctorApproval.tsx`
- EDIT `src/components/lims/ModifiedApproval.tsx`
- EDIT `src/components/lims/Dispatch.tsx` (only if needed after re-inspection)

## Expected outcome
Invoice 2604190005 (AMOL MODI / AMOL HLT) appears in Results Entry with all seven leaf tests' parameters ready for entry. The same fix carries the patient through Verification, Approval and Dispatch correctly. Future HLT/PRL registrations work end-to-end with no manual repair.

