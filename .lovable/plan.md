

## Goal
Add a **Cloud Usage** page (sidebar entry) that gives you a live, detailed breakdown of everything consuming Lovable Cloud credits — storage, database tables, edge function activity, cron jobs — with **one-click "Run Now" buttons** that invoke the cleanup/prune functions immediately and show what was freed.

## What you'll see on the page

Five sections, each refreshable, each with on-demand action buttons.

### 1. Overview cards (top)
- Total DB size · Public schema size · Total storage used · Active edge functions · Active cron jobs
- Last cleanup run timestamps (loyalty cleanup, snip cleanup, log prune)

### 2. Storage breakdown
Per-bucket table:
| Bucket | Files | Size | >7 days old | >30 days old | Action |
|---|---|---|---|---|---|
| loyalty-cards | 123 | 54 MB | 123 | 0 | **[Run Cleanup Now]** |
| report-uploads | 89 | 50 MB | 89 | 89 | **[Purge Orphan Bucket]** ⚠ |
| outsourced-snips | 31 | 1.7 MB | 29 | 0 | **[Run Cleanup Now]** |
| (others) | … | … | … | … | — |

Notes shown inline:
- `report-uploads` is flagged as **orphan** — the AI report feature that wrote to it was deleted. A new "Purge Orphan Bucket" button (password-gated, 9819111107) deletes every file in it in one call.
- `loyalty-cards` shows what the existing cleanup will remove (>6 hours old).

### 3. Database table sizes
Top 15 tables sorted by bytes, with row counts. Highlights tables eligible for retention pruning:
| Table | Size | Rows | Retention | Last pruned | Action |
|---|---|---|---|---|---|
| crm_contacts | 24 MB | … | never | — | (clinical, kept) |
| crm_abnormal_tests | 17 MB | 54,269 | **forever** | — | (clinical, kept) |
| message_send_log | 9.4 MB | 16,933 | 180 d | … | **[Prune Now]** |
| abnormal_history | 8.8 MB | 9,711 | **forever** | — | (clinical, kept) |
| drip_campaign_log | 2.8 MB | 9,425 | 90 d | … | **[Prune Now]** |
| webhook_messages | 648 kB | 386 | 90 d | … | **[Prune Now]** |
| lims_interface_logs | 256 kB | 153 | 90 d | … | **[Prune Now]** |
| app_user_login_history | … | 153 | 365 d | … | **[Prune Now]** |

A single **"Run Full Prune Now"** button at the top invokes `prune-old-logs` for every table at once and shows per-table deletion counts.

### 4. Edge functions (live activity)
Lists all 12 deployed functions with **last 7 days invocation count** and **average execution time**, pulled from the analytics logs. Lets you confirm dead functions stay at 0 invocations.

### 5. Cron jobs
Reads `cron.job` and shows:
| Job | Schedule | Active | Last run | Action |
|---|---|---|---|---|
| cleanup-card-images-midnight | 30 18 * * * | ✅ | … | **[Run Now]** |
| cleanup-outsourced-snips-daily | 30 18 * * * | ✅ | … | **[Run Now]** |
| prune-old-logs-nightly | 0 19 * * * | ✅ | … | **[Run Now]** |

"Run Now" buttons directly invoke the function (same as the cron would) — no need to wait for the schedule.

## How "Run Now" actions work
Each button calls `supabase.functions.invoke("<function-name>")` directly. After completion, a toast shows results, e.g. *"Pruned 1,247 message_send_log rows. 8.2 MB freed."* The dashboard auto-refetches its stats. **No new cron jobs are added** — these are pure on-demand triggers, so they cost only when you click.

## Backing data — RPCs (no client-side guesswork)
One new SQL function returns everything in a single call so the page loads fast:

```sql
get_cloud_usage_stats() RETURNS jsonb
-- bundles: db_size, public_schema_size, per-bucket counts/sizes,
-- top-15 table sizes + row counts, cron jobs list, last-run timestamps
```

Last-run timestamps are inferred from the most recent `created_at` in `lims_interface_logs` for the prune job, and from a new lightweight `cleanup_runs` table (one row per run) populated by the three cleanup edge functions.

## Files

### New
- `src/pages/CloudUsage.tsx` — the dashboard page.
- `src/components/cloud/StorageBreakdown.tsx`, `DatabaseTables.tsx`, `EdgeFunctionActivity.tsx`, `CronJobs.tsx` — the 4 sections.
- `src/lib/cloudUsage.ts` — wraps the RPC + button actions.

### Edit
- `src/components/AppLayout.tsx` — add **"Cloud Usage"** sidebar entry (icon: `Cloud`), gated by `isActionAllowed("cloud_usage")` so only admins see it.
- `src/App.tsx` — register `/cloud-usage` route.
- `supabase/functions/cleanup-card-images/index.ts`, `cleanup-outsourced-snips/index.ts`, `prune-old-logs/index.ts` — append a row to `cleanup_runs` table at end of each successful run (1-line insert).

### Migration
- Create `cleanup_runs` table: `(id, function_name text, ran_at timestamptz, summary jsonb)`.
- Create `get_cloud_usage_stats()` SECURITY DEFINER function reading from `pg_tables`, `storage.objects`, `cron.job`, `cleanup_runs`.
- Create `purge_bucket(bucket_name text, password text)` function — gated by the `9819111107` password — deletes all `storage.objects` rows for the named bucket. Used by the "Purge Orphan Bucket" button for `report-uploads`.

## Security
- Page only shown to users with the `cloud_usage` action permission (admin-only).
- Destructive actions (Full Prune, Purge Orphan Bucket) require the standard `9819111107` password via `DeletePasswordDialog`.
- All cleanup functions remain `verify_jwt = false` (called from cron); the dashboard invokes them with anon key as cron does.

## Analytics — what's currently consuming credits (today's snapshot)
| Source | Now | Notes |
|---|---|---|
| Storage | **108 MB total** | loyalty-cards 54 MB + report-uploads 50 MB (orphan) = 96% of total |
| DB | **245 MB** (public 69 MB) | crm_contacts + crm_abnormal_tests = 60% of public, both clinical (kept) |
| Edge fn invocations (7 d) | **1** | webhook only — earlier cleanup worked |
| Cron jobs | 3 active, all daily | minimal cost |

**Single biggest immediate win:** purging `report-uploads` reclaims 50 MB instantly (one click on the new dashboard).

## Out of scope
- Building a billing-dollar estimator (Lovable Cloud billing isn't exposed via API).
- Any change to clinical data retention.
- Adding new cron schedules — everything stays on-demand or on the existing 3 daily crons.

## Expected impact
- Full visibility into every credit-consuming surface, in-app.
- One-click action on every issue = no more waiting for crons or SQL.
- `report-uploads` 50 MB freed on first use.
- Future spikes detectable in seconds instead of going unnoticed for weeks.

