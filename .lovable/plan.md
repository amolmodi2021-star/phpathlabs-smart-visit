

## Fix: Skipped Sticker + Small Barcode

### Three fixes in `src/lib/barcodePrint.ts`

**1. Remove the duplicate page-break (fixes blank sticker between labels)**
- Currently the `.label` has BOTH `page-break-after: always` AND `break-after: page`. With `@page size: 50mm 25mm`, this double-directive causes Chrome to emit an extra empty page on some printers.
- Keep only the modern `break-after: page` and `break-inside: avoid`. Remove the legacy `page-break-after` and `page-break-inside` lines.

**2. Make barcode fill the sticker width (fixes tiny barcode)**
- Currently `JsBarcode` is generated with `margin: 10` — this bakes ~5mm of white quiet zone INSIDE the PNG, then the PNG is capped at `max-width: 47mm`. Net: bars only span ~30mm (matches your photo).
- **Move the quiet zone to CSS instead of baking it into the image:**
  - Generate barcode with `margin: 0` (no internal padding)
  - Increase module `width` from `2` to `4` for sharper bars at higher source resolution
  - Increase `height` from `60` to `80` for crisp tall bars
- **Sticker CSS provides the quiet zone via padding:**
  - Change `.barcode-wrap` to `padding: 0 1mm` (1mm white space each side = sufficient quiet zone for CODE128)
  - Change `.barcode-wrap img` to `width: 100%` and `height: 8mm` — barcode now fills full ~46mm width
  - Keep `image-rendering: pixelated` for crisp thermal print

**3. Tighten label padding (gives barcode max horizontal space)**
- Change `.label` padding from `1mm 1.2mm` to `0.5mm 0.8mm` (minimal left/right padding)
- This gives the barcode roughly 48mm of usable width — full sticker utilization
- Adjust grid rows to `3mm 3mm 8mm 2.8mm 3mm` to accommodate slightly taller barcode

### Why this works
- **Skipped sticker**: Browsers honoring both old + new page-break rules can double-trigger the page eject. Using only `break-after: page` ensures one label = one page = one sticker.
- **Larger barcode**: A CODE128 barcode at ~46mm wide with `width: 4` produces module bars ~0.4mm wide — well above the 0.25mm scanner minimum, with sharp edges from the high-res source.
- **No font change needed**: CODE128 is a vector standard, not a font. The issue was purely sizing/quiet-zone placement.

### File
- `src/lib/barcodePrint.ts` — only file changed (used by both Sample Collection and Sample Acceptance prints)

