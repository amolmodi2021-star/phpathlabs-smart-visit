

## Diagnosis (verified against DB)

You said the Retry tab doesn't show `9925039222` (UMR0000857|9925039222) even though Message Log shows it as failed. I queried the DB:

| field | value |
|---|---|
| message_type | **ABC** (not "Marketing") |
| delivery_status | failed |
| retry_payload | **NULL** |
| failed_at | 2026-04-19 05:08:40 |

Aggregated across all failed rows in `message_send_log`:

| message_type | total | with retry_payload |
|---|---|---|
| **ABC** | 199 | **0** |
| **Abnormal History** | 2 | **0** |
| Marketing | 0 | 0 |

### Two problems combine to hide every failed row from the Retry tab

1. **Wrong filter.** `MarketingRetry.tsx` line 36 hard-codes `eq("message_type", "Marketing")`. Real failures in production are **ABC** and **Abnormal History** sends — never "Marketing" (no marketing campaigns sent in this DB). So the filter excludes 100% of actual failures.

2. **No `retry_payload` for ABC / Abnormal History.** These are sent via `logMessageSend()` (lib/messageLog.ts), which only writes `delivery_status='sent'`. The carrier (AOC) later asynchronously reports `failed` via webhook, which flips status to `failed` + stamps `failed_at` — but no payload was ever captured because the original send succeeded at the API level. So even after fixing the filter, there's nothing to re-POST.

This is why the row is visible in Message Log but invisible in Retry, and why no failures have ever appeared in Retry since these two message types started flowing through `logMessageSend`.

## Fix

### 1. Broaden the Retry filter — `src/components/marketing/MarketingRetry.tsx`

Replace the `message_type = 'Marketing'` filter with an `IN` list covering all retryable message types:

```ts
.in("message_type", ["Marketing", "ABC", "Abnormal History"])
.eq("delivery_status", "failed")
.lt("retry_count", 1)
```

Also widen the `select` to fetch `message_type`, `umr_number`, `primary_key`, `failed_at` so the table can show enough context.

### 2. Add a Message Type column + reconstruct payload at retry time

For rows **with** `retry_payload` (Marketing campaigns) → behavior unchanged (re-invoke `send-marketing-message`).

For rows **without** `retry_payload` (ABC / Abnormal History from CRM/AbnormalHistory flow) → at retry click, rebuild a minimal text-template send by:
- Loading global WhatsApp settings (`wa_global_baseUrl`, `wa_global_apiKey`, `wa_global_authHeaderName`, `wa_global_authHeaderPrefix`, `wa_global_fromNumber`) — same source `MarketingSender` and `CRMContacts` use.
- Looking up the contact in `crm_contacts` by `primary_key` (or `mobile_number` fallback) to get `patient_name`, `umr_number`, `default_discount_pct`.
- Building a plain template payload (no image header for ABC retries — image card is already gone; we just resend the WhatsApp template body so the message lands). Use a configurable retry template name from `app_settings` key `wa_retry_template_abc` and `wa_retry_template_abnormal`, falling back to the original WhatsApp template name stored on the most recent successful send for that mobile (looked up from `message_send_log` order by `sent_at desc`, picking `message_id` → join not necessary; we just resend a generic template).

Simpler and more reliable: **for retryable rows without payload, call `whatsapp-proxy` directly with a minimal retry payload** built from CRM data — exactly as `CRMContacts.tsx` lines 782–796 do. The WhatsApp template name + components mapping can be sourced from a single `app_settings` row per type so this stays one-config, no per-row guessing.

### 3. Display improvements

- Add columns: **Message Type**, **UMR / Primary Key**, **Failed At**.
- Group the "Retry All" button by type — one button per available type, so user can retry only ABC failures or only Abnormal History failures separately if desired. (Optional polish — single Retry All also fine.)
- Keep the 3-second inter-message delay.
- Keep `retry_count → 1` write before each attempt so a row is never retried twice (matches today's behavior).
- On success, set `delivery_status = 'sent'`, clear `failed_at`. On still-failed, leave `delivery_status = 'failed'` and bump `retry_count` so it disappears from the list.

### 4. Out of scope
- No schema changes (all needed columns already exist).
- No change to `MarketingSender.tsx`, `CRMContacts.tsx`, `AutomatedMarketing.tsx`, or `CRMAbnormalTests.tsx` — they keep logging via `logMessageSend()` as today.
- No backfill of `retry_payload` for the 199+ historical failed rows — they will retry using the CRM-rebuild path.
- No webhook change — `failed_at` already populated correctly.

## Expected outcome

- Open Marketing → Retry tab → see all 201 historical failed rows (199 ABC + 2 Abnormal History) + any future Marketing failures.
- The specific row `9925039222 / UMR0000857|9925039222 / ABC / failed at 19-04-2026 10:38 AM` appears at the top.
- Clicking **Retry All** rebuilds a fresh WhatsApp template send for each row using CRM data + global WA settings, marks succeeded ones as `sent`, and leaves still-failed ones with `retry_count=1` so they drop off the list.
- Marketing campaign retries (with stored `retry_payload`) continue to work via the existing `send-marketing-message` path — no regression.

