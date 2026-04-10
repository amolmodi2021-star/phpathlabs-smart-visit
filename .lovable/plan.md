

# Fix: Pending Acceptance Counter Mismatch

## Problem
The "Pending Acceptance" tab badge shows `pendingRegs.length` (the raw query result count), but the table body applies two additional filters before rendering rows:
1. Checks that the registration has at least one active (non-cancelled) test
2. Checks that at least one tube group is NOT yet accepted

When a registration fails either filter, it's hidden from the display but still counted in the badge — causing the "1" counter with no visible rows.

## Fix — `src/components/lims/SampleAcceptance.tsx`

### Compute filtered counts for both tabs
Add two `useMemo` values that apply the same filtering logic used in `renderTable` (lines 421-436):

```typescript
const filteredPendingCount = useMemo(() => {
  return pendingRegs.filter(reg => {
    const cancelledIds = new Set(((reg.cancelled_tests || []) as any[]).map((t: any) => t.test_id));
    const hasActiveTests = ((reg.tests || []) as any[]).some((t: any) => !cancelledIds.has(t.test_id));
    if (!hasActiveTests) return false;
    const groups = buildTubeGroups(reg);
    const accepted = parseAcceptedSamples(reg.accepted_samples);
    const acceptedKeys = new Set(accepted.map(a => a.key));
    return groups.some(g => !acceptedKeys.has(g.key));
  }).length;
}, [pendingRegs, buildTubeGroups]);
```

Similarly for `filteredAcceptedCount`.

### Update badge counters (lines 642-643, 648-649)
Replace `pendingRegs.length` with `filteredPendingCount` and `acceptedRegs.length` with `filteredAcceptedCount`.

## File
- `src/components/lims/SampleAcceptance.tsx`

