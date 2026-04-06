

# Add Test Mode: Trial Send to Your Mobile Number

## What This Does

Adds a **"Test Mobile Number"** input field in the Automated Marketing section. When a mobile number is entered, all messages during that send session go to YOUR number instead of the actual patients. This lets you verify the message format, template, and card image before doing a real send.

- The patient's **name, UMR, card image** etc. remain unchanged — only the **destination number** is swapped.
- When test mode is active, the send button changes to **"Send Trial"** with a distinct color.
- **No logs are written** to `drip_campaign_log` or `crm_contacts` during trial mode, so it doesn't affect your priority/cycle system.
- A clear warning banner appears confirming trial mode is active.

## Changes to `AutomatedMarketing.tsx`

1. **Add state**: `testMobile` (string) — the override mobile number for trial sends.

2. **Add UI field** near the Send button area:
   - Input field labeled "Test Mobile (Trial Mode)" with placeholder "Enter your 10-digit mobile"
   - When filled, show a yellow warning: "⚠️ TRIAL MODE — All messages will be sent to {testMobile}"
   - Send button text changes to "Send Trial" with amber styling

3. **Modify `handleSend`**:
   - If `testMobile` is set (10 digits), replace `to: +91${mob}` with `to: +91${testMobile}` in all payload constructions (ABC cards, Abnormal cards, Promo messages)
   - Skip all database updates: no `logDripAction`, no `crm_contacts` update, no `drip_mobile_cycles` changes
   - Still show progress and success/failure counts for visibility
   - Limit trial sends to **max 3 messages** to avoid wasting quota — show confirmation if more records exist

4. **No changes to preview logic** — preview works exactly the same regardless of test mode.

