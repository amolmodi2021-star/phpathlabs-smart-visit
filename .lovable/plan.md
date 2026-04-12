

# Plan: Fix Message ID Capture for Delivery Status Updates

## Problem
The `message_id` column in `message_send_log` is NULL for every single row. The extraction code runs inside a try/catch that silently returns null on any error. Without a stored `message_id`, the webhook cannot match incoming status events (delivered/read) to log entries, so ticks never update.

## Root Cause
The messageId extraction logic is likely failing silently. Two possible issues:
1. The `supabase.functions.invoke` SDK may structure `proxyRes.data` differently than expected (e.g., nested parsing)
2. The AOC API may return the messageId under a variant key or nested structure

## Solution

### 1. Add debug logging to the proxy to capture the actual API response
Temporarily add `console.log` in `whatsapp-proxy/index.ts` to log the raw response body from the AOC API, so we can see the exact structure and key name.

### 2. Fix the messageId extraction in `src/lib/messageLog.ts`
Update `extractMessageId` to handle more response shapes and add a fallback. Also make it more robust by checking additional possible key paths (`messages[0].id`, `message_id`, etc.).

### 3. Update all callers to await and log the messageId properly
The current pattern extracts messageId inline with an IIFE. Refactor to use the shared `extractMessageId` helper consistently, and add a `console.log` so we can debug extraction in the browser console.

### 4. Update the webhook to match with `:N` suffix variants
The AOC API appends `:1` (or `:N`) to messageIds in status callbacks. When looking up in `message_send_log`, also try matching without the suffix:
```typescript
// In whatsapp-webhook, when updating message_send_log:
const baseId = messageId.includes(":") ? messageId.split(":")[0] : messageId;
await supabase.from("message_send_log")
  .update({ delivery_status: status })
  .or(`message_id.eq.${messageId},message_id.eq.${baseId}`);
```

## Files to Modify
- `supabase/functions/whatsapp-proxy/index.ts` — add response logging
- `supabase/functions/whatsapp-webhook/index.ts` — fuzzy messageId matching (with/without `:N` suffix)
- `src/lib/messageLog.ts` — make `extractMessageId` more robust with logging
- `src/components/crm/CRMContacts.tsx` — use `extractMessageId` helper
- `src/components/crm/CRMImportReview.tsx` — use `extractMessageId` helper
- `src/components/crm/CRMAbnormalTests.tsx` — use `extractMessageId` helper
- `src/components/marketing/AutomatedMarketing.tsx` — use `extractMessageId` helper

