

# Fix: Print Error and Sample Not Marked as Collected

## Root Cause
In `handlePrintAndCollect`, `doPrintBarcodes()` opens a popup window and schedules `printWindow.print()` via `onload`. Immediately after, the Supabase mutation fires, which invalidates queries and triggers a React re-render. This destroys the print window's callback context before `onload` fires, causing:
1. "Failed to execute 'print' on 'Window'" error
2. The mutation failing silently (sample not marked collected)

## Fix
Refactor `doPrintBarcodes` to return a `Promise` that resolves after the print dialog completes. Then make `handlePrintAndCollect` `async` and `await` the print before running the mutation.

### Changes in `src/components/lims/SampleCollection.tsx`

1. **`doPrintBarcodes`** — wrap in a Promise:
   - Resolve after `printWindow.print()` completes (in the `onload` callback, after `print()`)
   - Add `printWindow.onafterprint` as an alternative resolution point
   - Use a `setTimeout` fallback (2s) in case `onafterprint` isn't supported

2. **`handlePrintAndCollect`** — make `async`, `await doPrintBarcodes(...)` before running the mutation

3. **Individual tube print button** (line ~468) — same pattern: await print before running partial collect mutation

## File
- `src/components/lims/SampleCollection.tsx`

