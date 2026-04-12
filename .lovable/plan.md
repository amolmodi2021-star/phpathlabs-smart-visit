

# Plan: Ensure Safe Message ID Matching (Remove Fuzzy Match Risk)

## Current Situation
The "fuzzy match" is just stripping the `:1` suffix that the AOC API appends to message IDs in status callbacks. For example:
- We store: `a88477a1-35cb-4aa1-a2ee-2bf621185944`
- Status webhook arrives with: `a88477a1-35cb-4aa1-a2ee-2bf621185944:1`

Since these are UUIDs, two different messages will never share the same base ID, so it's safe. I verified there are zero duplicate message IDs in the database.

**Good news**: The latest messages ARE working correctly. The ABC message to 9552000200 at 05:22 shows `delivered` status, and the auto-reply at 05:39 also shows `delivered`. The fix from the previous round is working.

## What I Will Do

### 1. Make matching safer and more precise
Instead of blindly stripping `:N` and doing a second broad update, I will change the webhook to use a **single query** with an `OR` filter, and add a safeguard: only strip the suffix if the format matches `UUID:digit` exactly.

### 2. Prevent accidental cross-updates
Add a check that ensures only ONE row gets updated per status event. If the exact ID matches, skip the base-ID fallback entirely.

## Files to Modify
- `supabase/functions/whatsapp-webhook/index.ts` — tighten the matching logic with regex validation and single-row safeguards

## Technical Detail
```typescript
// Only strip suffix if it matches the AOC pattern: UUID:digit(s)
const aocSuffixPattern = /^[0-9a-f-]{36}:\d+$/;
const baseId = aocSuffixPattern.test(messageId) ? messageId.split(":")[0] : null;

// Try exact match first; only fall back to baseId if exact found 0 rows
const exactResult = await supabase.from("webhook_messages")
  .update(updatePayload).eq("message_id", messageId);
if (baseId && (exactResult.count === 0 || !exactResult.data?.length)) {
  await supabase.from("webhook_messages")
    .update(updatePayload).eq("message_id", baseId);
}
```

This ensures no accidental matches — only the exact AOC UUID pattern triggers fallback.

