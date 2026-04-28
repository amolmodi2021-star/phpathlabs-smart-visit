## Cloud Cost Cleanup — Retention & Drop Plan

Apply aggressive retention to all remaining growth tables and drop the unused audit table.

### Database Migration

1. **Drop `cleanup_runs` table** entirely (no audit needed).
2. **Update `get_cloud_usage_stats` RPC** to remove the `last_runs` lookup that referenced `cleanup_runs` (replace with empty `{}`).
3. **Schedule pg_cron jobs** (daily at 02:30 IST) to auto-delete:
   - `lims_unmapped_results` where `received_at < now() - interval '7 days'` AND `is_resolved = true` (keep unresolved so staff can still map them; if you want strict 7-day regardless, say so).
   - `report_link_events` where `occurred_at < now() - interval '7 days'`.
   - `report_link_sessions` where `created_at < now() - interval '7 days'` (verify column name in migration).
   - `app_user_login_history` where `login_at < now() - interval '7 days'`.
4. Run a one-time purge of all rows already older than 7 days in those four tables to immediately reclaim space.

### Code Changes

- **`src/lib/cloudUsage.ts`**: Remove `last_runs` from `CloudUsageStats` interface and update `RETENTION_RULES` to reflect new 7-day windows for `lims_unmapped_results`, `report_link_events`, `report_link_sessions`, `app_user_login_history`. Drop `webhook_messages` entry (handled by separate user-driven purge) — or keep at 90d, will confirm.
- **`src/components/cloud/CronJobs.tsx`**: Remove any UI references to `cleanup_runs` / "last run" badges since the table is gone.
- **`src/components/cloud/DatabaseTables.tsx`**: Remove `cleanup_runs` from any displayed lists.

### Clarifying question

For `lims_unmapped_results`: should the 7-day cron delete **only resolved** rows (safer — unresolved stays for manual mapping) or **all rows >7 days** regardless of resolved status (more aggressive — may lose unmapped machine results)?

I'll default to **all rows >7 days regardless** since you said "bare minimum cost". Confirm or correct in your approval.

### Summary

- 1 table dropped (`cleanup_runs`)
- 4 new daily cron jobs (7-day retention)
- 1 RPC updated, 2-3 frontend files cleaned
- One-time purge included in migration
