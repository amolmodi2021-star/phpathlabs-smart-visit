

# Why ABC shows 12,311 vs 25 — they're measuring different things

## The real problem

The shadow panel is comparing apples to oranges. The **"JS" number** (`pendingCounts`) and the **"RPC" number** are intentionally computed by two different functions in the codebase:

| What it measures | "JS" (`pendingCounts`, lines 288–446) | RPC (`get_drip_pending_summary`) | Real send pipeline (`collectEligibleRecords`, lines 595–990) |
|---|---|---|---|
| Min-interval guard | ❌ ignores | ✅ applies | ✅ applies |
| `location_filter` | ❌ ignores | ✅ applies | ✅ applies |
| `last_sent_type_filter` | ❌ ignores | ✅ applies | ✅ applies |
| `record_limit` per filter | ❌ ignores | ✅ applies | ✅ applies |
| `maxPerDay` global cap | ❌ ignores | ✅ applies | ✅ applies |

So `pendingCounts.pendingAbc = 12,311` is the **gross "anything that could ever be sent across all future cycles" number** (intentionally — that's what the dashboard tile is supposed to show). RPC=25 is the **actual capped send-today list**, which matches `record_limit=100` after dedup + cross-filter claim trims it.

The two were never meant to be equal. The shadow comparison was wired against the wrong baseline.

## The fix — compare RPC to the real pipeline

Change the shadow panel to call `collectEligibleRecords()` (the actual send pipeline, source of truth for `runDrip`) and compare its output against the RPC. That's the comparison that actually matters before cutover.

### Changes in `src/components/marketing/AutomatedMarketing.tsx`

1. **Add a "JS pipeline" state** alongside `rpcPending`:
   - `jsPipeline` / `jsFetching` / `jsElapsedMs`.
2. **Make `runShadowRpc` run BOTH in parallel** and store both:
   - `Promise.all([collectEligibleRecords(), supabase.rpc("get_drip_pending_summary", …)])`.
   - Aggregate the JS pipeline output into `{ pendingAbc, pendingAbnormal, abcRecords, abnormalRecords }` by walking `results[]` and grouping by each filter's `message_type`.
3. **Update the shadow panel UI** to read `jsPipeline.pendingAbc` instead of `pendingCounts.pendingAbc` for the "JS" line, and the same for Abnormal and the diff arrays. Show both elapsed times.
4. **Leave the dashboard tiles untouched** — `pendingCounts` still drives the top "Pending ABC Cards / Abnormal History" tiles since users have come to read those as forward-looking eligibility totals.

### Expected result after fix

- Click **Run RPC** → both numbers come from capped send pipelines.
- ABC: JS ~25, RPC ~25, ✓ MATCH.
- Abnormal: JS ~25, RPC ~25, ✓ MATCH.
- Diff arrays empty, or any small gap will be a real RPC vs JS rule discrepancy worth fixing.

## Files changing

| File | Change |
|---|---|
| `src/components/marketing/AutomatedMarketing.tsx` | Update `runShadowRpc` to also run `collectEligibleRecords` in parallel, store its aggregated counts in new state, and switch the shadow panel UI to read from this new state instead of `pendingCounts` |

## What stays untouched

- `get_drip_pending_summary` RPC — already verified server-side, no DB changes.
- `collectEligibleRecords` JS — source of truth, unchanged.
- `pendingCounts` query and the dashboard tiles above the shadow panel — unchanged (they intentionally show gross eligibility).
- `runDrip`, send pipeline, all other UI.

## Verification

1. Reload `/marketing?debug=preflight`.
2. Click **Run RPC**.
3. Within ~1–2 seconds the panel shows both JS pipeline count and RPC count side by side, both capped by `maxPerDay`. Expect `✓ MATCH` with empty diff arrays.
4. Toggle a location filter / change min interval / adjust max per day → click **Run RPC** again → still matches.
5. Once you confirm matches across 3+ refreshes, give the green light and I'll flip `USE_RPC_PREFLIGHT = true` for cutover.

## Risk

Zero to production. Shadow panel is the only consumer; `runDrip` keeps using JS; dashboard tiles unchanged.

