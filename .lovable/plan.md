# Drop all WhatsApp / message logging — keep Marketing UI + login history

You want **zero logging for WhatsApp / messaging**. Marketing section stays usable. Login history stays. Prescriptions get auto-deleted right after scanning (no storage at all).

## What gets deleted

### 1. Database tables — DROPPED entirely
- `message_send_log` — the big one
- `drip_campaign_log`
- `drip_mobile_cycles`
- `loyalty_cards` (per-card send-status log)
- `loyalty_card_jobs` (bulk send job tracker)

### 2. Database tables — KEPT
- `app_user_login_history` ✅ keep
- `webhook_messages` ✅ keep (powers WhatsApp Chat — but TRUNCATE once now to clear history)
- `marketing_templates` ✅ keep (template definitions, not logs)
- `marketing_campaigns` ✅ keep (campaign config, used by MarketingSender to drive the bulk send)
- `crm_blacklist`, `drip_campaign_filters` ✅ keep (config, no log churn)
- `lims_interface_logs` ✅ keep (this is instrument I/O, not message log — separate concern)

### 3. RPCs — DROPPED
- `get_new_numbers_paginated` (only reads `message_send_log`)

### 4. Webhook (`whatsapp-webhook` edge function)
- Strip the `message_send_log` UPDATE block (lines 70–82). Webhook will only update `webhook_messages.delivery_status` for actual chat messages.

### 5. Frontend code
- **DELETE** `src/lib/messageLog.ts`
- **DELETE** `src/lib/dripCardSenders.ts` (already a stub, no live callers)
- **DELETE** `src/components/marketing/MessageLog.tsx`
- **DELETE** `src/components/marketing/MarketingHistory.tsx`
- **DELETE** `src/components/marketing/MarketingRetry.tsx`
- **DELETE** `src/components/marketing/AutomatedMarketing.tsx` (drip)
- **DELETE** `src/components/marketing/NewNumbers.tsx` (reads dropped RPC)
- **DELETE** `src/components/LoyaltyCardHistory.tsx` (reads `loyalty_cards`)
- **KEEP** `src/components/marketing/MarketingSender.tsx` — but strip the `logMessageSend` import + calls
- **KEEP** `src/components/marketing/MarketingTemplates.tsx`
- **KEEP** `src/components/LoyaltyCardSender.tsx` — strip log writes, keep send flow
- **KEEP** `src/pages/LoyaltyCards.tsx` — remove the History tab only
- **UPDATE** `src/pages/Marketing.tsx` — keep just **Send Messages** and **Templates** tabs (remove "New Numbers")

Strip `logMessageSend` / `extractMessageId` imports + calls from these files (the calls are already no-ops, just clean it up):
- `src/pages/WhatsAppChat.tsx`
- `src/pages/EstimateDashboard.tsx`
- `src/pages/CreateEstimate.tsx`
- `src/components/EditHomeVisitDialog.tsx`
- `src/components/EditEstimateDialog.tsx`
- `src/components/AddHomeVisitDialog.tsx`
- `src/components/ReceiptViewDialog.tsx`
- `src/components/PaymentDetailsDialog.tsx`
- `src/components/lims/InvoicePreview.tsx`
- `src/components/marketing/MarketingSender.tsx`
- `src/components/crm/CRMImportReview.tsx`

### 6. Prescription auto-delete (no retention)
Currently `cleanup-prescriptions` runs a cron that deletes after 30 days. You want **immediate deletion after scanning**. Two changes:

- **Edit `src/components/PrescriptionScanDialog.tsx`** — after the AI parse completes (success or failure), `await supabase.storage.from('prescriptions').remove([uploadedPath])`. The image is only needed long enough for Gemini to read it.
- **Delete the `cleanup-prescriptions` cron + edge function** (no longer needed). Bucket stays for transient uploads.

### 7. WhatsApp Chat data wipe (one-time)
- `TRUNCATE webhook_messages` — wipes all chat history
- Empty `chat-attachments` storage bucket — deletes all received/sent media
- Empty `loyalty-cards` storage bucket — no longer tracked anywhere

### 8. CloudUsage cleanup
- Remove dropped tables from `src/lib/cloudUsage.ts` retention/forever lists
- Remove `cleanup-prescriptions` from cron job display

## Files

```text
supabase/migrations/<new>.sql
  — DROP TABLE message_send_log, drip_campaign_log, drip_mobile_cycles,
                loyalty_cards, loyalty_card_jobs
  — DROP FUNCTION get_new_numbers_paginated
  — TRUNCATE webhook_messages
  — Unschedule cleanup-prescriptions cron

supabase/functions/whatsapp-webhook/index.ts   — strip msl block (lines 70-82)
supabase/functions/cleanup-prescriptions/      — DELETE entire function

src/lib/messageLog.ts                          — DELETE
src/lib/dripCardSenders.ts                     — DELETE
src/components/marketing/MessageLog.tsx        — DELETE
src/components/marketing/MarketingHistory.tsx  — DELETE
src/components/marketing/MarketingRetry.tsx    — DELETE
src/components/marketing/AutomatedMarketing.tsx — DELETE
src/components/marketing/NewNumbers.tsx        — DELETE
src/components/LoyaltyCardHistory.tsx          — DELETE

src/pages/Marketing.tsx                        — keep Send + Templates tabs only
src/pages/LoyaltyCards.tsx                     — remove History tab
src/components/LoyaltyCardSender.tsx           — strip log writes
src/components/marketing/MarketingSender.tsx   — strip logMessageSend
src/components/PrescriptionScanDialog.tsx      — auto-delete after scan
src/lib/cloudUsage.ts                          — drop deleted tables

src/pages/WhatsAppChat.tsx                     — remove logMessageSend import
src/pages/EstimateDashboard.tsx                — remove import
src/pages/CreateEstimate.tsx                   — remove import
src/components/EditHomeVisitDialog.tsx         — remove import
src/components/EditEstimateDialog.tsx          — remove import
src/components/AddHomeVisitDialog.tsx          — remove import
src/components/ReceiptViewDialog.tsx           — remove import
src/components/PaymentDetailsDialog.tsx        — remove import
src/components/lims/InvoicePreview.tsx         — remove import
src/components/crm/CRMImportReview.tsx         — remove import

Storage purge (one-time, via inline edge function call):
  chat-attachments bucket — delete all objects
  loyalty-cards bucket    — delete all objects
  prescriptions bucket    — delete all objects (clean slate)
```

## Memory updates
- Update Core: log message_send_log/drip_*/loyalty_cards as permanently dropped (do not re-create)
- Update Core: prescriptions are deleted immediately post-scan (no storage retention)
- Remove memory file `mem://features/communication/universal-message-log` (now obsolete)

## Expected impact
| Item | Before | After |
|---|---|---|
| `message_send_log` writes | every send | gone |
| Webhook delivery updates | 2 tables × 2 queries | 1 table × 1 query |
| `loyalty_cards` rows | grows per card | gone |
| `chat-attachments` storage | growing | 0 (then only new chat media) |
| `prescriptions` storage | 30-day retention | ~0 (deleted on scan) |
| Marketing page | working | working (2 tabs) |
| Login history | working | working |

Approve and I'll do it in one pass.