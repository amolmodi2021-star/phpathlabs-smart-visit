

# Plan: Allow Snip-Only Outsourced Tests (No Parameters) Through Full Pipeline

## Problem
Outsourced tests configured in Test Management with no linked parameters get stuck in Results Entry. When results are entered via snipping, the system still shows "No parameters configured" and blocks the Save & Verify flow because it requires at least one parameter.

## Solution
Treat outsourced snip-only tests (with snip images but no parameters) as valid entries that can flow through Results → Verification → Doctor Approval → Dispatch. Instead of requiring parameter-based results, the snip image itself is the result.

## Technical Changes

### 1. ResultsEntry.tsx — Allow snip-only outsourced tests to appear and be saved

**Build logic (~line 470-475)**: When a test has 0 parameters but IS outsourced (has a snip record with images), do NOT push it to `incompleteTests`. Instead, create a synthetic "snip-only" marker so the test appears with its snip badge and a Save & Verify button.

- Add a new field `snipOnlyTests` to `PatientEntry` (array of `{ testId, testName, labName, snipUrls, outsourceStatus }`)
- In the build loop: if `validParams.length === 0` AND the test has an outsourced snip record with images → add to `snipOnlyTests` instead of `incompleteTests`
- Update filter: `.filter(entry => entry.parameters.length > 0 || entry.incompleteTests.length > 0 || entry.snipOnlyTests.length > 0)`

**Save mutation (~line 686-734)**: When `upserts.length === 0` but the test has a snip record, do NOT bail out. Instead, just update the `outsourced_test_snips` status to `results_entered`.

**UI rendering**: Render snip-only tests as a row showing the test name, outsourced badge, snip preview thumbnail, and Save & Verify button (no parameter table needed).

**handleSaveAndVerify**: If the test has 0 parameters (snip-only), skip the blank check and directly trigger the save mutation.

### 2. ResultVerification.tsx — Show snip-only tests

**Build logic (~line 277-326)**: Similarly, when a test has no parameters but has a snip detail with `outsource_status = 'results_entered'`, include it as a snip-only entry.

- Add `snipOnlyTests` to the entry structure
- Update filter: allow entries with `snipOnlyTests.length > 0`
- Render snip-only tests with the snip image preview and a Verify button
- Verify action: update `outsourced_test_snips.outsource_status` to `verified`

### 3. DoctorApproval.tsx — Show snip-only tests

**Build logic (~line 125-167)**: Same pattern — include tests with snip detail at `outsource_status = 'verified'` even when they have no parameters.

- Add `snipOnlyTests` to entry structure
- Render with snip preview and Approve/Send Back buttons
- Approve action: update status to `approved`

### 4. Dispatch.tsx — Recognize snip-only approved tests

The dispatch section already determines test status from outsourced snip records, so snip-only tests with `outsource_status = 'approved'` should naturally appear. Verify the status determination logic handles the case where there are no `patient_results` rows but the snip record shows `approved`.

## Files Changed
- `src/components/lims/ResultsEntry.tsx` — snipOnlyTests support in build, save, and render
- `src/components/lims/ResultVerification.tsx` — snipOnlyTests support in build and render
- `src/components/lims/DoctorApproval.tsx` — snipOnlyTests support in build and render
- `src/components/lims/Dispatch.tsx` — minor check for snip-only status recognition

