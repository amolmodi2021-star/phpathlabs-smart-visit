

# Add Max Auto-Replies per 24 Hours Setting

## Overview
Add a configurable limit for the number of auto-replies sent to the same number within a 24-hour window. After the limit is reached, auto-replies stop for that number until 24 hours have passed since the last reply.

## Changes

### 1. Frontend — `src/pages/WhatsAppWebhook.tsx`
- Add state `maxAutoReplies` (default: `0` meaning unlimited).
- Load from `app_settings` key `webhook_max_auto_replies_24h`.
- Save it alongside other settings in `handleSave`.
- Add a number input field in the Auto-Reply Settings card: "Max auto-replies per number in 24 hours (0 = unlimited)".

### 2. Edge Function — `supabase/functions/whatsapp-webhook/index.ts`
- Add `webhook_max_auto_replies_24h` to the settings query.
- Before sending an auto-reply, if limit > 0:
  - Query `webhook_messages` for outbound messages to the same `sender_number` in the last 24 hours where `direction = 'outbound'` and message matches the auto-reply pattern.
  - Count the results. If count >= limit, skip the auto-reply.
- No new tables needed — uses existing `webhook_messages` data with a count query.

## Technical Detail
The 24-hour window is based on `created_at >= now() - interval '24 hours'` relative to the current time, filtering outbound auto-reply messages to the same sender number. This means the counter naturally resets as old messages age past the 24-hour window.

