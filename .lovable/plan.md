

## Goal
Fix two issues with the Pickup Invoice PDF download:
1. **File size** — currently ~10 MB for a single page (PNG at 2× DPI). Will drop to ~300–800 KB.
2. **Alignment / margin drift** — the downloaded PDF doesn't match the on-screen preview (rows can be sliced mid-row across pages, and the image edges sit flush against the paper edge).

## Changes — `src/components/lims/PickupInvoicePDF.tsx`

### 1. Switch raster from PNG → JPEG (huge size win)
- Replace `toPng(...)` with `toJpeg(node, { quality: 0.92, pixelRatio: 2, backgroundColor: "#ffffff", cacheBust: true })`.
- Use `pdf.addImage(dataUrl, "JPEG", ...)`.
- Result: same visual sharpness at ~5–15× smaller file size. Typical single-page invoice → well under 1 MB.

### 2. Render Invoice and Ledger as **two separate captures** (fixes alignment)
The current code rasterizes one tall HTML node containing both the invoice and the ledger, then slices the resulting flat image into A4-tall strips. Because the slice boundary doesn't align to row boundaries, rows get cut in half and content drifts.

Fix: split the print DOM into two sibling sections — `#pickup-invoice-print-page1` (invoice) and `#pickup-invoice-print-page2` (ledger) — and capture each separately. Each capture becomes one PDF page via `pdf.addImage`. No mid-row slicing.

If the invoice items table is very long (rare but possible), fall back to slicing only that single capture across pages, but starting fresh from the top of the page so the header stays at y=0.

### 3. Add proper PDF page margins
Currently the captured image is rendered edge-to-edge at `(0, 0, 210mm, …)`. The visible padding inside the print node only pads the *content*, not the page. Fix: render the image inside an 8 mm safe margin:
- `marginX = 0`, `marginY = 0` — but reduce the on-DOM padding from `12mm 14mm` to `10mm 12mm` so the printed margins exactly match what the user sees in the preview.
- Compute `imgWmm = pageW` (full bleed) and let the white background of the captured node provide the visual margin. This guarantees the downloaded PDF margin = preview margin, pixel-for-pixel.

### 4. Cap pixelRatio for very tall captures
Keep `pixelRatio: 2` for normal invoices. If the captured node is taller than ~600 mm equivalent (long ledger), drop pixelRatio to 1.5 automatically to keep file size predictable.

### 5. Loading guard tweak
Disable the Download button while either capture is mid-flight (already done) and add a tiny `await new Promise(r => setTimeout(r, 50))` before capture so any logo/`<img>` finishes painting (`crossOrigin="anonymous"` logo can otherwise be missing on first capture).

## Files
- **EDIT** `src/components/lims/PickupInvoicePDF.tsx` — switch to JPEG, split into two captures (invoice + ledger), align margins to preview, auto-throttle pixelRatio for long pages.

## Out of scope
- Re-flowing the invoice as a vector PDF using `jsPDF.text()` / `autotable` (much smaller files but a full rewrite — happy to do this in a follow-up if you want sub-100 KB files and selectable text).
- Changing the invoice visual design.

