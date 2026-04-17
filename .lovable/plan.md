
## Root cause (NOT the Refresh button)

I traced the patient `2604170001 (AMOL PARASMAL BUDHMAL MODI)` in the database and the timeline tells a clear story:

| Time (UTC, 17-Apr) | Event | Source |
|---|---|---|
| 08:24:20 | Tube created (status `pending`) | Registration |
| 08:26:04 | Tube accepted (status → `accepted`, `accepted_at` set) | Sample Acceptance |
| **08:26:52** | **Tube reverted to `collected`, `collected_at` overwritten** | **Sample Collection (Print & Collect re-clicked)** |
| 08:26:54 | Registration recalculated → `sample_collected` | Triggered by tube update above |
| 08:27:12 | **Refresh from LIMS clicked** (this was AFTER the patient already disappeared) | LIMS Interface |

The Refresh button did not cause the disappearance. The edge function's `reprocess` action does NOT touch `sample_tubes` or `patient_registrations.status` at all. Patient was already gone before the click.

The actual culprit is in **`SampleCollection.tsx` → `collectMutation`** (and the `handlePrintAndCollect` / `handleSinglePrintAndCollect` / Reprint flows). The mutation blindly does:

```ts
update({ status: "collected", collected_at: now }) WHERE id IN (tubeIds)
```

with **no guard against tubes that are already `accepted`**. So when the user clicks "Print & Collect" or the single-tube Print button on a tube that was already accepted (visible in your session replay — the "Reprint barcode" / Repeat / Accept buttons appeared), the tube gets demoted from `accepted` → `collected`. Then `recalculateRegistrationStatus` sees all tubes as `collected` and downgrades the registration → patient drops out of Results Entry.

## Fix plan

### A. `src/components/lims/SampleCollection.tsx` — guard collect mutation
1. In `collectMutation.mutationFn`, filter the `.update(...)` to only affect tubes whose current status is `pending`:
   ```ts
   .update({...}).in("id", tubeIds).eq("status", "pending")
   ```
2. In the `handlePrintAndCollect` / `handleSinglePrintAndCollect` / Reprint paths, only call `collectMutation` for tubes with `status === "pending"`. For already-accepted tubes the user is just **reprinting** — never re-collecting. Reprint must NOT touch tube status or timestamps.
3. If filtered list is empty (all selected tubes were already past `pending`), show an info toast: `"Tubes already collected/accepted — barcode reprinted only"` and skip the mutation.

### B. `src/components/lims/SampleAcceptance.tsx` — defensive guard (same class of bug)
Mirror the same `.eq("status", "collected")` guard on `acceptMutation` so a stale double-click can't re-accept a tube that's already past the acceptance stage.

### C. Restore this specific patient
One-off SQL migration to re-promote the affected tube + recalc registration:
```sql
UPDATE sample_tubes
SET status = 'accepted'
WHERE id = 'af90fe68-c67c-4018-b31c-1d977397ee79'
  AND accepted_at IS NOT NULL;
-- then triggers a registration status recompute via the app on next load,
-- or set patient_registrations.status = 'sample_accepted' for this id directly.
```

### D. Out of scope
- Refresh from LIMS button — works correctly, no changes.
- `recalculateRegistrationStatus` logic — correct given the inputs; the bug is upstream tube state.
- Other flows (Result Verification, Doctor Approval, Dispatch) — not touched.

## Files
- `src/components/lims/SampleCollection.tsx` — add `.eq("status","pending")` guard in `collectMutation`; pre-filter tube lists in print-and-collect handlers; treat reprint as status-neutral.
- `src/components/lims/SampleAcceptance.tsx` — mirror guard `.eq("status","collected")` on `acceptMutation`.
- New migration — restore this one patient's tube + registration to `accepted` / `sample_accepted`.
