# Realtime Cost Trim — Targeted Cleanup

## Findings from the scan

**`setInterval` usage (4 instances):** All already optimized. The two that touch the database (`App.tsx` 15s auth-epoch, `PatientReportPortal.tsx` 120s status) both pause when the tab is hidden. The other two are pure UI timers with no DB calls. **No changes needed.**

**`useRealtimeSync` usage (8 instances):** 5 are on low-churn tables and fine. **3 are unfiltered subscriptions on `patient_registrations`** — the busiest table in your system. Every patient registration, edit, or status change anywhere in the LIMS currently wakes up these components in every open tab, even when the user isn't looking at that screen.

The 3 components in question:
- `src/components/lims/SampleCollection.tsx`
- `src/components/lims/ResultsEntry.tsx`
- `src/components/lims/OutsourcedResults.tsx`

Each one subscribes to the whole table because they need to know when *any* registration moves into their queue — and we can't pre-filter by registration_id (the queue is dynamic).

## The fix

Replace the always-on realtime subscription with a cheaper combination that already exists in the codebase:

1. **`refetchOnWindowFocus: true`** on the existing React Query queries in these 3 components — refetches the queue the moment the user returns to the tab.
2. **`propagateRegistrationChange`** — already invalidates these query keys when the same user performs an action that should move a row between queues (it's referenced in the Core memory rule).
3. **Drop the `useRealtimeSync` calls** in these 3 files entirely.

The result: zero ambient realtime traffic for `patient_registrations` from these screens. Updates still appear:
- Instantly when *this user* causes the change (via `propagateRegistrationChange`)
- On tab focus when *another user* caused the change (via `refetchOnWindowFocus`)

For a single-lab LIMS where most users are usually looking at one tab at a time, this is indistinguishable from realtime in practice.

## What stays untouched

- `patient_registrations` realtime in `RegisteredPatients`, `HomeVisits`, dashboards — these are the primary "live status" screens and benefit from realtime.
- `home_visits`, `tests`, `app_settings`, `message_templates`, `estimates` subscriptions — low-churn, small payloads, useful.
- All 4 `setInterval` callsites — already correctly tuned.
- The realtime publication itself (the 6-table allowlist in the Core memory) — unchanged.

## Files to change

```text
src/components/lims/SampleCollection.tsx   — remove useRealtimeSync call;
                                              add refetchOnWindowFocus to its useQuery
src/components/lims/ResultsEntry.tsx       — same
src/components/lims/OutsourcedResults.tsx  — same
```

## Verification after change

- Open Sample Collection, Results Entry, Outsourced in 3 tabs.
- Register a new patient in a 4th tab.
- Switch to each of the 3 tabs and confirm the new row appears on focus (no manual refresh needed).
- Confirm `propagateRegistrationChange` continues to push instant updates when the same tab makes the change.

## Expected cost impact

Removes the largest remaining source of unfiltered realtime events. With ~50 patients/day and frequent edits, this likely cuts realtime event volume from these 3 screens by **80–95%** — without any UX degradation for typical single-tab usage.

No new memory entries needed; the Core rule about the realtime publication and `propagateRegistrationChange` already covers this pattern.