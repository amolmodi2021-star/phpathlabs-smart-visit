

## Plan: Direct-to-Printer PDF (No New Tab, No Browser Print Dialog)

### Goal
When user clicks Print Barcodes → barcodes print directly. No new tab. No PDF viewer. No browser print dialog choice.

### Approach — Generate PDF via `jsPDF` + `bwip-js`, send straight to print via hidden iframe

Browsers **cannot** silently print to a specific printer (security restriction — no web API allows this). The closest we can get to "direct print" without a new tab is:

1. Generate the PDF in memory (jsPDF + bwip-js for crisp vector-quality barcodes)
2. Embed it in a **hidden iframe** inside the current page (no new tab/window)
3. Call `iframe.contentWindow.print()` → browser's print dialog appears **once**, pre-targeted at the PDF
4. User clicks Print (or hits Enter — most thermal printer setups have the printer pre-selected as default)
5. Iframe is destroyed after printing

This is the standard pattern used by POS/receipt/label-printing web apps (Shopify POS, Square, Zebra Browser Print fallback, etc.) because **no browser allows fully silent printing from a webpage**.

### Why no new tab
- PDF is rendered into a `Blob` → `URL.createObjectURL()` → assigned to a hidden `<iframe>` appended to `document.body`
- `iframe.style.display = "none"` keeps it invisible
- `iframe.onload` triggers `iframe.contentWindow.print()` automatically
- After print, the iframe and blob URL are cleaned up

### Why bwip-js + jsPDF for crisp barcodes
- **bwip-js** renders CODE128 at scale 4 (≈300 DPI equivalent) to a canvas
- **jsPDF** embeds that canvas as a PNG at exact 44mm × 8mm dimensions inside a 50×25mm page
- PDF viewer (Chrome's built-in) sends to printer at exact mm sizing → no scaling distortion
- Bars print razor-sharp on thermal (203 DPI) and laser (600 DPI) printers

### About "fully silent printing"
True silent print (no dialog at all) requires either:
- A native helper app (e.g., Zebra Browser Print, PrintNode agent)
- Chrome kiosk mode flag (`--kiosk-printing`) set on the user's machine

If you want **zero dialog**, the user must enable Chrome's `--kiosk-printing` flag once on their printing PC (one-time setup). With that flag, our `iframe.print()` call prints instantly to the default printer with no dialog. I'll mention this in code comments so it's documented.

### Changes
**1. Add `bwip-js` to package.json** (jsPDF already installed)

**2. Rewrite `src/lib/barcodePrint.ts`:**
- Remove all `window.open()`, HTML string building, `onafterprint` logic
- Build jsPDF doc with N pages (one per tube) at 50×25mm
- Per page: render bwip-js barcode to canvas → embed as image → add text fields (invoice, name, age/sex, location, sample type, datetime, sample UID)
- Convert PDF to blob → hidden iframe → auto-print → cleanup
- Same `printBarcodes(reg, tubes)` signature, same callers (Sample Collection, Sample Acceptance) work unchanged

**3. No DB / frontend / other file changes**

### File
- `src/lib/barcodePrint.ts` — full rewrite
- `package.json` — add `bwip-js`

