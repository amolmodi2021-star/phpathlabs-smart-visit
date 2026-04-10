

# Fix: Orphaned Record in Pending Acceptance

## Problem
Registration `2604100001` (HARSHADA) has `status = sample_accepted` with all 3 tubes accepted — it's fully processed. But it still appears in the "Pending Acceptance" tab because the query on line 81 uses `collected_samples.neq.[]`, which matches **any** registration with collected samples, including those already accepted.

## Database Evidence
- Only 1 registration has collected samples: `2604100001` with status `sample_accepted`, 3/3 tubes accepted
- There are zero registrations with status `registered` or `sample_collected`

## Fix — `src/components/lims/SampleAcceptance.tsx`

Add a status filter to the pending acceptance query to exclude registrations that have already moved past the acceptance stage.

**Line 81 — change from:**
```typescript
.or("status.eq.sample_collected,collected_samples.neq.[]")
```

**To:**
```typescript
.in("status", ["registered", "sample_collected"])
.or("status.eq.sample_collected,collected_samples.neq.[]")
```

This ensures only registrations still in the collection/acceptance phase appear in the pending tab. Once a registration reaches `sample_accepted` or beyond, it won't show here.

## File
- `src/components/lims/SampleAcceptance.tsx` — one-line addition

