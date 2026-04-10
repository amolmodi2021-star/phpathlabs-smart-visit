

# Show Partially Collected Samples in Collected Tab

## Problem
When 1 of 3 tubes is collected, the patient stays in "Pending" only (status is still `registered`). The user expects to also see the collected tubes in the "Collected" tab.

## Solution
Update the "Collected" tab query to include patients that have partial collections (`collected_samples` is a non-empty array) in addition to fully collected patients (`status = sample_collected`).

### Changes in `src/components/lims/SampleCollection.tsx`

1. **Update `collectedRegistrations` query** (line ~84-98):
   - Change from only `status = "sample_collected"` to also include patients where `collected_samples` has entries (i.e., `collected_samples` array length > 0)
   - Use `.or('status.eq.sample_collected,collected_samples.neq.[]')` to fetch both fully and partially collected patients

2. **Update Collected tab rendering**:
   - For partially collected patients (status still `registered`), show a "Partial" badge alongside the collected tubes
   - Already-collected tubes show as they do now; uncollected tubes are hidden in this view
   - The existing barcode expansion in the Collected tab already handles showing collected state

3. **Keep patient in Pending tab too** — no change needed there, partially collected patients should appear in both tabs (Pending for remaining tubes, Collected for already-done tubes)

## Files
- `src/components/lims/SampleCollection.tsx`

