

## Goal
Replace the every-minute `process-report-queue` cron with **on-demand refresh buttons** on the pages that need it, and adjust DB retention so `webhook_messages` is capped at **90 days** while **all abnormal results are kept forever** (no archival).

## Why this saves credits
The `process-report-queue` cron currently fires 10,080 times/week, almost always to find an empty queue. The Upload Reports page already has its own client-side trigger loop (`triggerQueueProcessor`) that auto-runs after every upload — the cron is redundant. Removing it eliminates ~99% of edge invocations on this function.

## Changes

### 1. Process-report-queue — on-demand only
- **Disable the existing cron** that calls `process-report-queue` every minute (drop the `cron.schedule` entry).
- **Keep the edge function as-is** (still callable via `supabase.functions.invoke`).
- **Add early-exit guard** anyway: if zero pending rows, return immediately (~5 ms) — keeps manual refresh cheap.
- **Add a "Process Queue Now" refresh button** on the pages where queued reports surface:
  - `src/pages/UploadReport.tsx` — already has a Refresh button; add a second **"Process Queue"** button that calls the function directly and shows a toast with how many were processed.
  - `src/pages/ExtractionCorrections.tsx` — add the same button at the top so corrections reviewers can kick the queue without leaving the page.
  - `src/pages/ReviewReport.tsx` — add the same button so reviewers can pull the next pending report on demand.
- All three buttons share a tiny helper `triggerReportQueue()` (in `src/lib/reportQueue.ts`, new file) that:
  - Calls `supabase.functions.invoke("process-report-queue")` in a loop until `remainingPending === 0` (max 20 iterations as a safety cap).
  - Shows progress toast `"Processed N reports, M remaining…"`.
  - Disables the button while running.

### 2. Webhook messages — 90-day retention
- Add `webhook_messages` to the existing `prune-old-logs` retention list with **90 days**, column `created_at`.
- Verify the cron is actually firing (the previous deploy reported it failing silently). Re-create the cron with a valid `Authorization: Bearer <anon_key>` header at 19:00 UTC daily.

### 3. Abnormal results — KEEP FOREVER
- Explicitly **do not** add `crm_abnormal_tests`, `abnormal_history`, or any abnormal-related table to the prune list.
- Add a code comment in `prune-old-logs/index.ts`:  
  `// NOTE: Abnormal tables are intentionally never pruned — required for long-term clinical analytics.`

## Files

### Edit
- `supabase/functions/process-report-queue/index.ts` — add early-exit guard when queue is empty.
- `supabase/functions/prune-old-logs/index.ts` — add `webhook_messages` (90 d) row; add explicit "do not prune abnormal" comment.
- `src/pages/UploadReport.tsx` — add visible "Process Queue Now" button that uses the new helper.
- `src/pages/ExtractionCorrections.tsx` — add the same button.
- `src/pages/ReviewReport.tsx` — add the same button.

### New
- `src/lib/reportQueue.ts` — shared `triggerReportQueue()` helper (loop + toast + completion check).

### Migration
- DROP the existing `process-report-queue-every-minute` cron entry.
- Re-create `prune-old-logs-nightly` cron with the correct `Authorization` header (fixes the silent failure).

## Out of scope
- The full Cloud Usage admin dashboard (deferred — this is a focused fix).
- Storage cleanup changes (already deployed in previous round).
- Any change to abnormal-results tables.

## Expected impact
| Item | Before | After |
|---|---|---|
| `process-report-queue` invocations / week | 10,080 | ~5–50 (only when user clicks) |
| `webhook_messages` growth | unbounded | capped at ~90 days |
| Abnormal data | unchanged | unchanged (kept forever) |

