## Goal

In the LIMS bidirectional interface, only push parameters to the analyzer that are explicitly marked **"Send for Interface"** in Test Management. Today, when a test contains a mix of interface and non-interface parameters, the order is created correctly (only the flagged subset). But when a test's parameters are ALL non-interface (e.g. all manual or all calculated), the code falls back and orders the **entire test** as a single line — which is wrong: the analyzer then queues a job that no operator wants.

## Current Behaviour

`SampleAcceptance.tsx` builds the LIMS order at sample-acceptance time (lines 213–247):

```
for each accepted tube:
  for each active test on the tube:
    if testParamData[testId] has interface-flagged params → push those params
    else → push the test itself as a single order line   ← BUG
```

The `else` branch is meant for tests with no parameters at all (single-result outsourced tests). It accidentally fires for tests whose parameters exist but none has `send_for_interface = true`.

## Plan

### 1. Track full parameter set, not just interface-flagged ones

In `SampleAcceptance.tsx` `testParamData` query, build the per-test map with two pieces of information:

- `hasAnyParam` — whether the test has any parameter rows at all
- `params` — the subset where `send_for_interface = true` (unchanged shape)

### 2. Tighten the order-creation rules

When iterating over each active test for a tube:

- **If interface-flagged params exist** → push them (current correct behaviour).
- **Else if the test has parameters but none are interface-flagged** → skip entirely. No order line, nothing queued for the analyzer.
- **Else (test has zero parameters defined)** → push the test as a single line. Preserves the current behaviour for snip-only / outsourced single-result tests.

If a tube ends up with zero `orderTests` after this filtering, the `lims_test_orders` insert is skipped (already handled by the existing `if (orderTests.length > 0)` guard), so no empty order is ever written.

### 3. Reprocess path (defensive)

Quick scan of `lims-interface/index.ts` reprocess action to confirm it does not regenerate orders from registrations (it only bridges already-received results into `patient_results`). No change needed there. Order rows in the DB that were created before this fix will continue to live until the analyzer marks them complete or they are manually deleted — no migration required.

## Files to Edit

- `src/components/lims/SampleAcceptance.tsx` — update `testParamData` shape and the order-creation loop.

## Out of Scope

- No changes to Test Management UI (the `Send for Interface` checkbox already exists per parameter).
- No DB migration. No edge-function change.
- Existing pending orders in `lims_test_orders` are left as-is. If you want them cleaned up, that can be done separately.
