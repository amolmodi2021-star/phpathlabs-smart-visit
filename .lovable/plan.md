

# Show Partially Collected Samples in Sample Acceptance

## Problem
The Sample Acceptance "Pending" query only fetches patients with `status = "sample_collected"`. Partially collected patients (status still `registered` but with entries in `collected_samples`) are excluded.

## Fix
In `src/components/lims/SampleAcceptance.tsx`, update the pending query (line 63) to also include partially collected patients, mirroring the approach used in the Collected tab of Sample Collection:

```typescript
// Change from:
.eq("status", "sample_collected")

// To:
.or("status.eq.sample_collected,collected_samples.neq.[]")
```

This will show both fully collected and partially collected patients in Sample Acceptance. Partially collected patients should also get a "PARTIAL" badge in the Sample Acceptance pending list for clarity.

## File
- `src/components/lims/SampleAcceptance.tsx` — update query filter + add PARTIAL badge

