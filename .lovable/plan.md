## Patient Flow Cost Reduction — Details + Plan

### Point 2: 90-day cap on RegisteredPatients query — DETAILS

**What it is today** (`src/components/lims/RegisteredPatients.tsx`, lines 101-135):

Two queries fire whenever a user opens the LIMS Registered Patients tab, changes the search box, or changes the date filter:

1. **Count query** — `SELECT count(id) FROM patient_registrations` with the active search/date filters.
2. **Page query** — `SELECT * FROM patient_registrations ORDER BY created_at DESC LIMIT 50 OFFSET …` with the same filters.

When **no date filter is set** (the default when staff open the tab), both queries scan the **entire table** — every registration ever made — just to display the latest 50 rows.

**Current scale:** the DB has 146 registrations total (all in last 30 days). So today the impact is small. **But this query runs on every tab open + every realtime invalidation + every search keystroke (debounced)**, and as the table grows past several thousand rows over months/years, both the count and the sort+offset get progressively more expensive — that's where Cloud cost compounds.

**Proposed cap:** if no date filter is set, automatically apply `created_at >= now() - interval '90 days'` to both queries. A small **"Show all dates"** toggle next to the date filter lets staff opt back into a full scan when they need historical lookup. Search across all dates would still work the moment they type a UMR / mobile / invoice (the search filter stays unfiltered by date — only the default empty-state view is capped).

**Net effect:** keeps the working set bounded as the table grows. No data is deleted. No behavior change for users actively searching.

---

### Point 3: Optimize `useRealtimeSync` — DETAILS

**What it is today** (`src/hooks/useRealtimeSync.ts`):

A WebSocket subscription that listens to Supabase realtime postgres_changes. Every time **any row** in the subscribed tables changes anywhere in the system, every open browser tab gets the event and (after a 250 ms debounce) re-runs the query for the matching key.

Current good optimizations already in place: self-echo suppression, 750 ms per-key dedupe, hidden-tab gating, no refetch on first SUBSCRIBE.

**Where cost still leaks:**

1. **`patient_results` subscription in ResultsEntry.tsx** — this is the highest-churn table. Every keystroke saved by every technician anywhere triggers a realtime event to every open ResultsEntry tab, which then re-queries. With multiple techs typing, this fires hundreds of times per hour even though each tab only cares about *its currently viewed patient*.
2. **`patient_registrations` subscription in SampleCollection** — same pattern; status updates broadcast to all tabs.
3. **Debounce window is 250 ms** — too short for bursty status pipelines (a single registration update triggers `recalculateRegistrationStatus` which may fire 2-3 row updates back-to-back, causing 2-3 separate refetches instead of one).

**Proposed changes:**

- **Bump default debounce from 250 ms → 1500 ms** for high-churn tables (`patient_results`, `patient_registrations`). Trades 1.25 s of staleness for ~60 % fewer refetches during burst writes.
- **Add an optional `filter` parameter** to `useRealtimeSync` so ResultsEntry can subscribe to `patient_results` filtered by `registration_id=eq.<currently-viewed-id>` instead of the whole table. Postgres realtime supports this server-side; it cuts inbound events from "every tech's keystrokes" to "only this patient's results."
- **Increase per-key dedupe window 750 ms → 2000 ms** so propagation + realtime echo collapse into one refetch instead of two.

**Net effect:** estimated 40-60 % reduction in realtime-triggered DB queries, with no functional changes (eventual consistency still works, just delayed by ~1.5 s instead of 250 ms — already imperceptible because React Query's own cache shows the result instantly on writes).

---

### Confirmed actions (will implement on approval)

#### Point 1 — Auto-delete abandoned estimates >30 days

- Daily pg_cron job (02:30 IST): delete from `estimates` where `created_at < now() - interval '30 days'` AND `status = 'Estimate Created'` (i.e. never converted to a registration / home visit). `estimate_tests` cascade-cleaned in the same job.
- One-time purge of existing rows matching the rule.

#### Point 2 — 90-day default cap on RegisteredPatients (as explained above)

- Edit `src/components/lims/RegisteredPatients.tsx`: when `fromIso` is empty AND `debouncedSearch` is empty, inject `gte("created_at", now-90d)` on both count and page queries.
- Add a small `Show all dates` checkbox next to the date filter that disables the cap.

#### Point 3 — Realtime optimizations (as explained above)

- Edit `src/hooks/useRealtimeSync.ts`: bump default `debounceMs` to 1500, dedupe window to 2000 ms, accept optional `filter` param.
- Edit `src/components/lims/ResultsEntry.tsx`: pass `filter: \`registration_id=eq.${currentRegId}\`` for the `patient_results` subscription.

#### Point 4 — 7-day retention on `lims_test_orders`

- Daily pg_cron job (02:35 IST): `DELETE FROM lims_test_orders WHERE created_at < now() - interval '7 days'` (regardless of status — currently 255 rows, none older than 7 days, so this is purely forward-looking).
- Add `lims_test_orders` to `RETENTION_RULES` in `src/lib/cloudUsage.ts`.

#### Skipped per your instruction

- Point 5 (compact `approved_reports.test_results` JSONB) — **not touching**.
- Point 6 (delete soft-cancelled registrations >90 days) — **not touching**.

### Files touched

- `supabase/migrations/<new>.sql` — 2 cron jobs + one-time estimate purge
- `src/components/lims/RegisteredPatients.tsx` — 90-day cap + toggle
- `src/hooks/useRealtimeSync.ts` — debounce/dedupe tuning + filter param
- `src/components/lims/ResultsEntry.tsx` — pass filter for `patient_results`
- `src/lib/cloudUsage.ts` — add `lims_test_orders` to retention rules

Approve and I'll implement.