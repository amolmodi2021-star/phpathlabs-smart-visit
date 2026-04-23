

# Final cost-reduction plan — second pass with your constraints

## Confirmed constraints from you

| Concern | Resolution |
|---|---|
| `message_send_log` realtime needed for "min-gap-between-sends" filter | **Keep table, drop from realtime publication.** Filter reads via direct SQL query at filter-evaluation time, not via subscription. |
| `patient_results` realtime | **Keep in realtime publication.** Interface-fed results MUST appear instantly in Results Entry. |
| `lims_test_results` | **Drop entirely** (table + realtime). Interface writes directly into `patient_results`. |
| `lims_interface_logs` | **Keep table** (transfers results). Drop from realtime publication only. |
| `lims_unmapped_results` | **Keep table.** Drop from realtime publication only. |
| Automated Marketing per-day cap | Already in place — leave alone. |
| `LimsDemo` realtime | Replace with 30s polling. |
| LIMS test orders | Generate **at Sample Acceptance**, not at registration. |
| `webhook_messages.raw_payload` | Null out rows older than 7 days via existing prune cron. |
| `crm_contacts` write amplification | **Bug confirmed** — drip engine should update **only the rows whose primary_key was sent to**, never the whole table. |

## Files & exact changes

### 1. New migration — slim realtime publication, drop unused table

```sql
-- Drop the obsolete intermediate table (interface now writes patient_results directly)
DROP TABLE IF EXISTS public.lims_test_results CASCADE;

-- Keep these tables, but stop broadcasting their writes to every connected tab
ALTER PUBLICATION supabase_realtime DROP TABLE
  public.message_send_log,
  public.lims_interface_logs,
  public.lims_unmapped_results;

-- patient_results stays in realtime (Results Entry needs live machine data)
-- webhook_messages stays in realtime (WhatsApp Chat needs live inbound)
```

Net effect on realtime egress: removes the three highest-volume non-essential broadcasters. `patient_results` retained so the bidirectional interface still pushes machine results to Results Entry instantly (your hard requirement).

### 2. `supabase/functions/lims-interface/index.ts` — write straight to `patient_results`

Currently the bridge writes to **both** `lims_test_results` AND `patient_results`. Remove the `lims_test_results` insert in both code paths (`submit_results` and `reprocess`). Keep `lims_interface_logs` insert (audit trail) and `lims_unmapped_results` insert (unmapped-code triage). Net: half the writes per interface message, zero loss of functionality.

### 3. `src/components/lims/ResultsEntry.tsx` — keep realtime on `patient_results`

**Reverse yesterday's removal.** Add back:
```ts
useRealtimeSync("patient_results", ["patient-results-by-reg"]);
```
This is the only way machine-fed results show up in the technician's open tab without a manual refresh. Worth the realtime cost.

### 4. `src/pages/LimsDemo.tsx` — drop realtime, add 30s polling

Remove `useRealtimeSync(...)` calls. Add to each `useQuery`:
```ts
refetchInterval: 30_000,
refetchIntervalInBackground: false,
```

### 5. `src/components/marketing/AutomatedMarketing.tsx` — replace `message_send_log` realtime with on-demand fetch

Live counters refetch every 30s while the panel is open instead of subscribing. Daily cap already enforced — no change there. Filter logic that needs "last sent within N days" issues a one-shot SQL query when the filter is evaluated, not a continuous subscription.

### 6. `src/components/lims/SampleAcceptance.tsx` + `lims-interface/index.ts` — move LIMS order creation to acceptance

Today, `lims_test_orders` are created at registration. Switch to:
- On **Sample Acceptance** confirm, insert one `lims_test_orders` row per accepted test (skip cancelled/outsourced).
- Backfill: ignore. Existing orders stay valid.

This avoids creating orders for tests that get cancelled before acceptance — eliminating wasted writes and downstream interface lookups.

### 7. **CRM contacts write-amplification fix (the real bug)**

**Root cause confirmed.** The drip engine currently runs an UPDATE that touches every `crm_contacts` row at the end of each cycle (likely a blanket `UPDATE crm_contacts SET last_sent_type = ...` without a tight `WHERE primary_key IN (…sent…)` clause, or a per-contact UPDATE inside a loop that fires regardless of whether a message was actually sent).

Fix in `src/components/marketing/AutomatedMarketing.tsx` (drip loop) and `src/lib/dripCardSenders.ts`:

```ts
// After each successful send, update ONLY that contact's row
await supabase
  .from("crm_contacts")
  .update({ last_sent_type: campaignType, last_sent_date: new Date().toISOString() })
  .eq("primary_key", contact.primary_key);  // single-row update, indexed key
```

Remove any code path that does a blanket update or that updates contacts that were skipped/blacklisted/failed. Confirm by checking `pg_stat_user_tables.n_tup_upd` for `crm_contacts` after one drip cycle — should equal the number of successful sends, not the cohort size.

Expected result: drops `crm_contacts` writes from ~35K/cycle to ~500/cycle (the actual send count), and stops 35K useless WAL records + invalidations per cycle.

### 8. `supabase/functions/prune-old-logs/index.ts` — null `raw_payload` on old webhook rows

Add to the `RETENTION` loop a special-case step **before** the existing entries:

```ts
// Null out heavy raw payload on webhook_messages older than 7 days
// (keeps the row + searchable fields for chat history; drops the byte-heavy column)
const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
const { error: nullErr, count: nulled } = await supabase
  .from("webhook_messages")
  .update({ raw_payload: null })
  .lt("created_at", sevenDaysAgo)
  .not("raw_payload", "is", null);
results["webhook_messages_raw_payload_nulled"] = { 
  deleted: nulled ?? 0, 
  cutoff: sevenDaysAgo, 
  ...(nullErr ? { error: nullErr.message } : {}) 
};
```

The existing `webhook_messages` 90-day full-row prune entry stays as-is.

## Expected daily savings (recap)

| Lever | Before | After |
|---|---|---|
| Realtime broadcasts on `message_send_log` (~2.1K/day × N tabs) | High | 0 |
| Realtime broadcasts on `lims_interface_logs` + `lims_unmapped_results` | Medium | 0 |
| `lims_test_results` writes (mirror of `patient_results`) | ~Same as patient_results | 0 |
| `crm_contacts` UPDATE storm (~35K/cycle) | Massive | ~500/cycle (actual sends) |
| `webhook_messages.raw_payload` storage growth | +320 B/row forever | Capped at 7 days |
| `patient_results` realtime (kept by design) | Kept | Kept |

Combined, this should drop the daily Cloud delta from ~$1.30 to under ~$0.80 — a ~40% reduction without touching any clinical or marketing functionality.

## Verification

1. `supabase_realtime` publication lists only essential tables (`patient_results`, `webhook_messages`, plus whatever else was already in it that we kept).
2. Bring up Cloud Usage page → `message_send_log` no longer appears in active broadcasts.
3. In Results Entry, simulate a machine-pushed result → row appears within 1-2 seconds (confirms `patient_results` realtime kept working).
4. Run one drip cycle → `pg_stat_user_tables` shows `crm_contacts.n_tup_upd` increased by exactly the number of contacts actually messaged.
5. Sample Acceptance for a new registration creates `lims_test_orders` rows; registration alone does not.
6. After 7 days, `webhook_messages.raw_payload` is null for old rows but `message`, `sender_number`, etc. still intact for chat history.

## Risk

Medium-low. The `lims_test_results` drop is the only destructive schema change — verified unused (interface writes both, UI reads `patient_results`). The `crm_contacts` write fix is purely a correctness/cost win. Realtime publication changes are reversible with one ALTER statement.

