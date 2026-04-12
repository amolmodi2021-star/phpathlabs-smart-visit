

# Plan: Fix Message Status Updates (Delivery Ticks)

## Root Cause
When outbound messages are sent via the `whatsapp-proxy` edge function, the WhatsApp API returns a `messageId` in its response. This `messageId` is **never captured or stored**. When status webhooks later arrive with that `messageId` (delivered/read/failed), the webhook handler tries to update `webhook_messages` by `message_id` but finds no matching row.

## Solution

### 1. Update `whatsapp-proxy` to return the `messageId`
The proxy already returns the raw API response body. The callers just need to parse it and extract the `messageId`.

### 2. Add `message_id` column to `message_send_log`
```sql
ALTER TABLE public.message_send_log ADD COLUMN message_id text;
```

### 3. Update all send callers to capture and store `messageId`
After each `whatsapp-proxy` call, parse the response body to extract `messageId`, then:
- Store it in `message_send_log.message_id` via the `logMessageSend` function
- This applies to: `CreateEstimate`, `EstimateDashboard`, `AddHomeVisitDialog`, `EditEstimateDialog`, `EditHomeVisitDialog`, `CRMContacts`, `CRMImportReview`, `CRMAbnormalTests`, `AutomatedMarketing`, `ViewReport`, `DirectAI`, `InvoicePreview`, `ReceiptViewDialog`, `PaymentDetailsDialog`

### 4. Update webhook status handler to also check `message_send_log`
Currently the webhook only updates `webhook_messages.delivery_status`. Extend it to also update `message_send_log` when a matching `message_id` is found:
```typescript
// In whatsapp-webhook, after updating webhook_messages:
await supabase
  .from("message_send_log")
  .update({ delivery_status: status })
  .eq("message_id", messageId);
```

### 5. Add `delivery_status` column to `message_send_log`
```sql
ALTER TABLE public.message_send_log ADD COLUMN delivery_status text DEFAULT 'sent';
```

### 6. Update webhook auto-reply to capture `messageId`
Parse the API response in the webhook's auto-reply section and store the returned `messageId` on the outbound `webhook_messages` row.

### 7. Update WhatsApp Chat UI
- For `message_send_log` messages: read `delivery_status` from the log table
- Ensure ticks render correctly: single grey tick (sent), double grey tick (delivered), double blue tick (read), red X (failed)

### 8. Enable realtime on `message_send_log` (if not already)
So status changes propagate live to the chat UI.

## Files to Modify
- **Migration**: add `message_id` and `delivery_status` to `message_send_log`, enable realtime
- **`src/lib/messageLog.ts`**: accept `messageId` parameter
- **`supabase/functions/whatsapp-webhook/index.ts`**: update status handler to also check `message_send_log`, capture `messageId` on auto-reply
- **`src/pages/WhatsAppChat.tsx`**: fetch and display `delivery_status` from log messages
- **All send callers** (~14 files): parse proxy response to extract `messageId` and pass to `logMessageSend`

## Technical Notes
- The AOC API response format typically returns `messageId` in the JSON body — we'll parse `proxyRes.data.body` (which is a JSON string) to extract it
- Status updates will work for both `webhook_messages` and `message_send_log` tables via dual-update in the webhook

