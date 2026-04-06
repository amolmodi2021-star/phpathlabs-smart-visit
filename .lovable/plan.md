

# Fix: Abnormal Cards Blocked Despite ABC Already Sent

## Problem

ABC loyalty cards were sent from CRM (not the drip system), but the drip system only checks its own `drip_campaign_log` to determine if ABC is "complete" for a mobile number. Since the drip log is empty, the system thinks ABC was never sent and locks abnormal cards behind the completion lock.

Additionally, the cycle counter has inflated (some mobiles at cycle 8-10) without any actual drip sends, caused by edge cases in the `allFiltersComplete` check.

## Solution

**Make the completion lock aware of ABC sends from ANY source** — not just the drip system.

### Changes to `AutomatedMarketing.tsx`

1. **Hybrid sent detection for ABC cards**: When checking if ABC is "complete" for a mobile, also check `crm_contacts.last_sent_type === "ABC"` for each patient on that mobile. If a patient's `last_sent_type` is "ABC", count it as sent even if no drip log exists.

2. **Update `getSentCount`**: For ABC-type filters, merge drip log data with CRM contact data. A patient counts as "ABC sent" if either:
   - Their `primary_key` appears in `drip_campaign_log` for the ABC filter, OR
   - Their `last_sent_type` is "ABC" in `crm_contacts`

3. **Reset inflated cycles**: Add a one-time cleanup — reset `drip_mobile_cycles` entries where cycle > 1 but no matching drip logs exist. This prevents ghost cycles from blocking the flow.

4. **Fix cycle inflation edge case**: In `allFiltersComplete`, if `getEligibleCount` is 0 for a filter (no data), treat it as complete instead of returning false (which would prevent cycle reset) or being ambiguous.

### Technical Detail

```text
Current flow (broken):
  getSentCount(ABC_filter, mob) → checks drip_campaign_log only → 0
  getEligibleCount(ABC_filter, mob) → 1 (patient has UMR)
  isLockedByHigherPriority(abnormal, mob) → 0 < 1 → LOCKED ❌

Fixed flow:
  getSentCount(ABC_filter, mob) → checks drip_log + crm_contacts.last_sent_type → 1
  getEligibleCount(ABC_filter, mob) → 1
  isLockedByHigherPriority(abnormal, mob) → 1 >= 1 → NOT LOCKED ✅
```

### Database Cleanup

Run a one-time reset of `drip_mobile_cycles` to clear inflated cycles since no actual drip sends happened (drip_campaign_log is empty).

## Files to Modify

| File | Action |
|------|--------|
| `src/components/marketing/AutomatedMarketing.tsx` | Update `getSentCount` to merge CRM send data; fix cycle inflation edge case |
| Migration SQL | Reset `drip_mobile_cycles` where no drip logs exist |

