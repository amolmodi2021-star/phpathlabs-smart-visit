

# Why the shadow comparison is mismatching

The screenshot shows large diffs in **both** directions:

| | JS | RPC | Diff | What it means |
|---|---|---|---|---|
| ABC | 12,311 | 1,575 | RPC is missing 10,736 | RPC is too restrictive on ABC |
| Abnormal | 3,580 | 13,100 | RPC has 9,520 extra | RPC is too permissive on Abnormal |

After re-reading the JS preflight (`collectEligibleRecords` in `AutomatedMarketing.tsx` lines 560–870), the RPC is missing 5 critical filter rules and applying 1 extra rule incorrectly. None of this means the JS path is wrong — it just means the RPC port is incomplete. JS remains the source of truth, so production sends are unaffected.

## Rules the RPC currently ignores

1. **Per-filter `location_filter`** (`ALL` / `PH VESU` / `NON PHPL`) — JS filters contacts by location before anything else. RPC pulls every contact regardless. → inflates Abnormal by ~9,500.
2. **Per-filter `last_sent_type_filter`** (`ABC` / `Abnormal History` / `__null__` / none) — JS filters by `crm_contacts.last_sent_type`. RPC ignores it.
3. **Global `min_interval` recent-send guard** — JS drops any mobile with a `message_send_log` entry within `minInterval` days. RPC has no such check.
4. **Per-filter `record_limit` + global `maxPerDay` quota with backfill** — JS caps per-filter at fair share, then redistributes unused quota. RPC returns the unbounded eligible list.
5. **Cross-filter "claimed mobile" exclusion within a single run** — JS only sends one message per mobile per day across ALL filters. RPC doesn't enforce this for ABC vs Abnormal collisions.

## Rule the RPC enforces wrongly

6. **ABC `last_sent_type='ABC'` exclusion** — RPC unconditionally drops every ABC-eligible contact whose `last_sent_type` is already 'ABC'. JS only treats that as "already sent **for this specific PK in this cycle**" via `getSentCount`, then still allows the contact through if its cycle has rolled. → strips out ~10,700 ABC rows.

# The fix — finish the RPC port, faithfully

Rewrite `get_drip_pending_summary` so it accepts the actual filter rows (not just IDs) and runs the same chain JS does:

```text
per filter, in priority order:
  1. pull crm_contacts (or abnormal join)
  2. WHERE location matches f.location_filter
  3. WHERE last_sent_type matches f.last_sent_type_filter
  4. WHERE last_sent_date < now() - minInterval days
     AND mobile NOT IN (recent message_send_log within minInterval)
  5. WHERE NOT blacklisted (10-digit normalized)
  6. ANTI-JOIN drip_campaign_log for (filter_id, current cycle, status='sent')
  7. ABC: also exclude PKs already sent THIS CYCLE (via log), NOT just last_sent_type='ABC'
  8. Cross-filter claim: exclude mobiles already claimed by a higher-priority filter
       (computed inside the function via DISTINCT ON priority)
  9. Cap to filter.record_limit, then enforce maxPerDay with backfill
```

New signature:

```sql
get_drip_pending_summary(
  p_filter_ids uuid[],
  p_exclude_blacklist boolean,
  p_min_interval_days int,
  p_max_per_day int
) RETURNS (pending_abc, pending_abnormal, pending_abc_records, pending_abnormal_records)
```

The function reads `drip_campaign_filters` itself for `location_filter`, `last_sent_type_filter`, `record_limit`, `priority`, `message_type` — the caller doesn't need to pass them. This keeps the call site simple and guarantees the RPC and JS read the exact same filter config.

# Files changing

| File | Change |
|---|---|
| New migration | `DROP` + recreate `get_drip_pending_summary` with the 9-step chain above; signature gains `p_min_interval_days int, p_max_per_day int` |
| `src/components/marketing/AutomatedMarketing.tsx` | Update the shadow `rpcPending` call to pass `minInterval` and `maxPerDay`; no other behavior change |

# What stays untouched

- JS `collectEligibleRecords` — still source of truth, unchanged.
- All filter UI, `runDrip`, send pipeline, trial mode, retry tab.
- Existing indexes (already cover the new joins).
- The shadow panel UI itself — same layout, same diff display, just smaller numbers.

# Verification

1. Reload `/marketing?debug=preflight`.
2. Click **Run RPC**.
3. Expected: both rows show `JS == RPC` with `DIFF: 0` and empty `only-in-JS` / `only-in-RPC` arrays.
4. Click Refresh on a few different filter configurations (toggle a location filter, change min interval) and reconfirm.
5. Once you confirm matches across 3+ refreshes, give the green light and I'll flip `USE_RPC_PREFLIGHT = true` in Phase 2.

# Risk

Zero to production. The shadow panel is the only consumer of this RPC today; `runDrip` still uses the JS path. If the rewrite still drifts, you'll see it in the shadow panel before any cutover.

