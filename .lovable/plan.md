

# Fix: PARTIAL Badge Showing When All Samples Are Collected

## Problem
In the "Collected" tab, registrations where all samples have been collected still show the amber "PARTIAL" badge. The current condition (`reg.status !== "sample_collected"`) only checks the global status field, which may not yet reflect that all tubes are collected.

## Root Cause
Line 610 in `SampleCollection.tsx` shows the PARTIAL badge based solely on `reg.status !== "sample_collected"`. It doesn't check whether all tube groups have actually been collected.

## Fix — `src/components/lims/SampleCollection.tsx`

Update line 610-612 to also check if there are actually uncollected tubes remaining. The `groups` variable (from `buildBarcodeGroups`) is already available and contains an `isCollected` flag per group.

**Change from:**
```typescript
{!isPending && reg.status !== "sample_collected" && (
  <Badge className="ml-2 text-xs bg-amber-500 text-white border-0">PARTIAL</Badge>
)}
```

**Change to:**
```typescript
{!isPending && reg.status !== "sample_collected" && groups.some(g => !g.isCollected) && (
  <Badge className="ml-2 text-xs bg-amber-500 text-white border-0">PARTIAL</Badge>
)}
```

This adds a check that at least one tube group is still uncollected before showing the PARTIAL badge. If all groups are collected, the badge won't appear regardless of the status field.

## File
- `src/components/lims/SampleCollection.tsx` — one-line edit

