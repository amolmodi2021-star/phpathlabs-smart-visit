

## Root cause

AOC's status callbacks are arriving correctly at the webhook. The webhook tries two-pass matching:
1. **Exact** match (e.g. `403ab5cf-...:1`)  
2. **Base** fallback (strip `:1` → `403ab5cf-...`) — **but only when the exact pass returns 0 rows**

Edge logs show **every single status update logs `wm_exact: 0, msl_exact: 0`** → the exact pass always misses (correct, AOC adds `:1`) → the code then enters the fallback branch which updates `message_send_log.delivery_status` to `delivered`/`read` on the base UUID row… **but it does NOT write the timestamp** (`delivered_at` / `read_at`).

So `message_send_log.delivery_status` is being updated to `delivered`/`read` correctly. The problem is two-fold:

### Problem 1 — `MessageLog.tsx` reads timestamps from the wrong place
The component looks up `delivered_at` / `read_at` by joining to `webhook_messages` rows where `direction='outbound'` and `delivery_status in ('delivered','read')`. But the marketing message_ids **don't exist** in `webhook_messages` at all — only auto-reply outbound messages get inserted there. The webhook has NO row to update for marketing sends, so the `JOIN` returns `[]` → both columns show `—`.

### Problem 2 — `message_send_log` has no timestamp columns for delivery/read
Even if we read directly from `message_send_log`, the only timestamp on that table is `sent_at`. Status transitions are stored as a single `delivery_status` enum string with no `delivered_at` / `read_at` columns.

Combined: **the system never persists a timestamp for the delivered or read events of marketing sends**, so the column will always render `—`.

## Fix — two coordinated changes

### 1. Schema: add timestamp columns to `message_send_log`
```sql
ALTER TABLE message_send_log
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz,
  ADD COLUMN IF NOT EXISTS read_at      timestamptz;
```
No backfill possible (timestamps weren't captured historically) — old rows stay `NULL` and render `—`. New status events from now on populate correctly.

### 2. `supabase/functions/whatsapp-webhook/index.ts`
In the `message_status` branch, when status is `delivered` or `read`, also stamp the corresponding column. Use the AOC `statuses.timestamp` (Unix seconds) when present, otherwise `now()`:

```ts
const ts = statusData.timestamp
  ? new Date(Number(statusData.timestamp) * 1000).toISOString()
  : new Date().toISOString();

const mslPayload: Record<string, any> = { delivery_status: status };
if (status === "delivered") mslPayload.delivered_at = ts;
if (status === "read")      mslPayload.read_at      = ts;
```
Apply the same payload in both the exact-match and the base-id fallback branches for `message_send_log` (the `webhook_messages` updates stay as-is — they only matter for inbound/auto-reply rows).

### 3. `src/components/marketing/MessageLog.tsx`
Stop the secondary `webhook_messages` lookup. Read `delivered_at` and `read_at` directly from the `message_send_log` row. Removes ~30 lines of dead JOIN code and a redundant query per page render.

```ts
// remove the messageIds → webhook_messages query block entirely
const enrichedRows = rows || [];   // delivered_at / read_at come from the row itself
```
The existing column rendering (`row.delivered_at ? format(...) : "—"`) already works against these fields once they exist.

## Why this is the right fix
- One source of truth: `message_send_log` owns the lifecycle of every outbound send.
- Webhook writes both the status **and** its timestamp atomically, so the UI never has to reconcile two tables.
- Removes one extra query per Message Log page load.
- Old rows (no captured timestamps) gracefully render `—`; future rows show correct delivered/read times.

## Out of scope
- No change to inbound auto-reply logging.
- No change to `whatsapp-proxy` or marketing send code.
- No change to RLS — `message_send_log` already has the necessary policies.
- No backfill of historical rows (data was never captured; cannot be recovered).

## Expected outcome
- Send a marketing message → row appears in Message Log with `Sent` time only (as today).
- ~5 seconds later AOC fires `delivered` callback → webhook writes `delivered_at` → row shows delivered time on next refresh.
- When recipient opens the message → AOC fires `read` callback → `read_at` populated → column shows read time.
- Both columns format as `dd-MM-yyyy hh:mm AM/PM` per project standard.

