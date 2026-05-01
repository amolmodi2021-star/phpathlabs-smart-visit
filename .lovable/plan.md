# Sample Acceptance — Lazy Load Accepted Tab + Hide Dispatched

## Goals
1. **Save cloud cost**: only fetch the heavy `patient_registrations` rows for the patients we actually display.
2. **Lazy load**: show top **50** accepted patients first, with a "Load 50 more" button at the bottom.
3. **Hide fully dispatched / cancelled**: re-verify these never appear in the Accepted tab.

## Current behavior (verified)
File: `src/components/lims/SampleAcceptance.tsx`
- `acceptedTubes` query pulls **all** rows from `sample_tubes` where `status = 'accepted'` (currently ~179 across ~178 registrations in the live DB).
- All those registration IDs are then fed into a single `patient_registrations` query that selects `*` — heavy payload — without filtering out `dispatched` or `cancelled`.
- `acceptedGroups` is rendered uncapped (whole list).

So today the Accepted tab loads every accepted-but-not-yet-deleted registration, including 1 fully `dispatched` and 1 `cancelled` row that should not be there.

## Plan

### 1. Constant + state
- Add `const ACCEPTED_PAGE_SIZE = 50;` at module top.
- Add `const [acceptedLimit, setAcceptedLimit] = useState(ACCEPTED_PAGE_SIZE);`.
- Reset `acceptedLimit` to 50 whenever `debouncedSearch` or `activeTab` changes (via a small `useEffect`).

### 2. Slice the accepted reg-id list
- Keep the existing lightweight `sample_tubes_acceptance_accepted` query (already ordered by `accepted_at desc`).
- Derive `acceptedRegIdsOrdered` — deduped, in acceptance-time order.
- `visibleAcceptedRegIds = acceptedRegIdsOrdered.slice(0, acceptedLimit)`.
- `hasMoreAccepted = acceptedRegIdsOrdered.length > acceptedLimit`.

### 3. Trim the heavy registrations fetch
- Build `pendingRegIds` from `collectedTubes` (small, full).
- New `regIds = unique([...pendingRegIds, ...visibleAcceptedRegIds])`.
- Add `.not("status", "in", '("dispatched","cancelled")')` to the `patient_registrations` query so dispatched / cancelled records are filtered server-side and never reach the client (defense in depth — even if a tube is still `accepted` for some reason).

### 4. Update grouping
- `acceptedGroups` filters `registrations` by `visibleAcceptedRegIds` so the rendered list respects the page window even if the cache holds more.

### 5. Load-more button
- Below `<TabsContent value="accepted">`, when `hasMoreAccepted`, render an outline button:
  `Load 50 more  (showing X of Y)` → `setAcceptedLimit(n => n + ACCEPTED_PAGE_SIZE)`.
- Update the Accepted tab badge to show `visible / total` (e.g. `50 / 178`).

### 6. Sanity
- Pending tab is unchanged (always shows full pending queue).
- Tube counts, badges, and `useNewArrivalsBadge` (driven by `pendingGroups`) are unaffected.
- No DB schema changes; no realtime publication changes.

## Files touched
- `src/components/lims/SampleAcceptance.tsx` — only file.

## Out of scope
- Pagination of the pending tab (queue should stay fully visible by design).
- Server-side keyset pagination of `sample_tubes` (current sample_tubes payload is small text rows; the cost comes from `patient_registrations.*`, which is what we are trimming).
