

# Hide Pending Samples in Collected Tab Dropdown

## Problem
In the Collected tab, expanding a partially-collected patient shows ALL tube groups — including ones not yet collected. Only collected tubes should appear.

## Fix
In `src/components/lims/SampleCollection.tsx`, line 440: when `!isPending`, filter the groups to only show collected ones.

Change the `groups.map(...)` loop (line 440) to iterate over a filtered list:

```typescript
const displayGroups = isPending ? groups : groups.filter(g => g.isCollected);
```

Then use `displayGroups` in the `.map()` at line 440. The header text and all rendering below will use this filtered list, so uncollected tubes are simply hidden in the Collected view.

## File
- `src/components/lims/SampleCollection.tsx` — one small change around line 439-440

