

# Plan: Fix Outbound Chat Messages Appearing Under Wrong Contact

## Problem
When you send a message from the reply section to 9552000200, the outbound message is stored in `webhook_messages` with `sender_number = +919574556699` (your business "from" number). The chat groups conversations by `sender_number`, so the message appears under 9574556699 instead of 9552000200.

## Root Cause
Line 438 in `WhatsAppChat.tsx`:
```typescript
sender_number: fromNumber,  // ← stores YOUR number, not the recipient
```

For inbound messages, `sender_number` correctly holds the customer's number. But for outbound messages sent from the compose bar, it should also store the **customer's** number (the recipient) so the conversation groups correctly.

## Fix

### File: `src/pages/WhatsAppChat.tsx`
Change the `webhook_messages` insert to use the recipient's number instead of the "from" number:

```typescript
// Before:
sender_number: fromNumber,

// After:
sender_number: `+91${selectedMobile}`,
```

This makes outbound messages group under the same contact as inbound messages from that customer.

### Database cleanup
Run a one-time update to fix the two existing broken records:
```sql
UPDATE webhook_messages
SET sender_number = '+919552000200'
WHERE sender_number = '+919574556699'
  AND direction = 'outbound'
  AND message_id IS NULL;
```

## Files to Modify
- `src/pages/WhatsAppChat.tsx` — one line change (sender_number in the insert)
- Database migration — fix the two existing misattributed records

