

# Plan: Prioritize First-Cycle Mobiles Over Repeat-Cycle Mobiles

## Problem
When a mobile has no abnormal history, the abnormal filter is skipped and the cycle completes immediately after ABC cards. The cycle resets to 1, and ABC cards are resent. These fast-cycling mobiles consume the daily quota (`maxPerDay`), starving mobiles that haven't even received their first ABC card.

## Solution
Add **cycle-aware sorting** so that mobiles in lower cycles (especially cycle 1 = never sent) are always prioritized over mobiles in higher cycles (repeat sends). This ensures every mobile gets their first round of cards before any mobile gets a second round.

## Changes — Single file: `src/components/marketing/AutomatedMarketing.tsx`

### 1. Sort candidates by cycle number (ascending) before processing

In the collection loop (~line 628-633), after the existing "never-sent patients first" sort, add a secondary sort by `mobileCycles[mob]` ascending. This ensures cycle-1 mobiles are picked before cycle-2+ mobiles.

```typescript
// Sort: lowest cycle first, then never-sent patients first within same cycle
candidates.sort((a, b) => {
  const aMob = (a.mobile_number || "").replace(/\D/g, "").slice(-10);
  const bMob = (b.mobile_number || "").replace(/\D/g, "").slice(-10);
  const aCycle = mobileCycles[aMob] || 1;
  const bCycle = mobileCycles[bMob] || 1;
  if (aCycle !== bCycle) return aCycle - bCycle;
  const aHas = a.last_sent_type ? 1 : 0;
  const bHas = b.last_sent_type ? 1 : 0;
  return aHas - bHas;
});
```

### 2. Apply same cycle-priority in backfill loop

The backfill loop (~line 745+) also pulls unclaimed records. Sort the eligible pool by cycle before backfilling so the same priority applies there too.

### 3. Update pending counters export

Add a "Cycle"-aware note: the counters already show cycle number. No structural change needed, but the ordering change means cycle-1 records appear first in exports.

## Result
- Every mobile gets ABC card (and abnormal if applicable) at least once before any mobile enters cycle 2
- Fast-cycling mobiles (no abnormal history) still eventually get resent, but only after all other mobiles have been served
- Daily quota is used efficiently for maximum coverage

