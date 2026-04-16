
## Rebuild Plan: Barcode Printing Once and for All

### What I found in the current code
- `src/lib/barcodePrint.ts` still prints through a popup window with browser-managed pagination.
- The barcode SVG is being forcibly resized:
  - `width="42mm"`
  - `height="8mm"`
  - `preserveAspectRatio="none"`
- That combination can distort CODE128 bar widths, which explains why scanning became unreliable again.
- The print document root is not fully locked to `50mm x 25mm` on every level, so the thermal printer can still interpret a second blank page/label.

### Root causes
1. **Barcode distortion**: the SVG bars are stretched to fit a box instead of printing at their native module widths.
2. **Thermal pagination issue**: popup/browser print layout is still creating an extra blank label page.
3. **Layout rounding risk**: the current grid row sizing on a tiny 25mm label can overflow by fractions and trigger an extra feed.

### Rebuild approach
I will fully replace the current barcode print structure in `src/lib/barcodePrint.ts` with a stricter label-rendering flow:

1. **Switch to an isolated print document**
   - Replace the current popup-based HTML flow with a dedicated print container structure designed only for label printing.
   - Ensure `html`, `body`, and each label page are all explicitly `50mm x 25mm` with zero margin, zero padding, zero overflow.

2. **Keep SVG barcode, but never stretch it**
   - Continue using `JsBarcode` with SVG since that was the last version that scanned properly.
   - Remove:
     - forced `42mm` width
     - forced `8mm` height
     - `preserveAspectRatio="none"`
   - Let the barcode render at its own native width/module size and center it inside the label.
   - Keep proper quiet zone on both sides.

3. **Rebuild label layout with safer sizing**
   - Replace the current fragile grid row math with a simpler fixed/flex layout that cannot accidentally exceed 25mm.
   - Reserve a dedicated barcode band in the middle and clamp text rows above/below it.

4. **Use strict per-label page wrappers**
   - Each sticker will be rendered inside a single `.page` wrapper.
   - Apply page break only between labels, never before the first or after the last.

5. **Print only after the document is fully ready**
   - Wait until the print document is rendered before calling `print()`.
   - Keep automatic cleanup after print to avoid stale print state.

### Expected result
- **Single barcode print = exactly 1 sticker**
- **Multiple barcodes = exactly the same number of stickers**
- No blank leading sticker
- No blank trailing sticker
- Barcode remains machine-scannable

### File to update
- `src/lib/barcodePrint.ts`

### Technical implementation notes
- Preserve invoice number as the barcode value, since that is the instrument-facing barcode standard in this project.
- Keep `sample_uid` only as printed text reference, not as the encoded barcode.
- Main rule for the rebuild:
```text
Generate barcode at native SVG size
→ do not stretch it
→ center it inside a fixed 50mm x 25mm page
→ break pages only between labels
```
