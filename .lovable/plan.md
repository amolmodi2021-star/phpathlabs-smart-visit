

# Plan: Add Min-Interval Recheck to Post-Collection Deduplication Pass

## Problem
The current min-interval check only looks at `crm_contacts.last_sent_date`, which may not reflect drip campaign sends accurately. The `recentSentMobiles` set in the code is declared but never populated (empty loop body). A second-layer check using the actual `drip_campaign_log.created_at` timestamps is needed.

## Changes

### File: `src/components/marketing/AutomatedMarketing.tsx`

**1. Fetch `created_at` in drip log query (line 302)**
Add `created_at` to the select columns for `drip_campaign_log`:
```
.select("filter_id,mobile_number,contact_primary_key,cycle_number,created_at")
```

**2. Build `recentSentMobiles` properly (lines 332-338)**
Replace the empty loop with actual logic that populates `recentSentMobiles` from `allLogs` using `created_at`:
```
for (const log of allLogs) {
  if (log.created_at && new Date(log.created_at) >= intervalDate) {
    const mob = (log.mobile_number || "").replace(/\D/g, "").slice(-10);
    if (mob) recentSentMobiles.add(mob);
  }
}
```

**3. Add min-interval recheck in the second-pass deduplication (after line 553)**
After the existing duplicate removal loop, add a second filter that removes any mobile found in `recentSentMobiles` — this catches records that passed the first-pass `crm_contacts.last_sent_date` check but have a more recent drip log entry:

```
// Second-pass min-interval recheck using drip_campaign_log timestamps
for (const entry of filterCapped) {
  entry.kept = entry.kept.filter((record: any) => {
    const mob = (record.mobile_number || "").replace(/\D/g, "").slice(-10);
    if (!mob) return true;
    if (recentSentMobiles.has(mob)) {
      entry.fc.skips["min_interval_recheck"] = 
        (entry.fc.skips["min_interval_recheck"] || 0) + 1;
      return false;
    }
    return true;
  });
}
```

To make `recentSentMobiles` accessible in the second pass, it needs to be declared at a scope visible to both — move its construction to just after log processing (it's already there) and pass it through or keep it in the outer closure.

## Summary
- **1 file modified**: `src/components/marketing/AutomatedMarketing.tsx`
- ~20 lines changed/added across 3 locations
- No database changes needed
- Skip reason `min_interval_recheck` will appear in preview for transparency

