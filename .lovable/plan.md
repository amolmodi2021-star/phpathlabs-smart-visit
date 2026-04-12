

# Plan: Backfill message_content for existing Estimate & Home Visit messages

## Problem
Existing `message_send_log` entries for "Estimate" and "Home Visit" message types have `message_content = null` because the column was added after those messages were sent.

## Approach
Create a one-time backfill edge function that:
1. Queries `message_send_log` rows where `message_type IN ('Estimate', 'Home Visit')` and `message_content IS NULL`
2. For each row, matches to the corresponding estimate using `mobile_number` and `sent_at` timestamp (closest estimate by `created_at`/`updated_at`)
3. Fetches estimate tests and message templates
4. Rebuilds the message using the same `buildEstimateMessage` / `buildVisitMessage` logic
5. Updates the `message_content` column

## Edge Function: `backfill-message-content`
- Fetch all null-content Estimate/Home Visit log entries
- Fetch all estimates with their estimate_tests (joined)
- Fetch message_templates for header/footer/fasting text
- For each log entry, find the best-matching estimate by mobile number + closest timestamp
- For "Home Visit" types, also fetch the home_visit record for address/date/time
- Rebuild the message string and update the log row
- Return a summary of how many rows were updated

## Files
- **Create**: `supabase/functions/backfill-message-content/index.ts`

## Execution
After deploying, invoke once via the edge function URL. No UI changes needed — this is a one-time data fix.

