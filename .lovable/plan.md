

# Fix the spinning "Run RPC" button

## Why it hangs

The current `get_drip_pending_summary` RPC uses a `CROSS JOIN` between all enabled filters (2) and all CRM contacts (35,280), producing 70,560 eligibility rows, then does a `UNION` + `GROUP BY` on top. On Lovable Cloud's Postgres tier this exceeds memory and the **database connection is killed mid-query** — the browser's fetch never returns, so the button keeps spinning. (Verified by running `EXPLAIN ANALYZE` against the function — it crashed the DB session with "DbHandler exited".)

This is the same timeout problem from the first attempt, just hidden inside the shadow panel rather than the main flow. Good news: it never affected real sends because the JS path is still the source of truth.

## The fix — rewrite the RPC to filter early

Replace the CTE chain with a per-message-type approach that filters *before* any join expansion:

1. **ABC eligibility**: select only `crm_contacts` rows where `umr_number IS NOT NULL AND btrim(umr_number) <> ''`. No cross join — direct WHERE.
2. **Abnormal eligibility**: `INNER JOIN crm_abnormal_tests` on `contact_primary_key` (uses existing index, returns ~few thousand rows max).
3. For each set, anti-join against the pre-filtered "sent" set:
   - `drip_campaign_log` rows for that filter where `status='sent'` and `cycle_number = mob_cycle.cycle` — uses the existing `idx_drip_log_sent_filter_mobile` index.
   - For ABC, also OR-exclude contacts where `last_sent_type = 'ABC'` (matches current JS `sentPks` union).
4. **Priority lock**: instead of GROUP BY + ROW_NUMBER over the whole cartesian, compute per-mobile owner using `DISTINCT ON (mob10) … ORDER BY priority` over the much smaller pending set.
5. Aggregate the two small result sets into the JSONB shape the panel already expects.

Expected runtime: under 500 ms for both filters combined (vs. timeout currently). Bytes returned: still ~50 KB max since we only emit pending records.

## Also add: client-side timeout + clear error

Even after the rewrite, wrap the RPC call in `AutomatedMarketing.tsx`'s `rpcPending` query with:
- A 30-second `AbortController` timeout.
- On error, render a red error line in the shadow panel ("RPC failed: <message>") instead of leaving the spinner running.

This guarantees the button can never spin indefinitely again, regardless of DB state.

## Files changing

| File | Change |
|---|---|
| New migration | `DROP` and recreate `get_drip_pending_summary` with the early-filter rewrite |
| `src/components/marketing/AutomatedMarketing.tsx` | Add 30s AbortController + visible error in the shadow panel `rpcPending` query |

## What stays untouched

- JS preflight is still source of truth — zero risk to real sends.
- Mobile filtering logic — the rewrite is still a literal port of the same JS rules, just expressed in a planner-friendly shape.
- Indexes, schema, `runDrip`, all UI outside the debug panel.

## Verification you'll perform

1. Reload `/marketing?debug=preflight`.
2. Click **Run RPC** → result appears within ~1 second showing `JS: X / RPC: X / ✓ MATCH` for both ABC and Abnormal rows, with empty diff arrays.
3. If it ever fails, you'll see a clear red error message instead of an endless spinner.
4. Once you confirm matches across a few clicks, give the green light and I'll do the Phase 2 cutover behind `USE_RPC_PREFLIGHT`.

