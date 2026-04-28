
# Cost-cut plan — disable unused modules, tighten the two queries you keep

You confirmed: CRM Contacts deleted, drip not used, AutomatedMarketing not used, MessageLog not used, AbnormalHistory not used. Estimates: only last 7 days on screen, full data on export.

## What gets disabled (no UI, no DB reads, no writes)

| Module | Action |
|---|---|
| Marketing → Automated tab | Tab removed; `AutomatedMarketing.tsx` no longer imported. The 3 full-table fetches (`drip_mobile_cycles`, `drip_campaign_log`, `message_send_log`) and the 24h count poll go away. |
| Marketing → Message Log tab | Tab removed; `MessageLog.tsx` no longer imported. No more reads on `message_send_log`. |
| `useAbnormalHistory` hook | Hook short-circuited to return `getForMobile: () => null` and a no-op mutation. All callers (`EstimateDashboard`, `PhleboDashboard`, `HomeVisits`, etc.) keep compiling but issue **zero** queries against `abnormal_history`. The Abnormal History page is also taken out of the Marketing/CRM nav. |
| `logMessageSend` (write side) | Becomes a no-op so future actions don't keep growing `message_send_log`. WhatsAppChat / Marketing Sender / Billing Dashboard inserts are gated. |
| `drip_campaign_log` & `drip_mobile_cycles` data | Truncated via migration. |

I will keep the **files** in the repo (so we can re-enable later) but cut the imports and gut their query bodies, so they're zero-cost even if someone navigates by URL.

## What gets fixed in the modules you keep

### Estimates Dashboard
1. Default view = only estimates with `created_at >= now() - interval '7 days'`. The query becomes:
   ```ts
   .from("estimates")
   .select("*, estimate_tests(*)", { count: "estimated" })
   .eq("status", "Estimate Created")
   .gte("created_at", sevenDaysAgo)
   .order("created_at", { ascending: false })
   .range(from, to);
   ```
2. Drop `count: "exact"` → use `count: "estimated"` (Postgres reltuples, free). Pagination footer continues to work.
3. Search box: when user types, scope is still last 7 days **unless** they tick a new "Search all dates" checkbox. Keeps day-to-day work cheap; allows on-demand wider lookup.
4. **Export button** is unchanged — `handleExport()` already paginates with `range(from, from+999)`. We just drop the 7-day `gte` filter inside the export path so the Excel contains everything.
5. Add the supporting indexes so even the 7-day query and the export are index-served:
   ```sql
   CREATE INDEX IF NOT EXISTS idx_estimates_status_created
     ON estimates (status, created_at DESC);
   ```

### Abnormal History (the hook, not the page)
- `src/hooks/useAbnormalHistory.ts` returns stubs immediately — no `useQuery`, no `from("abnormal_history")` call.
- Page route stays accessible but the page itself is removed from nav so it isn't loaded.

## Database cleanup (one migration + truncates)

```sql
-- Reclaim space and stop accidental future scans
TRUNCATE TABLE drip_campaign_log;
TRUNCATE TABLE drip_mobile_cycles;
-- message_send_log: keep historical data but stop new writes (handled in code).
-- If you want it wiped too, say the word and I'll add: TRUNCATE TABLE message_send_log;

-- Index for the kept estimates query
CREATE INDEX IF NOT EXISTS idx_estimates_status_created
  ON public.estimates (status, created_at DESC);
```

No tables are dropped. We're keeping the schemas so the code references stay valid; you can re-enable any module later by uncommenting one import line.

## Files touched

- `src/pages/Marketing.tsx` — remove `automated` and `log` tabs + their imports.
- `src/pages/EstimateDashboard.tsx` — 7-day default filter, estimated count, export untouched.
- `src/hooks/useAbnormalHistory.ts` — gut the hook (return stubs).
- `src/lib/messageLog.ts` — `logMessageSend` becomes no-op.
- `src/components/AppLayout.tsx` (or wherever the nav lives) — remove "Abnormal History" link if it's there.
- New migration: `supabase/migrations/<ts>_disable_unused_modules.sql` (truncates + index).

## Expected effect

These four hot scanners disappear or become indexed lookups:

| Was scanning | After |
|---|---|
| `crm_contacts` 14 B rows | already 0 — no further work |
| `estimate_tests` 4.5 B rows (via dashboard select-with-join + exact count) | 7-day window + estimated count → ~50 rows per page, ~1 ms |
| `message_send_log` 2.18 B rows | zero reads, zero writes |
| `drip_campaign_log` 569 M rows | table truncated, no readers left |
| `drip_mobile_cycles` 303 M rows | table truncated, no readers left |
| `abnormal_history` 38 M rows | hook returns stubs, zero reads |

This should bring DB CPU/egress down to roughly the floor cost of the LIMS workflow itself. With your current data volume that's well under the $25/month free Cloud allowance.

## Things I will NOT touch (per your message)

- LIMS modules (Results / Verification / Doctor Approval / Dispatch) — already optimized in the previous rounds.
- Realtime / sync overlay / new-arrivals badge — fine as-is.
- WhatsApp Chat, Webhook, AOC proxy — untouched.
- CRM Contacts page — left in place, just not in your daily flow.

Approve and I'll implement.
