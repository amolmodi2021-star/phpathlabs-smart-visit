
## Goal
Add the missing **Refresh** button in the **Active Orders** card header on `/lims-demo`. This was in the original plan but didn't make it into the code (only the per-patient ResultsEntry button shipped).

## Plan

### `src/pages/LimsDemo.tsx` — Active Orders card
1. Add a `RefreshCw` icon button into the existing toolbar (line ~597, in the `ml-auto` button group, placed before "Delete Selected").
2. On click → `supabase.functions.invoke("lims-interface", { body: { action: "reprocess" } })` with **no** `registration_id` (reprocess all active orders).
3. Track loading state with a local `isRefreshing` flag; show spinning icon + "Refreshing…" label while in flight; disable button.
4. On success: toast `"Reprocessed X order(s) — Y result(s) pushed, Z marked completed"` (use counters returned by the edge function); invalidate `lims_orders`, `lims_test_results`, and `patient_results_existing` queries so UI refreshes.
5. On error: error toast.

### Out of scope
- Edge function `reprocess` action — already deployed and working (used by ResultsEntry per-patient refresh).
- ResultsEntry per-patient button — already shipped.
- No DB changes.

## Files
- `src/pages/LimsDemo.tsx` — add `RefreshCw` import, `isRefreshing` state, refresh handler, and the button in the toolbar (~20 lines).
