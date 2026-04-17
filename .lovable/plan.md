
## Goal
Add a per-patient **Refresh from LIMS** button on each patient card in the **Results Entry** section, so operators can pull machine results into that specific patient's tests without navigating to the LIMS Interface module.

## Plan

### A. Reuse the same edge action from the previous plan
The previously approved `lims-interface` reprocess action will be extended to accept an optional `registration_id` filter:
- No `registration_id` → reprocess all active orders (used by Active Orders Refresh button).
- With `registration_id` → reprocess only that single patient's order(s).

Same logic, just a scoped query.

### B. UI — `src/components/lims/ResultsEntry.tsx`
- On each patient card header (next to the existing patient meta / accordion trigger), add a small **Refresh** icon button (RefreshCw icon, `variant="ghost" size="sm"`).
- `onClick` (stop propagation so the accordion doesn't toggle):
  - Calls `supabase.functions.invoke('lims-interface', { body: { action: 'reprocess', registration_id: patient.registration_id } })`.
  - Shows a spinner on the icon while in flight.
  - Toast: `"Pulled X new results from LIMS"` or `"No new results available"`.
  - Invalidates the patient_results / registration queries so the accordion content refreshes immediately.
- Disabled state while loading; per-card loading state (not a global flag) so refreshing one patient doesn't lock others.

### C. Out of scope
- No changes to the existing Results Entry data model, accordion structure, or save flow.
- No automatic polling.
- LIMS Demo Active Orders Refresh button — already covered in the prior approved plan.

## Files
- `supabase/functions/lims-interface/index.ts` — extend `reprocess` action to accept optional `registration_id` (~5 lines added to the previously planned handler).
- `src/components/lims/ResultsEntry.tsx` — add Refresh button + per-patient mutation in each patient card header (~25 lines).
