## Add configurable delay (in seconds) before sending WhatsApp auto-reply

### Goal
Currently the webhook auto-reply fires immediately on every inbound message, which Meta bills as a service conversation. Add a configurable delay (in seconds) so the auto-reply is deferred — giving time for the 24h rate-limit / user re-engagement logic to potentially suppress duplicate charges, and allowing the admin to tune behaviour.

### Changes

1. **Settings UI — `WhatsAppSettingsPage.tsx` (Webhook tab)**
   - Add a new numeric input: **"Auto-reply delay (seconds)"** next to the existing auto-reply controls.
   - Stored in `app_settings` under key `webhook_auto_reply_delay_seconds` (default `0` = immediate, preserves current behaviour).
   - Helper text: *"Delay before the auto-reply is sent. Useful to avoid charges when the user re-engages quickly."*

2. **Webhook edge function (`whatsapp-webhook` / inbound handler)**
   - Read `webhook_auto_reply_delay_seconds` from `app_settings`.
   - If `> 0`, wait that many seconds (`await new Promise(r => setTimeout(r, n*1000))`) before invoking the auto-reply send, while still respecting the existing 24h rate-limit check (`webhook_max_auto_replies_24h`).
   - Re-check the 24h auto-reply counter *after* the delay (in case another auto-reply was already sent in the interim), to avoid duplicates.
   - Keep delay capped (e.g. max 60s) to stay within edge-function execution limits.

### Technical notes
- `app_settings` row uses existing JSON `value` pattern — no migration needed.
- No schema changes; no new tables.
- Default `0` keeps existing immediate behaviour for users who don't configure it.

### Out of scope
- No "skip on re-engage" cancellation logic (user picked Fixed delay only).
- No changes to outbound messaging or templates.