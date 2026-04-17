

## Goal
Add a **Retry** tab in `/marketing` that lists failed WhatsApp messages from marketing campaigns, lets the user **Retry All** with one click, removes any that succeed (delivered) or fail again on the second attempt, and shows a summary of how many were retried.

## Approach

### What counts as "failed"
Messages whose `delivery_status` is `"failed"` in `message_send_log` (set either by the webhook on failure callback, or by us at send-time when the API returns non-2xx). Plus rows the marketing sender currently silently drops (no log row at all). We'll fix both.

### Data we need to retry
Currently `MarketingSender.tsx` ONLY calls `logMessageSend` on success — failures are not logged at all. To make retry possible we need to persist the full send payload for every attempt.

### Plan

**1. DB migration — new column on `message_send_log`** *(approval required)*
- Add `retry_payload jsonb` — stores `{ apiUrl, apiKey, headerName, headerPrefix, payload }` snapshot for failed messages so we can replay without rebuilding.
- Add `retry_count integer default 0` — tracks how many retry attempts have been made (0, 1; once it's 1 and still fails, row gets removed).

**2. `src/components/marketing/MarketingSender.tsx` — log failures + payload**
- On both success AND failure, insert into `message_send_log` (currently only success is logged).
- Failed rows: `delivery_status = "failed"`, include `retry_payload` JSON snapshot, `message_type = "Marketing"`.
- Successful rows: behavior unchanged (status `"sent"`, no `retry_payload` needed).

**3. `src/pages/Marketing.tsx` — add Retry tab**
- Add `{ key: "retry", label: "Retry" }` to `allMarketingTabs`.
- Add `<TabsContent value="retry"><MarketingRetry /></TabsContent>`.

**4. New file `src/components/marketing/MarketingRetry.tsx`**
- Query: select from `message_send_log` where `message_type = 'Marketing'` AND `delivery_status = 'failed'` AND `retry_count < 1`, ordered by `sent_at desc`, paginated 50/page.
- Table columns: # / Patient Name / Mobile / Sent At / Days Ago / Retry Count / Error (best-effort from `error_info` linked via `message_id` on `webhook_messages`; falls back to "—").
- "Retry All" button at top-right:
  - Confirms ("Retry N failed messages?").
  - Iterates each row: increment `retry_count` to 1, then call `send-marketing-message` edge function with the saved `retry_payload`.
    - On success (2xx) → update row to `delivery_status = "sent"`, refresh `message_id` from response so webhook can track final delivery → row disappears from list.
    - On failure → row already has `retry_count = 1`, so it's excluded from the next query → disappears from list.
  - Uses 3-second delay between sends (matches sender default).
  - Shows live progress bar.
  - On completion: toast `"Retried N messages — X succeeded, Y still failed and removed from list"`.
- Auto-refreshes list after retry; manual "Refresh" icon button next to "Retry All".
- Empty state: "No failed marketing messages to retry."

### Out of scope
- Retrying non-Marketing message types (Abnormal History, ABC Cards, WhatsApp Chat, etc.) — only Marketing campaigns per request.
- Manual per-row retry (only "Retry All").
- Retry beyond 1 attempt (per spec: if 2nd attempt fails, drop it).

## Files
- New migration — add `retry_payload jsonb`, `retry_count integer default 0` to `message_send_log`.
- `src/components/marketing/MarketingSender.tsx` — log failures with payload snapshot (~20 lines added).
- `src/pages/Marketing.tsx` — register Retry tab (~3 lines).
- `src/components/marketing/MarketingRetry.tsx` — new component (~150 lines).

