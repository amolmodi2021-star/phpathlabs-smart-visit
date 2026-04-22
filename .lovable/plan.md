

# How to cut Lovable Cloud network usage (currently 81%)

## Where the bytes are going

Storage is tiny (1.4 MB across all buckets) and edge functions are minor. **Network = database rows shipped to browsers.** The four biggest culprits in your codebase:

| Source | Approx. bytes per trigger | Trigger frequency |
|---|---|---|
| **Marketing → "Refresh pending counts"** pulls 35K contacts + 54K abnormal tests + 11K drip logs + 4K cycles | **~6 MB** | Every click + every campaign run preflight |
| **Marketing → Run Drip preflight** (`collectEligibleRecords`) pulls the same dataset again | **~6 MB** | Every send cycle (plus per-batch refresh) |
| **CRM → Export Excel** pulls all 35K contacts with every column | **~12 MB** | Each export click |
| **Realtime fan-out on `message_send_log`** broadcasts every row insert to every open tab | small per row, but **~2 KB × 2,000 rows = 4 MB per campaign** | Every campaign |

Plus 538 `select("*")` calls across the app inflate every read by 30–60% with columns nobody renders.

## Plan — five focused cuts, ranked by ROI

### 1. Slim the pending-counts query (saves ~70% of marketing page network)

Today `pendingCounts` ships every column of `crm_contacts` (large `remarks`, `created_by`, etc.) even though only 6 fields are used. Then it ships every row of `crm_abnormal_tests` even though only the distinct `contact_primary_key` is needed.

- Replace the `crm_abnormal_tests` `select("contact_primary_key")` with a server-side **RPC `get_abnormal_pks()`** that returns just the deduplicated PK array (~3K unique vs 54K rows).
- Replace `crm_contacts.select("primary_key,mobile_number,umr_number,patient_name,last_sent_type,last_sent_date")` with the same column list scoped to **only contacts with a non-null mobile_number** server-side via a tiny RPC `get_drip_contact_slice()`. Saves the rows where mobile is blank.
- Apply the same two slim reads inside `collectEligibleRecords` (the actual send pipeline), so each campaign run also benefits.

**Estimated saving:** ~4 MB per refresh × ~50 refreshes/day = **~200 MB/day**.

### 2. Cache pending counts for 5 minutes (saves repeat clicks)

Currently `staleTime: Infinity` + manual refetch — but every refetch re-pulls everything. Add a 5-minute `dataUpdatedAt` guard on the manual Refresh handler that short-circuits if the last successful fetch was <5 min ago and shows a "fresh" toast instead of refetching. Marketing engineers tend to click Refresh several times in a row.

### 3. Stream CRM export to CSV instead of paginating JSON

The Excel export pulls 35K rows of every column over the network as JSON (~12 MB), then converts client-side. Replace with an **edge function** `export-crm-contacts` that:
- Streams a CSV directly from Postgres (`COPY ... TO STDOUT`-style via a server-side query).
- Returns `text/csv` as a download — browser writes straight to disk.

CSV vs JSON for the same data is ~40% smaller, plus zero column-name repetition per row. **Estimated saving: ~8 MB per export.** Excel opens CSV natively so the UX is unchanged.

### 4. Disable realtime on `message_send_log` during campaigns

`useRealtimeSync("message_send_log", …)` is already debounced, but the WebSocket still receives every row insert payload (~2 KB each). For a 2,000-card campaign that's ~4 MB of incoming WebSocket traffic per open tab. The component already supports an `enabled: !sending` toggle — verify it's wired up and extend the same pattern to:
- `useRealtimeSync` on `message_send_log` in AutomatedMarketing → `enabled: !sending`.
- Same for `drip_campaign_log` if subscribed elsewhere.

### 5. Audit the worst `select("*")` offenders

Top 10 hot paths (CRM contacts, abnormal tests, drip logs, message_send_log, patient_registrations, tests, lims_test_results) get explicit column lists. We will NOT touch the 538 calls blindly — only the ~10 that hit tables >1K rows. Each saves 30–60% of bytes per fetch.

## Files changing

| File | Change |
|---|---|
| `supabase/migrations/<new>.sql` | Create RPCs `get_abnormal_pks()` and `get_drip_contact_slice()` returning slim shapes |
| `src/components/marketing/AutomatedMarketing.tsx` | Use new RPCs in `pendingCounts` and `collectEligibleRecords`; add 5-min stale-skip on manual refresh; ensure `useRealtimeSync(message_send_log, …, { enabled: !sending })` |
| `supabase/functions/export-crm-contacts/index.ts` (new) | Stream CSV export of `crm_contacts` with applied filters |
| `src/components/crm/CRMContacts.tsx` | Replace pagination loop in `handleExport` with a single edge-function fetch + blob download |
| ~10 other files | Replace `select("*")` with explicit column lists on the largest tables only |

## What stays untouched

- Drip send logic, filters, priorities, templates.
- All UI & page layouts.
- Storage buckets (already tiny).
- The 500+ `select("*")` calls on small tables (<500 rows) — not worth the churn.

## Expected impact

If you currently trend at the 81% Network share with ~50 marketing refreshes + a handful of CRM exports + 1–2 campaigns per day, this should drop network usage by **~60–70%**, putting Network roughly on par with Database server (~25–30%) instead of dominating.

## Risk

Low. Each change is independently revertible: RPCs are additive; export edge function is new; the realtime toggle pattern is already used elsewhere in the codebase. No schema changes, no auth changes, no destructive migrations.

## Verification

1. After deploy, open `/marketing`, click Refresh on Pending Counts, confirm numbers match what you see today.
2. Run a small drip cycle (3 sends) and confirm queue/log behavior unchanged.
3. Export CRM contacts — file should download faster and open identically in Excel.
4. Wait 24h and re-check the Cloud Usage page — Network share should drop noticeably.

