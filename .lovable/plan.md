

# Drop skip-row writes from `drip_campaign_log` (no schema change)

## What changes

Stop persisting "skip" diagnostic rows to `drip_campaign_log`. Keep only:
- Successful sends (`status = 'sent'`)
- True errors (`loop_error`, `campaign_aborted`, `wa_api_error`, `wa_exception`)

Skipped contacts (completion_lock, already_complete, duplicate, min_interval_recheck, missing_umr, no_abnormal_history, blacklisted, invalid_mobile, etc.) stay in-memory only — they're already shown in the live Send Summary toast and the Preview Results card before sending. The Execution Log UI keeps working; it just gets cleaner (only real outcomes, no noise).

## Why it's safe

- Zero schema change, zero migration, zero data loss for anything users actually read.
- The drip engine **does not read** skip rows back to make decisions — it reads `sent` rows for dedup. Dropping skips changes nothing about engine behavior.
- The Execution Log UI shows whatever is in the table; a cleaner table is a feature, not a regression.
- Rollback = revert one file.

## Files to change

### `src/components/marketing/AutomatedMarketing.tsx`

In the `logDiagnostic` helper (the function that inserts skip rows into `drip_campaign_log`), gate the insert by status:

```ts
const KEEP_STATUSES = new Set([
  "sent",
  "loop_error",
  "campaign_aborted",
  "wa_api_error",
  "wa_exception",
]);

async function logDiagnostic(...) {
  if (!KEEP_STATUSES.has(status)) return; // drop skip rows
  // existing insert
}
```

`logDripAction(filter, contact, "sent")` is unaffected (status `'sent'` passes the gate).

No other files need changing — `prune-old-logs`, `cloudUsage.ts`, and `WhatsAppSettingsPage.tsx`'s sent-count widget all keep working as-is (the widget filters by `status='sent'`, which we're still writing).

## Optional follow-up (one-line bonus)

In `supabase/functions/prune-old-logs/index.ts`, lower `drip_campaign_log` retention from 90 → 30 days. Combined with the skip-row drop, this cuts the table to a tiny fraction of its current size within one prune cycle.

## Expected impact

| Metric | Today | After |
|---|---|---|
| Inserts into `drip_campaign_log` per drip cycle | ~30K (mostly skips) | ~500 (sent + real errors) |
| Table growth rate | high | ~98% lower |
| Engine behavior | — | unchanged |
| Execution Log UI | noisy | clean |

## Verification

1. Run one drip cycle.
2. `SELECT status, COUNT(*) FROM drip_campaign_log WHERE created_at > now() - interval '1 hour' GROUP BY status;` → only `sent` and error statuses appear.
3. Sent-count widget on WhatsApp Settings page still shows correct totals.
4. Execution Log card on Automated Marketing tab still renders, just shorter.

## Risk

Very low. One-file change, no DB migration, fully reversible.

