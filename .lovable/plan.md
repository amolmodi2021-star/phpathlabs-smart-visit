

## Goal
Add a **Failed Date & Time** column to the Message Log table that shows when a message failed (either at send time or via webhook status callback), and ensure the Marketing Retry tab continues to use the same data point so the two views stay in sync.

## Current state
- `message_send_log.delivery_status` can be `sent` / `delivered` / `read` / `failed`.
- Failures are written in two places:
  1. **`MarketingSender.tsx`** — on send error, inserts a row with `delivery_status: 'failed'` + `retry_payload` (used by Retry tab). The `sent_at` default is `now()` so it currently doubles as "failed at" for these rows. But there is NO dedicated `failed_at` column.
  2. **`whatsapp-webhook/index.ts` `message_status` branch** — updates an existing row's `delivery_status` to whatever AOC reports (which includes `failed`). No timestamp is captured for the failure event today.
- `MarketingRetry.tsx` already reads `delivery_status='failed'` + `message_type='Marketing'` + `retry_count<1`. No change needed to its query — it will keep working unchanged.
- `MessageLog.tsx` shows Sent / Delivered / Read columns, no Failed column yet.

## Fix — three coordinated changes

### 1. Schema — add one column
```sql
ALTER TABLE public.message_send_log
  ADD COLUMN IF NOT EXISTS failed_at timestamptz;
```
Old rows stay `NULL` and render `—`. Going forward, any failure event stamps this column.

### 2. Webhook — `supabase/functions/whatsapp-webhook/index.ts`
In the `message_status` branch, when status is `failed` (AOC reports `failed` / `undelivered`), also stamp `failed_at`. Same timestamp source as delivered/read:
```ts
if (status === "failed" || status === "undelivered") mslPayload.failed_at = ts;
```
Apply in both the exact-match and base-id fallback updates.

### 3. Marketing send-time failures — `src/components/marketing/MarketingSender.tsx`
The two places that insert `delivery_status: 'failed'` rows (lines 158 and 181) also need to set `failed_at: new Date().toISOString()` so the new column is populated for client-side send failures (not just webhook-reported ones).

### 4. UI — `src/components/marketing/MessageLog.tsx`
Add a new column **"Failed Date & Time"** between *Read Date & Time* and *Days Ago*:
- Header: `<TableHead>Failed Date & Time</TableHead>`
- Cell: `{row.failed_at ? format(new Date(row.failed_at), "dd-MM-yyyy hh:mm a") : "—"}`
- Update `colSpan` from 11 to 12 in the Loading / Empty rows.
- For visual clarity, wrap failed rows' status text in a red badge — actually keep it simple, just the timestamp column is enough.

## Retry tab — no changes needed
`MarketingRetry.tsx` already filters `delivery_status='failed'` + `retry_count<1`. Adding `failed_at` doesn't affect this query. The same row that shows up as "failed" in Message Log is exactly the same row Retry sees → fully in sync, single source of truth.

## Out of scope
- No change to `MarketingRetry.tsx` (already correct).
- No change to `whatsapp-proxy` or `send-marketing-message` edge functions.
- No backfill of historical failed rows (timestamp wasn't captured before — old rows render `—`). The Retry tab already shows `sent_at` as the failure time, which is acceptable for old rows.
- No change to `logMessageSend()` helper (it only logs successful sends).

## Expected outcome
- **Send a marketing campaign with bad numbers** → failed rows appear in Message Log with the new "Failed Date & Time" column populated; `sent_at` and `failed_at` will be ~identical for client-side failures.
- **AOC reports a delivery failure later** → webhook updates the existing row → Failed column populates with AOC's timestamp on next refresh.
- **Marketing Retry tab** continues to show the same failed rows; clicking Retry All works exactly as today.
- All timestamps render as `dd-MM-yyyy hh:mm AM/PM` per project standard.

