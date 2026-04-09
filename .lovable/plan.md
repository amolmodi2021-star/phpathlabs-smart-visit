

# Plan: Enhance Dispatch Section — Show All Patients with Status Markers

## What it does
- Shows **all registered patients** (not just those with approved tests) in the dispatch list
- Displays test names with their current status (approved/pending) per patient
- Adds a **completion status marker** beside the WhatsApp button:
  - **Green circle** (✅): All tests approved — ready for full dispatch
  - **Yellow/amber circle** (⚠): Some tests approved, some still pending
  - **Red circle** (🔴): No tests approved yet — all pending

## Technical Changes

### File: `src/components/lims/Dispatch.tsx`

1. **Broaden registration query**: Remove the `approved`-only filter. Fetch all non-cancelled registrations (statuses: `sample_accepted`, `entered`, `verified`, `approved`, `dispatched`) so every patient appears.

2. **Build per-test status**: For each active test in a registration, determine its status:
   - "approved" — has approved results or approved outsourced snip
   - "pending" — not yet approved (still in results entry, verification, or doctor approval stages)
   - "dispatched" — already dispatched

3. **Compute completion marker** per patient:
   - `all_done`: every active test has status "approved" → green badge
   - `partial`: some approved, some pending → amber badge  
   - `all_pending`: none approved → red badge
   - Already-dispatched tests are excluded from pending count

4. **Display changes**:
   - Show marker icon (colored dot or badge) next to the WhatsApp button
   - In expanded view, list **all** active tests with their status badge (Approved / Pending / Dispatched)
   - Only show "Dispatch All" and per-test "Mark Dispatched" buttons for approved tests
   - Pending tests show a muted "Pending" badge with no action buttons

5. **Stats update**: Show "Total Patients", "Ready to Dispatch" (all approved), "Partially Ready" counts

## Summary
- **One file changed**: `src/components/lims/Dispatch.tsx`
- Broadens the query to show all patients, adds per-test status tracking, and renders completion markers (green/amber/red) beside the WhatsApp button

