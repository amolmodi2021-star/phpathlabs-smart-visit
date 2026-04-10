

# Fix: Hide Accepted Tubes from Sample Collection "Collected" Tab

## Problem
The "Collected" tab in Sample Collection continues to show tubes even after they've been accepted in Sample Acceptance. The user wants only tubes that are **collected but not yet accepted** (i.e., pending acceptance) to appear here.

## Solution — `src/components/lims/SampleCollection.tsx`

### 1. Filter the Collected tab to exclude fully-accepted registrations

In the `renderTable` filter (line 580), add logic for the `!isPending` (Collected) case: only show registrations where at least one collected tube has NOT yet been accepted.

```typescript
if (!isPending) {
  const collected = parseCollectedSamples(reg.collected_samples || []);
  const accepted = parseCollectedSamples(reg.accepted_samples || []);
  const acceptedKeys = new Set(accepted.map(a => a.key));
  // Only show if at least one collected tube is NOT yet accepted
  return collected.some(c => !acceptedKeys.has(c.key));
}
```

### 2. Update the Collected tab badge count

Update the badge counter (line 686) to use the same filtering logic — count only registrations that have at least one collected-but-not-accepted tube.

### 3. Hide accepted tubes from the expanded tube list in Collected tab

In `renderBarcodeExpansion`, when rendering the Collected tab (`!isPending`), filter out tube groups that are already in `accepted_samples`. This ensures individual accepted tubes disappear from the dropdown/list.

**One file changed. Three small filtering additions.**

