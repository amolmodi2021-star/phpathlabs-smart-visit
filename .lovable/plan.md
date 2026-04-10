

# Show Collection Date/Time for Every Collected Tube

## Problem
Tubes collected before the recent timestamp feature was added have no `collected_at` stored, so the collection time doesn't display for those tubes. The timestamp display code exists (line 501-503) but only renders when `collectedAt` is non-empty.

## Fix
In `src/components/lims/SampleCollection.tsx`:

1. **Fallback timestamp for old data**: When building barcode groups (line 192-204), if a tube is marked collected but has no `collected_at`, fall back to `reg.updated_at` as an approximate collection time.

2. **Always show timestamp for collected tubes**: Remove the `&& group.collectedAt` condition at line 501 — since every collected tube will now have a timestamp (either real or fallback), the date/time will always display.

3. **Pass `reg.updated_at` into `buildBarcodeGroups`**: Update the function signature to accept the registration's `updated_at` so it can use it as a fallback.

## File
- `src/components/lims/SampleCollection.tsx`

