

# Mobile Number Completion Lock + Cycle Reset

## How It Works (Simple Terms)

Mobile 9552000200 has 5 patients. Priority 1 filter is ABC Cards, Priority 2 is Abnormal Cards, Priority 3 is Promotions.

- **Days 1–5**: Only ABC filter can claim this mobile. One card per day (respecting min gap). After all 5 ABC cards sent → mobile unlocked for Priority 2.
- **Days 6–10**: Only Abnormal filter can claim this mobile. After all abnormal cards sent → mobile unlocked for Priority 3.
- **Day 11**: Promotion filter claims mobile (once per mobile = 1 message only).
- **After all done**: Cycle resets. ABC cards start again from Day 12.

## Database Changes

### New table: `drip_mobile_cycles`
Tracks where each mobile is in its send cycle.

| Column | Type | Purpose |
|--------|------|---------|
| mobile_number | text (PK) | 10-digit mobile |
| current_cycle | integer | Which round (starts 1) |
| updated_at | timestamptz | Last update |

### Add column to `drip_campaign_log`
- `cycle_number` (integer, default 1) — distinguishes sends across cycles

## Code Changes — `AutomatedMarketing.tsx`

### Updated `collectEligibleRecords()` logic:

1. **Group contacts by mobile number** — know how many patients each mobile has
2. **Fetch drip_mobile_cycles** — know current cycle per mobile
3. **For each enabled filter (sorted by priority)**, when evaluating a mobile:
   - Check all **higher-priority** filters: count total eligible records vs. sent records (in current cycle) for this mobile
   - If any higher-priority filter has unsent records → skip with `completion_lock`
   - If THIS filter still has unsent records for this mobile → allow claim
   - If THIS filter is fully done for this mobile → skip (already complete)
4. **Cycle reset**: When checking and ALL filters are complete for a mobile → increment `current_cycle` in `drip_mobile_cycles`, allowing ABC to start again
5. **once_per_mobile** filters: count 1 record as "total eligible" regardless of patient count

### After sending:
- Log with `cycle_number` from `drip_mobile_cycles`
- System naturally progresses through priorities as records complete

## Files to Create/Modify

| File | Action |
|------|--------|
| Migration SQL | Create `drip_mobile_cycles` table, add `cycle_number` to `drip_campaign_log` |
| `src/components/marketing/AutomatedMarketing.tsx` | Add completion lock + cycle logic in `collectEligibleRecords()` and send handlers |

