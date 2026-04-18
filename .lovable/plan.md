
## Root cause (two issues, one observable)

### Issue 1 — "Print failed" toast (the visible error)
Console shows:
```
SecurityError: Failed to read a named property 'print' from 'Window':
Blocked a frame with origin "...lovable.app" from accessing a cross-origin frame.
```

In `src/lib/barcodePrint.ts`, the PDF blob is loaded into a hidden iframe via `iframe.src = blobUrl`. The browser treats the blob URL frame as **cross-origin** in some sandboxed/preview contexts → `iframe.contentWindow.print()` throws `SecurityError` → toast "Print failed. Please try again." appears even when the print sometimes works.

### Issue 2 — Sample takes long to mark as "collected"
This is **not** caused by a long backend query. It's a UI sequencing problem in `SampleCollection.tsx → handlePrintAndCollect`:

```ts
await doPrintBarcodes(reg, selected);   // ← awaits the iframe Promise
collectMutation.mutate(...);            // ← only fires after print Promise resolves
```

The `printBarcodes` Promise only `resolve()`s inside the iframe's `cleanup()` — and the cleanup is scheduled with `setTimeout(cleanup, 60_000)` (60 seconds!) after the print dispatch. So `await doPrintBarcodes` blocks the collect mutation for up to **60 seconds** in the happy path, and even longer / never if the print errors out.

So: print starts → user dismisses dialog → tube *eventually* gets marked as collected ~60s later. Exactly matches the user's report.

There is no slow DB query — `recalculateRegistrationStatus` runs 3 small parallel queries on indexed columns. Sub-second.

## Fix

### `src/lib/barcodePrint.ts`
1. **Replace iframe-blob approach with a same-origin printing trick** that avoids the cross-origin SecurityError:
   - Use `window.open(blobUrl)` → call `print()` from a `load` handler on the *opened window* (same origin as opener — no SecurityError).
   - Fallback: if popup blocked, fall back to current iframe approach.
   - Even better for thermal label printing: keep the iframe, but switch from `iframe.src = blobUrl` to writing the blob into a same-origin `<embed>`/`srcdoc` wrapper, OR simply trigger a download + use system print.
   - Cleanest fix: use `iframe.srcdoc` containing an `<embed src="${blobUrl}">` — the iframe document is then same-origin and `iframe.contentWindow.print()` works in all browsers.

2. **Fire-and-forget the print, don't await 60s.** Make `printBarcodes` return as soon as `iframe.contentWindow.print()` is invoked (or a short ~500ms safety delay), so the caller can immediately update DB state. Cleanup of iframe/blob URL still happens on its own 60s timer in the background.

### `src/components/lims/SampleCollection.tsx`
3. **Decouple collection from print completion.** In `handlePrintAndCollect` and `handleSinglePrintAndCollect`:
   - Kick off the collect mutation **immediately** (before/parallel to `doPrintBarcodes`), so the tube flips to "collected" within ~200ms regardless of printer dialog state.
   - Don't await print before mutating DB — they're independent operations.

### Out of scope
- No change to barcode layout / sticker dimensions / DPI.
- No change to `recalculateRegistrationStatus` (it's already fast).
- No backend / edge function changes — there is no slow query.

## Files
- `src/lib/barcodePrint.ts` — switch to `srcdoc` embed wrapper + return early after print invocation (~30 lines).
- `src/components/lims/SampleCollection.tsx` — fire collect mutation in parallel with print (~6 lines in 2 handlers).

## Expected outcome
- "Print failed" toast disappears (cross-origin print issue fixed).
- Tube flips to "Collected" within ~300ms of clicking Print & Collect, regardless of print dialog timing.
- Print dialog still appears once per click (browser security requirement).
