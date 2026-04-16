
## Reverify: Extra Blank Sticker Before/After Barcode Print

### What I found
- The barcode print helper is still only called once per user action in `SampleCollection` / `SampleAcceptance`, so this does **not** look like a duplicate click handler issue.
- The uploaded photo suggests a **blank label page is being created in the print document itself** (blank sticker + printed sticker in one single-label print job).
- Current print CSS still relies on browser pagination behavior inside a popup window. Thermal barcode printers are very sensitive to this and often mis-handle generic browser page-break CSS.

### Plan
1. **Refactor the print HTML to use explicit page wrappers**
   - Wrap each sticker in a dedicated `.page` container sized exactly `50mm x 25mm`.
   - Move the actual sticker markup inside that page.
   - Avoid relying on the current `.label + .label { break-before: page }` approach.

2. **Use only one pagination rule**
   - Apply page break only on `.page:not(:last-child)`.
   - This prevents both:
     - an unwanted blank first sticker
     - an unwanted blank trailing sticker

3. **Lock the print document to exact thermal dimensions**
   - Set `html`, `body`, and `.page` to exact label size with no extra flow height.
   - Force `overflow: hidden`, zero margins, zero padding, and no min-height behavior that could create an empty page.

4. **Delay printing until layout is fully ready**
   - After writing the popup HTML, wait for the document load plus one render tick before calling `print()`.
   - This avoids browsers/printers snapshotting the popup before the label content/SVG is fully laid out.

5. **Close the print window after print**
   - Clean up the popup after `afterprint` so the browser does not keep stale print state.

### Expected result
- Printing **1 barcode** should produce exactly **1 sticker**
- Printing **N barcodes** should produce exactly **N stickers**
- No leading blank sticker
- No trailing blank sticker
- Existing barcode sharpness/scannability stays unchanged

### File to update
- `src/lib/barcodePrint.ts`

### Technical note
The likely fix here is not barcode content itself, but making the popup print document behave like a true label sheet:
```text
body
└── .page (50mm x 25mm)
    └── .label
```
with page breaks only between `.page` elements, never on the label node itself.
