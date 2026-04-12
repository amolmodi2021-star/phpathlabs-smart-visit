

# Plan: Fix Message ID Extraction in Chat Reply Section

## Problem
Messages sent from the reply compose bar have `message_id = NULL` in the database. The webhook receives status updates (sent/delivered) with the correct IDs but finds 0 matching rows in both tables. The logs confirm: `wm_exact: 0, msl_exact: 0`.

## Root Cause
The AOC API response structure is:
```json
{"id":"fd52bb2e-...","data":[{"recipient":"919552000200","messageId":"fd52bb2e-...:1"}],"message":"Message Sent Successfully!"}
```

The current extraction code checks `parsed.messageId` and `parsed.message_id` but misses:
- `parsed.id` (the base UUID without suffix — this is what we want to store)
- `parsed.data[0].messageId` (contains the suffixed version)

The `extractMessageId` helper in `src/lib/messageLog.ts` already handles all these paths correctly, but the chat reply code duplicates the logic instead of using the helper.

## Fix

### File: `src/pages/WhatsAppChat.tsx`
- Replace the inline messageId extraction (lines 431-435) with a call to `extractMessageId(proxyRes)` from `src/lib/messageLog.ts`
- This helper already handles `body.id`, `body.messageId`, `body.data[0].messageId`, and string parsing — exactly the paths needed

### Change
```typescript
// Before (broken):
let messageId = "";
try {
  const parsed = typeof proxyRes?.body === "string" ? JSON.parse(proxyRes.body) : proxyRes?.body;
  messageId = parsed?.messageId || parsed?.message_id || parsed?.messages?.[0]?.id || "";
} catch {}

// After (using existing helper):
import { extractMessageId } from "@/lib/messageLog";
const messageId = extractMessageId(proxyRes) || "";
```

One file change, no database migration needed.

