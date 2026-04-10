

# Fix: Collected Tab Showing Already-Accepted Registrations

## Problem
Registration `2604100001` has `status = sample_accepted` and all samples accepted, but it still appears in the Sample Collection "Collected" tab. This is because the query uses `collected_samples.neq.[]` without filtering out registrations that have already moved past the collection stage.

## Root Cause
Line 110 in `SampleCollection.tsx`:
```typescript
.or("status.eq.sample_collected,collected_samples.neq.[]")
```
This matches any registration with non-empty `collected_samples` — including those at `sample_accepted`, `entered`, `verified`, `approved`, or `dispatched` status.

## Fix — `src/components/lims/SampleCollection.tsx`

Restrict the "Collected" tab query to only show registrations that are still in the collection phase. Registrations that have moved to `sample_accepted` or beyond should not appear.

**Change the query filter from:**
```typescript
.or("status.eq.sample_collected,collected_samples.neq.[]")
```

**To:**
```typescript
.in("status", ["registered", "sample_collected"])
.or("status.eq.sample_collected,collected_samples.neq.[]")
```

This adds a guard ensuring only registrations with `status` of `registered` (partially collected) or `sample_collected` appear in the Collected tab. Once a registration moves to `sample_accepted` or later, it won't show here anymore.

## File
- `src/components/lims/SampleCollection.tsx` — one-line addition

