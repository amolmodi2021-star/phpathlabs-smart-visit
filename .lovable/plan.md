

## Problem
The Automated/Drip send loop runs **client-side in the browser tab**. When the user closes the tab:
1. The `for` loop stops mid-batch — remaining contacts never get their WhatsApp message.
2. But CRM contacts may have already been marked as "sent" if the code updates `last_sent_type`/`last_sent_date` before or independently of the actual send result, OR if a batch was marked complete optimistically.
3. The progress bar (status section) is purely React state — it disappears on reload because nothing is persisted.

User wants: **server-side execution** so closing the browser does not interrupt sending, plus a **persistent progress view** that re-displays on reopen.

## Investigation needed (during implementation)
Read these files to confirm exact behavior before coding:
- `src/components/marketing/AutomatedMarketing.tsx` — the drip loop, where CRM "sent" markers are written, what state drives the progress bar.
- `src/lib/marketingDelay.ts` and `supabase/functions/send-marketing-message/index.ts` — already used; the new server runner will reuse them.
- `mem://logic/marketing/drip-engine-rules` — locking, dedupe, blacklist rules to preserve.
- `mem://features/marketing/drip-trial-mode` — trial mode (3-msg cap, no DB writes) must remain client-side.

## Fix — move the drip run server-side

### A. New table — `drip_runs` (single source of truth for progress)
Columns:
- `id uuid pk`, `created_at`, `updated_at`
- `status text` — `queued` / `running` / `paused` / `completed` / `failed` / `cancelled`
- `campaign_type text` — `abc` / `abnormal` / `promotion` (matches existing drip categories)
- `template_name text`, `template_payload jsonb` (resolved template + filter snapshot)
- `total_count int`, `sent_count int`, `failed_count int`, `skipped_count int`
- `current_index int` (resume pointer)
- `started_by text` (username), `started_at`, `finished_at`
- `error text`
- `contact_queue jsonb` — frozen ordered list of `{primary_key, mobile, patient_name, umr_number, …}` snapshotted at run start so deletions/edits during run don't break it
- `cancel_requested boolean default false`

RLS: same pattern as other operational tables (authenticated read/write).

### B. New edge function — `run-drip-campaign`
- Triggered via `supabase.functions.invoke("run-drip-campaign", { body: { runId } })` and returns immediately (fire-and-forget from the client perspective; the function uses `EdgeRuntime.waitUntil` so execution continues after the HTTP response).
- Loop body (mirrors current client loop in `AutomatedMarketing.tsx`):
  1. Read `drip_runs` row by `runId`. Check `cancel_requested` each iteration → if true, set `status='cancelled'`, exit.
  2. For each contact starting at `current_index`:
     - Skip if blacklisted / missing data (existing rules).
     - Build payload, call WhatsApp proxy (same path as `send-marketing-message`).
     - On success: `logMessageSend()` with `delivery_status='sent'`; update CRM `last_sent_type`/`last_sent_date` **only after** the proxy returns 2xx.
     - On failure: `logMessageSend()` with `delivery_status='failed'` + `failed_at=now()` so the Retry tab picks it up. Do **not** mark CRM as sent.
     - Increment counters, persist `current_index`, `sent_count`, `failed_count`, `skipped_count`, `updated_at` after every message.
     - `await new Promise(r => setTimeout(r, delayMs))` using the global `wa_global_delayMs` setting.
  3. On loop end: `status='completed'`, `finished_at=now()`.
- Wrap the whole body in try/catch → on uncaught error: `status='failed'`, `error=String(err)`.
- Re-entrancy: if function restarts (Edge timeout, redeploy), a separate "watchdog" can resume — out of scope for v1; document as known limitation.

### C. UI changes — `src/components/marketing/AutomatedMarketing.tsx`
1. **Replace the in-browser send loop** for live mode with: insert a `drip_runs` row → invoke `run-drip-campaign` → start polling that row.
2. **Trial mode unchanged** — keeps the 3-message client-side path (no DB writes) per existing memory rule.
3. **Persistent progress bar**:
   - On mount, query `drip_runs` for any `status in ('running','queued','paused')` → if found, render the progress bar using that row.
   - Subscribe via Supabase Realtime to that row for live updates (no polling needed) — fall back to a 3-second `setInterval` poll if realtime isn't set up.
   - Show: campaign type, sent/failed/skipped/total, percent, elapsed time, **Cancel** button (sets `cancel_requested=true`).
4. **Reopening behavior**: closing the tab no longer affects the run. Reopening any browser shows the live progress bar exactly because state lives in `drip_runs`.

### D. Realtime
Add `drip_runs` to `supabase_realtime` publication so the UI can subscribe to row updates.

### E. Fix the "marked sent but not actually sent" risk
Audit current code path: any CRM `last_sent_type`/`last_sent_date` write happens **only after** a successful proxy response (2xx + no error in body). Move it inside the success branch in the new edge function. Failures stay marked `failed` in `message_send_log` (visible in Retry).

## Out of scope
- Resuming after edge-function timeout (rare; >150s runs). Long batches still complete because each message is fast and the function runs in `EdgeRuntime.waitUntil`.
- Trial mode server-side execution (intentionally client-side per memory).

## Expected outcome
- Click **Send** in Automated tab → a `drip_runs` row is created, server starts processing → progress bar appears.
- Close the browser tab → server keeps sending; CRM updates only for actually-delivered messages; failures appear in Retry tab.
- Reopen the app on any device → progress bar reappears with live counts and a Cancel button.
- When complete, the bar shows final totals and disappears on next load (or shows "Last run: completed at …").

