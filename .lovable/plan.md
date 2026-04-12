

# Plan: Show actual message content in WhatsApp Chat for Estimates & Home Visits

## Problem
Currently, the `message_send_log` table only stores `message_type` (e.g., "Estimate", "Home Visit") but not the actual message body. In the WhatsApp Chat page, outbound messages from this table show generic labels like "📤 Estimate Sent" instead of the real message content.

## Solution
1. **Add a `message_content` column** to `message_send_log` to store the actual WhatsApp message text at send time.
2. **Update `logMessageSend()`** to accept an optional `messageContent` parameter and save it.
3. **Update all callers** that send Estimate, Home Visit, Invoice, Report, and other messages to pass the built message text to `logMessageSend()`.
4. **Update WhatsApp Chat page** to display the stored message content instead of the generic badge.

## Database Migration
Add a nullable `message_content` text column to `message_send_log`:
```sql
ALTER TABLE public.message_send_log ADD COLUMN message_content text;
```

## Code Changes

### `src/lib/messageLog.ts`
Add optional `messageContent` parameter to `logMessageSend()` and insert it into the new column.

### Callers to update (pass the actual message string):
- `src/pages/CreateEstimate.tsx` — passes the built estimate message
- `src/pages/EstimateDashboard.tsx` — passes estimate/visit message from preview
- `src/components/lims/InvoicePreview.tsx` — passes invoice message
- `src/pages/ViewReport.tsx` — passes report share message
- `src/pages/DirectAI.tsx` — passes report message
- `src/pages/AbnormalHistory.tsx` — passes abnormal history message
- `src/components/crm/CRMAbnormalTests.tsx` — passes abnormal card message
- `src/components/marketing/MarketingSender.tsx` — passes marketing message
- `src/components/marketing/AutomatedMarketing.tsx` — passes automated message
- `src/components/crm/CRMImportReview.tsx` — passes CRM import message

### `src/pages/WhatsAppChat.tsx`
- Fetch `message_content` from `message_send_log` query
- In the chat bubble for log messages: if `message_content` exists, render it as `whitespace-pre-wrap` text instead of the generic "📤 Estimate Sent" badge
- Keep the message_type as a small label/chip above the content for context

## Files to modify
- **Migration**: 1 new column on `message_send_log`
- `src/lib/messageLog.ts`
- `src/pages/WhatsAppChat.tsx`
- `src/pages/CreateEstimate.tsx`
- `src/pages/EstimateDashboard.tsx`
- `src/components/lims/InvoicePreview.tsx`
- `src/pages/ViewReport.tsx`
- `src/pages/DirectAI.tsx`
- `src/pages/AbnormalHistory.tsx`
- `src/components/crm/CRMAbnormalTests.tsx`
- `src/components/marketing/MarketingSender.tsx`
- `src/components/marketing/AutomatedMarketing.tsx`
- `src/components/crm/CRMImportReview.tsx`

