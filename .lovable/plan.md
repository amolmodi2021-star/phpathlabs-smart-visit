

# Fix: Reverse Flow — Snip Removal from Results Entry Should Restore Outsourced Section

## Problem

When a snip image is added in the Outsourced section (sets `outsource_status: results_saved`) and then removed from the Patient-wise/Machine-wise view in Results Entry:
1. The badge turns blue (local UI update), but the **database is not properly updated** — `outsource_status` remains `results_saved` and snip images persist.
2. The patient disappears from the Outsourced section because the `visibleTests` filter sees `results_saved` status and hides the test (thinking results are complete).
3. The counter still shows "Results Saved: 1" due to stale data.

**Root cause**: The `removeSnipImages` function in ResultsEntry updates the snip record with `as any` cast, but the upsert from the outsourced section may be overriding it, or the update is silently not persisting. Additionally, the outsourced section's visibility logic hides `results_saved` tests when snip images exist — but after removal, the status should revert so the test reappears.

## Changes

### 1. ResultsEntry.tsx — Fix `removeSnipImages` function

- After updating the snip record (setting `outsource_status: "sent"`, clearing images), **verify the update succeeded** by checking `count` from the response.
- Also add `outsourced_accepted_regs` and `outsourced_manual_results` to the invalidation list so the outsourced section refreshes properly.
- If the test was parameter-level outsourced (has `outsourcedParameterIds`), keep the snip record but just clear the image data and reset status. Don't delete the snip record itself.

### 2. OutsourcedResults.tsx — Fix visibility logic for reversed tests

- In `getTestStatus`: When `outsource_status` is `"sent"` and `result_mode` is `"manual"` with no manual results, return `"awaiting_results"` (this already works correctly).
- In `visibleTests` filter (line ~1023-1037): Currently hides `results_saved` tests where snip images exist. After removal, status should be `"sent"` so this filter won't apply. But add a safety check: if `results_saved` but no snip images and no manual results, show the test (don't hide it).
- In the stats counter: same fix — don't count a test as `results_saved` if its snip images are empty and it has no manual results.

### 3. OutsourcedResults.tsx — Fix counter accuracy

- In the `stats` memo (line ~728-749): After checking `results_saved`, verify that the test actually has results (snip images OR manual results). If neither exists, treat it as `awaiting_results` instead.

## Summary of File Changes
- **ResultsEntry.tsx**: Enhance `removeSnipImages` to add more query invalidations (`outsourced_accepted_regs`, `outsourced_manual_results`) and add a count check for the update
- **OutsourcedResults.tsx**: Fix `visibleTests` filter and stats counter to not hide tests that have `results_saved` status but no actual results/images (reverse flow scenario); also fix `getTestStatus` to check for actual data presence, not just status string

