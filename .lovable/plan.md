# Keep Lovable Cloud costs flat after the propagation/realtime changes

## Where the new functionality could increase Cloud cost

Cloud cost is driven by: (a) DB egress + CPU per query, (b) realtime messages delivered, (c) edge/function invocations. The recent changes introduced four cost amplifiers — none of them are functionally needed and all can be removed without losing the "patient appears immediately" behaviour.

| # | Amplifier (current code) | Cost effect | Fix |
|---|--------------------------|------------|-----|
| 1 | `useRealtimeSync` calls `flush()` on every `SUBSCRIBED` status (i.e. on every component mount / tab switch) | Every tab switch triggers a full refetch of every key for every mounted module — even when nothing changed. With 5 technicians flipping tabs 60×/hr, this is 300 useless refetches/hr per module. | Only flush on **reconnect**, not on first subscribe. Track a `hasSubscribedOnce` ref. |
| 2 | Every postgres_changes event triggers `refetchType: "active"` for every key | N users × M writes/min = N×M refetches/min on the same data. The propagation helper already refetched the acting user; realtime then refetches everyone again, including the actor (self-echo). | (a) Suppress self-echoes via a small in-memory "recently propagated" set keyed on `regId`+timestamp (5 s window) — if the realtime payload's `new.id` is in the set, skip. (b) For inactive browser tabs (`document.hidden`), only invalidate (no refetch) — they'll refetch on focus. |
| 3 | Multiple `useRealtimeSync` calls per component each open a separate WebSocket channel (`SampleCollection` opens 2, `ResultsEntry` opens 2, `OutsourcedResults` opens 1, etc.) | Each channel = a persistent realtime subscription. Realtime is billed by message volume; more channels = same table events fanned to more channel listeners on the same client. | Allow `useRealtimeSync` to accept **multiple tables** in one channel. Refactor the duplicate calls in `SampleCollection`, `ResultsEntry`, `OutsourcedResults` to a single call. |
| 4 | `propagateRegistrationChange` invalidates *both* source and destination module keys, and the source module also receives a realtime echo → same query refetched twice | Doubles refetch count per workflow action. | Mark each propagation with a short TTL token; the realtime handler reads the token and skips invalidation for any key already invalidated in the last 750 ms. |

## What the fixes look like in code

**`src/hooks/useRealtimeSync.ts`** — three changes:

```ts
// 1. Accept one OR many tables in a single channel.
export function useRealtimeSync(
  tables: TableName | TableName[],
  queryKeys: string[],
  debounceMs = 250,
  options: { enabled?: boolean } = {},
) { ... }

// 2. Drop the subscribe-time flush (only flush on reconnect).
const hasSubscribedOnce = useRef(false);
.subscribe((status) => {
  if (status === "SUBSCRIBED") {
    if (hasSubscribedOnce.current) flush();   // reconnect only
    hasSubscribedOnce.current = true;
  }
});

// 3. Self-echo + recent-invalidation suppression + hidden-tab cheap path.
const flush = (payloadId?: string) => {
  if (payloadId && wasRecentlyPropagated(payloadId)) return;       // skip self-echo
  const hidden = typeof document !== "undefined" && document.hidden;
  keysRef.current.forEach((key) => {
    if (wasRecentlyInvalidated(key)) return;                       // skip dup
    queryClient.invalidateQueries({
      queryKey: [key],
      refetchType: hidden ? "none" : "active",                     // hidden tabs: invalidate only
    });
    markInvalidated(key);
  });
};
```

**`src/lib/limsPropagation.ts`** — record propagated ids so realtime can suppress self-echo:

```ts
import { markPropagated, markInvalidated } from "./limsRealtimeDedupe";
...
ids.forEach(markPropagated);                  // 5 s TTL
keys.forEach(markInvalidated);                // 750 ms TTL
```

**New file `src/lib/limsRealtimeDedupe.ts`** — tiny in-memory `Map<string, number>` with TTL; no storage, no extra requests, just prevents redundant invalidations.

**Consolidate duplicated subscriptions:**

- `SampleCollection.tsx`: merge 2 calls → `useRealtimeSync(["sample_tubes","patient_registrations"], [...])`
- `ResultsEntry.tsx`: merge 2 calls → one channel
- Same pattern wherever a component subscribes to >1 table

## Net effect on Cloud spend

- Subscribe-flush removal alone eliminates ~100% of "tab switch" refetches → biggest single saving.
- Self-echo suppression + dedupe window cuts active-user refetch count by ~50% for the actor's own changes.
- Hidden-tab gating means a technician with 5 background tabs no longer pays the full refetch cost on every event — only the visible tab does.
- Channel consolidation reduces realtime listener count per client without changing what is observed.
- The 15 s sync TTL is UI-only (no network), so it does not affect cost.

Together these keep the propagation system **cheaper than before** the recent changes, while preserving the "patient appears immediately" behaviour. No DB schema changes, no new edge functions, no new tables, no new polling.

## Files to edit

- `src/hooks/useRealtimeSync.ts` — multi-table support, drop subscribe-flush, hidden-tab gating, dedupe hook-in
- `src/lib/limsPropagation.ts` — call `markPropagated` / `markInvalidated`
- **New:** `src/lib/limsRealtimeDedupe.ts` — TTL maps + helpers
- `src/components/lims/SampleCollection.tsx` — consolidate 2 subscriptions
- `src/components/lims/ResultsEntry.tsx` — consolidate 2 subscriptions

## Out of scope

- No changes to query SQL, no schema changes, no removal of realtime (it's still the safety net for cross-user updates).
- No instance-size change required.

Approve and I'll implement.