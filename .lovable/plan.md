

## Root cause
`src/lib/barcodePrint.ts` builds an iframe whose `srcdoc` contains an `<embed type="application/pdf" src="blob:...">` and then calls `iframe.contentWindow.print()`. In current Chrome the wrapper HTML document is what gets printed (which is empty) — the embedded PDF plugin runs in a separate context that doesn't proxy `print()` from the parent. Result: no print dialog appears, but the rest of the flow (toast "Samples marked as collected", iframe cleanup after 60s) runs normally — which is exactly what the session replay shows.

## Fix — single file: `src/lib/barcodePrint.ts`

Replace the srcdoc-with-embed approach with the standard, reliable pattern:

1. Set `iframe.src = blobUrl` directly. Chrome's built-in PDF viewer loads as the iframe's document and exposes `print()` to `contentWindow`.
2. Call `iframe.contentWindow.focus()` then `iframe.contentWindow.print()` after the PDF is fully ready.
3. Detect "ready" robustly:
   - Listen for `iframe.onload` (fires when the PDF viewer finishes loading).
   - Add a small post-load delay (~600ms) so Chrome's PDF viewer finishes initializing its print pipeline.
   - Keep the 2s safety-net fallback.
4. If `print()` still throws (rare, sandboxed previews), fall back to `window.open(blobUrl)` so the user can print from the new tab — and surface a toast explaining what happened.
5. Keep all existing behavior:
   - Multi-page PDF, layout, bwip-js barcode rendering — untouched.
   - Resolves the promise immediately after triggering print so Sample Collection isn't blocked.
   - Cleanup of blob URL + iframe after 60s.

## Why this works
- Same-origin blob URL → no SecurityError.
- Iframe document IS the PDF viewer → `print()` prints the PDF, not a blank wrapper.
- This is the standard jsPDF/printJS pattern used in production apps.

## Out of scope
- No change to barcode layout, sticker size, content, or the Sample Collection UI.
- No change to the "Print & Collect" mutation, status updates, or toasts.
- All other callers of `printBarcodes` (reprint dialog, "Print All" in collected tab, single tube print) automatically benefit.

## Expected outcome
- Clicking Print & Collect (or any reprint button) immediately opens the browser print dialog with the barcode stickers preview.
- "Samples marked as collected" toast continues to appear in parallel — collection is not blocked by print.

