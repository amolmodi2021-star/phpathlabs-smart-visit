

# Why "Run RPC" appears to do nothing

I tested the RPC directly with your active filters (ABC + ABNORMAL PNG, blacklist on, 7d interval, 1000/day) and it returns valid data with 100 records each — so the database side is healthy. The screenshot shows the panel is still on the **initial idle message** ("Click 'Run RPC'…"), and no network request for `get_drip_pending_summary` shows up in the browser snapshot. That means **the click is firing `refetch()` but the request is being suppressed or instantly resolved with empty data — without any error, spinner, or result**.

Most likely root causes (in order of likelihood):

1. **`refetch()` runs while `enabled: false`** — at the moment of the click, `filters` may still be loading from the parent query (its own `useQuery` resolves async), so `filters.length === 0`, which makes the React Query `enabled` flag false. In React Query v5, calling `refetch()` on a disabled query **silently returns the cached `undefined`** without firing the `queryFn`. The button does nothing visible because no fetch happens and no error is thrown.
2. **Stale closure on the query key** — `queryKey` includes `filters.map(f => f.id).join(",")`. If the click happens before filters hydrate, the key is `""`, the cached entry is `undefined`, and `refetch` resolves immediately to that undefined.
3. **No client-side feedback when the queryFn early-returns 0** — even when it does run with 0 enabled filters, it returns `{ pending_abc: 0, pending_abnormal: 0, ... }` instantly, which IS truthy, so the panel should render. So this case is unlikely given the screenshot.

# The fix

Three small, safe changes inside `src/components/marketing/AutomatedMarketing.tsx` (no DB changes, JS preflight untouched):

1. **Make the button work even when the query is disabled.** Replace the `refetch()` handler with an explicit, manually-invoked async function that:
   - Reads the current filters straight from React state (not from the closure of a disabled query).
   - Calls `supabase.rpc("get_drip_pending_summary", …)` directly.
   - Manages its own `loading` / `result` / `error` `useState` — independent of React Query's `enabled` gating.
   - This guarantees one click = one network call, every time.

2. **Add visible diagnostics in the panel** so we never get a silent dead state again:
   - Show "Filters loaded: N (enabled: M)" right under the title.
   - Show elapsed time on success ("RPC returned in 412 ms").
   - Show the last click timestamp (so you can confirm a click registered).
   - Keep the existing 30s timeout + red error message on failure.

3. **Add console logs** at click → before fetch → after fetch (success/error) so future debugging takes one screenshot of DevTools instead of another round-trip.

# Files changing

| File | Change |
|---|---|
| `src/components/marketing/AutomatedMarketing.tsx` | Replace the React Query `rpcPending` block with a button-driven `runShadowRpc()` function + local `useState` for result/error/loading/elapsed. Update the panel UI to render the new state and diagnostics. |

# What stays untouched

- `get_drip_pending_summary` RPC — already verified working server-side.
- JS `collectEligibleRecords` (source of truth for sends).
- `runDrip`, all filters UI, indexes, every other component.

# Verification

1. Reload `/marketing?debug=preflight`.
2. Click **Run RPC**.
3. Within ~1 second, the panel populates with JS vs RPC counts plus an elapsed-ms readout. If anything fails, you'll see a red error line. If 0 filters are enabled, you'll see "0 filters enabled — nothing to compare".
4. Once you confirm matches across a few clicks, give the green light and I'll flip `USE_RPC_PREFLIGHT = true` for cutover.

