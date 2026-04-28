# Fix: Outsourced tab missing patients whose transferred test belongs to a profile/checkup

## The bug

For invoice **2604280014 (NAYNA JARIWALA)**:
- `patient_registrations.tests` contains only **SEHAT 3** (a Health Check-up container, id `e5c265f2…`)
- The user clicked "Transfer to Outsource" on the leaf test **URINE ROUTINE EXAMINATION** (id `45f430ee…`), which lives inside SEHAT 3
- A row was correctly inserted into `outsourced_test_snips` with `test_id = 45f430ee…`
- But the **Outsourced Results** tab does not show this patient

## Root cause

`src/components/lims/OutsourcedResults.tsx` builds its patient list by iterating `reg.tests` directly (around line 283) and only emits a row when one of those `test_id`s matches a snip / is naturally outsourced / has a param-level snip.

Since `reg.tests` for this patient only contains the SEHAT 3 container — and never the leaf URINE ROUTINE — the snip's `test_id` (`45f430ee…`) is never matched, so no entry is produced. The same problem affects every transferred-to-outsourced or param-level-outsourced leaf that came from a Profile (PRL) or Health Check-up (HLT) container.

Every other technical-stage screen (Results Entry, Verification, Doctor Approval, Dispatch) already solves this by calling `expandRegistrationTests(reg.tests, leafTestIds, testsMap)` from `src/lib/expandRegistrationTests.ts`, with `leafTestIds` taken from the union of `sample_tubes.test_ids` for that registration. OutsourcedResults is the only screen that skipped this expansion.

## Fix

Update `src/components/lims/OutsourcedResults.tsx`:

1. Add a new query that fetches `sample_tubes(registration_id, test_ids)` for the visible `regIds` and builds a `Record<regId, Set<leafTestId>>` map.
2. In the `patientEntries` `useMemo`, replace the direct `reg.tests` iteration with `expandRegistrationTests(reg.tests, leafTestIds, testsMap)` so leaf tests from PRL/HLT containers are included.
3. Keep the existing logic that decides whether each leaf is naturally outsourced, transferred-from-inhouse, or parameter-level — it now operates on the expanded leaf list, so the URINE ROUTINE snip will match.
4. No schema changes; no other files need editing — `getSnip`, `getOutsourceStatus`, `hasManualResults`, etc. are already keyed by `(regId, testId)` of the leaf.

## Verification after fix

- NAYNA JARIWALA (`2604280014`) appears in the Outsourced Results tab under "Not Sent" with URINE ROUTINE EXAMINATION listed (caption: "Transferred from Inhouse").
- Existing naturally-outsourced tests and param-level outsourced rows continue to display unchanged.
- Returning a transferred leaf to inhouse still removes it from the list.
