

# Plan: Add Double-Layer Deduplication Filter for Claimed Mobiles

## Problem
A mobile number could theoretically slip through the current single-pass claiming mechanism due to edge cases in cycle resets or priority reassignment, leading to duplicate sends across filters.

## Solution
Add a **post-collection deduplication pass** after all filters have collected their eligible records, ensuring no mobile number appears in more than one filter's final list. If a duplicate is found, keep it only in the filter matching its correct priority/cycle category.

## Implementation

### File: `src/components/marketing/AutomatedMarketing.tsx`

**After the quota enforcement section (around line 538) and before building the final results (line 541):**

1. **Second-pass deduplication**: Iterate through all `filterCapped` entries in priority order. Build a `finalClaimedMobiles` set. For each record in each filter's `kept` list, extract the mobile number. If it already exists in `finalClaimedMobiles`, remove it from the current (lower-priority) filter. Otherwise, add it to the set.

2. **Logging**: Track how many records were removed in this second pass and include that count in the skip reasons as `"second_pass_duplicate"`.

### Pseudocode
```text
// After quota redistribution, before building results:
const finalClaimed = new Set<string>();
for (const entry of filterCapped) {
  entry.kept = entry.kept.filter(record => {
    const mob = (record.mobile_number || "").replace(/\D/g, "").slice(-10);
    if (finalClaimed.has(mob)) {
      // Count as second-pass duplicate in skips
      entry.fc.skips["second_pass_duplicate"] = 
        (entry.fc.skips["second_pass_duplicate"] || 0) + 1;
      return false;
    }
    finalClaimed.add(mob);
    return true;
  });
}
```

This adds a safety net without changing the existing first-pass logic. Priority order is preserved since `filterCapped` is already sorted by priority — the highest-priority filter keeps the mobile, lower-priority filters lose it.

### Changes Summary
- **1 file modified**: `src/components/marketing/AutomatedMarketing.tsx`
- ~15 lines added between quota enforcement and result building
- No database changes needed

