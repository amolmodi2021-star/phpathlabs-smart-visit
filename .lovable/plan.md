

# Fix: Only Show Collected Tubes in Pending Acceptance

## Problem
The Pending Acceptance tab shows ALL tube groups for a registration (based on ordered tests), not just the ones that have actually been collected. This allows users to accept samples that haven't been collected yet.

**Example:** Registration `2604100002` has 3 tube groups from ordered tests, but only `EDTA||` is in `collected_samples`. All 3 tubes appear in the acceptance dropdown.

## Root Cause
`buildTubeGroups()` generates groups from all active tests, regardless of collection status. The pending acceptance tab renders all these groups without cross-referencing `collected_samples`.

## Fix — `src/components/lims/SampleAcceptance.tsx`

### 1. Filter tube groups to only collected ones in the pending tab

In the table body filter (around line 431-436) and in all pending-tab rendering logic, filter `buildTubeGroups()` output to only include groups whose `key` exists in the registration's `collected_samples` array.

Create a helper or inline filter:
```typescript
const collectedKeys = new Set(
  ((reg.collected_samples || []) as any[]).map((s: any) => s.key)
);
const collectedGroups = groups.filter(g => collectedKeys.has(g.key));
```

### 2. Apply this filter in these locations:

- **Table body filter** (line 431-436): Use `collectedGroups` instead of `groups` when checking if any tube is unaccepted
- **`pendingGroups`** (line 445): Filter from `collectedGroups` instead of `groups`
- **`selectableKeys`** (line 450): Derive from filtered pending groups
- **Tube count display** (line 498): Show only collected tubes in pending tab
- **`displayGroups`** (line 455): Use `collectedGroups` for pending tab
- **"Accept All" button** (line 517): Already uses `pendingGroups`, so will be correct once upstream is fixed
- **`toggleAllForReg`** (line 227-242): Filter to only collected tube keys
- **`sampleIdToRegMap`** (line 201-214): Filter to only collected tubes for barcode scanning
- **`filteredPendingCount`** useMemo: Use collected-only groups

### 3. Show "PENDING COLLECTION" indicator for uncollected tubes (optional enhancement)

When a registration is partially collected, show how many tubes are still pending collection so the user has context.

## Files
- `src/components/lims/SampleAcceptance.tsx`

