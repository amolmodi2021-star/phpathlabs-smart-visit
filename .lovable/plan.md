

# Add "Once Per Mobile" Flag for Promotional Filters

## Problem

Promotional messages are generic — the same message for all patients. If a mobile number has 5 patients registered, the promo goes out 5 times to the same number, which is wasteful and annoying.

## Solution

Add a toggle field **"Send once per mobile"** to each filter. When enabled, the system deduplicates by mobile number within that filter — only one message per unique mobile, regardless of how many patient records share it.

- Default: **ON** for promotion filters, **OFF** for ABC/Abnormal filters
- When creating a new filter, auto-set based on message type
- User can override manually

## Database Change

Add column to `drip_campaign_filters`:
- `once_per_mobile` (boolean, default false)

## Code Changes

### `AutomatedMarketing.tsx`

1. **Interface**: Add `once_per_mobile: boolean` to `DripFilter`
2. **Filter form**: Add a Switch toggle "Send once per mobile" — auto-set to true when message_type is `promotion`
3. **Collection logic** (`collectEligibleRecords`): When `once_per_mobile` is true for a filter, after gathering candidates, deduplicate by mobile number (keep first occurrence only) before claiming. Skip duplicates with reason `once_per_mobile_dedup`.
4. **CRUD operations**: Include `once_per_mobile` in insert/update queries

## Files to Modify

| File | Action |
|------|--------|
| Migration SQL | Add `once_per_mobile` column |
| `src/components/marketing/AutomatedMarketing.tsx` | Add toggle + dedup logic |

