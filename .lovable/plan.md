

# Why the counts dropped (12,311 → 214)

The recent network optimization replaced two paginated `crm_contacts` reads with `supabase.rpc("get_drip_contact_slice")` and `supabase.rpc("get_abnormal_pks")` — but those RPC calls have **no `.range()` pagination**, so PostgREST silently caps the response at its default **1000 rows**.

I verified this directly: the database has **35,280 contacts** but the RPC over HTTP returns exactly **1000**. The pending-counts logic is now operating on ~3% of the dataset, which is exactly why:

| | Before | After (broken) |
|---|---|---|
| Pending ABC Cards | ~12,311 | 214 |
| Pending Abnormal History | ~3,580 | 20 |

The counts haven't *changed in meaning* — the new fetch path just truncates the data. The numbers you used to see were correct.

This is the same 1000-row cap that `mem://tech/data-fetching-standards` warns about. The original code respected it via the `fetchAllPg` pagination loop on `crm_contacts.select(...)` and `crm_abnormal_tests.select(...)`. The RPC migration silently dropped that loop.

## The fix

Paginate the RPC calls the same way `fetchAllPg` paginates plain selects. PostgREST honors `Range` headers on `setof`/`TABLE`-returning RPCs, so `supabase.rpc("get_drip_contact_slice").range(from, from + 999)` works exactly like the original loop.

### Changes — `src/components/marketing/AutomatedMarketing.tsx` only

1. Add a small helper `fetchAllRpc(rpcName)` that loops `.range(from, from + 999)` until a chunk returns <1000 rows, mirroring the existing `fetchAllPg`.
2. In **`pendingCounts` queryFn** (around line 309): replace
   - `supabase.rpc("get_drip_contact_slice")` → `fetchAllRpc("get_drip_contact_slice")`
   - `supabase.rpc("get_abnormal_pks")` → `fetchAllRpc("get_abnormal_pks")`
3. In **`collectEligibleRecords`** (around line 551): same two replacements.

That restores full data coverage (35K contacts, 3K abnormal PKs) while keeping every other network optimization intact:
- Slim column shape from the RPCs (still ~70% smaller than `select("*")`).
- 5-minute refresh throttle.
- Realtime toggle off during sends.
- CSV streaming export.

## Expected result after fix

- Pending ABC Cards returns to ~12,311.
- Pending Abnormal History returns to ~3,580.
- Network savings stay roughly intact: payload is still slim, just chunked across ~35 paged requests of ~1000 rows each instead of one request of 35K rows. Net bytes are nearly identical to the slim-RPC plan.

## Files changing

| File | Change |
|---|---|
| `src/components/marketing/AutomatedMarketing.tsx` | Add `fetchAllRpc` helper; paginate the two RPC calls in `pendingCounts` and `collectEligibleRecords` |

## What stays untouched

- The `get_drip_contact_slice` and `get_abnormal_pks` RPCs (they're correct — only the client was missing pagination).
- CSV export edge function, refresh throttle, realtime toggle, all UI, all send logic.

## Verification

1. After deploy, click **Refresh** on Pending Counters.
2. ABC count should return to ~12,311 and Abnormal to ~3,580 (matching what you saw before the optimization).
3. Network usage stays ~60–70% lower than the original `select("*")` baseline.

## Risk

Zero. This restores the exact pre-optimization data shape; the pagination pattern is already used elsewhere in the file (`fetchAllPg`, `fetchAll`).

