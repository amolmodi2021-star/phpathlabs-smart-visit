

# Partial Sample Collection

## Problem
Currently, when only some barcode groups (tubes) are selected, the system prints labels but does not track that those samples were collected. The patient stays in "pending" with no indication of which tubes are already done. The "Mark as Sample Collected" button only appears when ALL tubes are selected.

## Solution
Add a `collected_samples` JSONB column to `patient_registrations` to track which tube groups have been collected. This enables partial collection where:
- Collected tubes show as "Collected" (greyed out, non-selectable) in the expansion
- Remaining tubes stay selectable for future collection
- When all tubes are finally collected, status auto-updates to `sample_collected`

## Database Change
Add one column via migration:
```sql
ALTER TABLE patient_registrations 
ADD COLUMN collected_samples jsonb NOT NULL DEFAULT '[]'::jsonb;
```

The column stores an array of collected group keys, e.g. `["EDTA||", "FLUORIDE||-F"]`.

## UI Changes in `src/components/lims/SampleCollection.tsx`

1. **Add `groupKey` to `BarcodeGroup` interface** — store the `tube||suffix` key so we can track it.

2. **Update `buildBarcodeGroups`** — include the `groupKey` in each group and mark groups as already collected based on `reg.collected_samples`.

3. **Update `handlePrintAndCollect`** — when partial selection:
   - Print the selected barcodes
   - Save the selected group keys into `collected_samples` (merge with existing)
   - If all groups are now collected, set status to `sample_collected`
   - Show toast: "X of Y samples collected. Remaining pending."

4. **Update `renderBarcodeExpansion`** — for already-collected groups:
   - Show a green "Collected" badge, disable the checkbox, grey out the card
   - The print button changes to show remaining uncollected count
   - "Mark as Sample Collected" button appears when all remaining are selected

5. **Individual tube print button** — when clicking the small print icon on a single tube, also mark that tube as collected.

## Files
- `src/components/lims/SampleCollection.tsx` — UI logic for partial collection
- Migration — add `collected_samples` column

