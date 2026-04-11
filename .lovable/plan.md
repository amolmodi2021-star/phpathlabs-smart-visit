

# Plan: Loop Backfill + Dedup Until Quotas Are Fulfilled

## Problem
The current approach runs backfill once and dedup once. But each dedup pass can remove records that were just backfilled, leaving quota unfilled again. We need to **loop** the backfill→dedup cycle until either quotas are full or no more eligible records exist.

## Changes

### File: `src/components/marketing/AutomatedMarketing.tsx`

**After line 569 (after the min-interval recheck), before "Build results" (line 571), insert a looping backfill+dedup block:**

```typescript
// Iterative backfill + dedup loop until quota is stable
let backfillIterations = 0;
const MAX_BACKFILL_ITERATIONS = 10; // safety cap

while (backfillIterations < MAX_BACKFILL_ITERATIONS) {
  backfillIterations++;
  
  // Calculate free slots
  let totalKeptNow = filterCapped.reduce((s: number, f: any) => s + f.kept.length, 0);
  let freeSlots = maxPerDay - totalKeptNow;
  if (freeSlots <= 0) break;

  // Backfill: pull from each filter's eligible pool in priority order
  let backfilled = 0;
  for (const entry of filterCapped) {
    if (freeSlots <= 0) break;
    const alreadyKeptPks = new Set(entry.kept.map((r: any) => r.primary_key));
    const pool = entry.fc.eligible.filter((r: any) => !alreadyKeptPks.has(r.primary_key));
    
    for (const record of pool) {
      if (freeSlots <= 0) break;
      const mob = (record.mobile_number || "").replace(/\D/g, "").slice(-10);
      if (!mob) continue;
      if (finalClaimed.has(mob)) continue;
      if (recentSentMobiles.has(mob)) continue;
      
      entry.kept.push(record);
      finalClaimed.add(mob);
      freeSlots--;
      backfilled++;
    }
  }

  // If nothing was backfilled, no point continuing
  if (backfilled === 0) break;

  // Re-run deduplication pass on all kept records
  const recheck = new Set<string>();
  let removedThisPass = 0;
  for (const entry of filterCapped) {
    entry.kept = entry.kept.filter((record: any) => {
      const mob = (record.mobile_number || "").replace(/\D/g, "").slice(-10);
      if (!mob) return true;
      if (recheck.has(mob)) {
        entry.fc.skips["final_dedup"] = (entry.fc.skips["final_dedup"] || 0) + 1;
        removedThisPass++;
        return false;
      }
      if (recentSentMobiles.has(mob)) {
        entry.fc.skips["final_interval_check"] = (entry.fc.skips["final_interval_check"] || 0) + 1;
        removedThisPass++;
        return false;
      }
      recheck.add(mob);
      return true;
    });
  }

  // Rebuild finalClaimed from current state
  finalClaimed.clear();
  for (const entry of filterCapped) {
    for (const record of entry.kept) {
      const mob = (record.mobile_number || "").replace(/\D/g, "").slice(-10);
      if (mob) finalClaimed.add(mob);
    }
  }

  // If dedup removed nothing, quota is stable — done
  if (removedThisPass === 0) break;
}
```

## How It Works
1. After initial dedup + interval checks, enter a loop
2. **Backfill**: pull unclaimed, interval-safe records from each filter's eligible pool
3. **Dedup**: re-run dedup + interval check on all kept records
4. **Rebuild** `finalClaimed` from current state so next iteration is accurate
5. **Exit** when: quota full, nothing backfilled, nothing removed, or 10 iterations reached

## Summary
- **1 file modified**: `src/components/marketing/AutomatedMarketing.tsx`
- ~50 lines added after line 569
- No database changes
- Guarantees both filters reach their quota cap if enough eligible records exist

