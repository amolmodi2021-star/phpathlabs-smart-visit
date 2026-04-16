

## Fix: Barcode Not Scannable

### Root cause
Three rendering issues are degrading scanner readability:

1. **`image-rendering: pixelated` + `width: 100%` stretch** — The PNG is generated at a fixed canvas pixel width (e.g. ~400px for short codes, larger for long codes), then scaled by the browser to fill ~48mm. With `pixelated`, the scaling produces **uneven bar widths** (some bars become 2px wide, neighbors become 3px wide). Scanners reject CODE128 when the module-width ratio isn't consistent.
2. **No quiet zone validated against CODE128 spec** — CODE128 requires a quiet zone of **≥10× the narrow bar width** on each side. With ~0.4mm bars, that's ~4mm — but we only give 1mm CSS padding. Many handheld scanners refuse to decode.
3. **PNG raster + browser scaling** — Even with crisp-edges, raster scaling at print resolution (often 203 DPI on thermal, 600 DPI on laser) creates anti-aliased gray edges that scanners read as "in-between" bars.

### The fix — render barcode as SVG sized in mm

Switch `JsBarcode` from canvas/PNG to **SVG output**, sized directly in millimeters. SVG is vector — the printer rasterizes at native DPI with **mathematically perfect bar widths**, no scaling artifacts.

**Changes in `src/lib/barcodePrint.ts`:**

1. **Generate barcode as SVG, not PNG**
   - Create an `<svg>` element instead of `<canvas>`
   - `JsBarcode(svg, value, { format: "CODE128", width: 2, height: 40, displayValue: false, margin: 0 })`
   - Module width `2` (SVG units) gives clean ratios; the SVG itself is then sized via attributes
   - Inject `svg.outerHTML` directly into the print HTML (no `toDataURL`)

2. **Size the SVG explicitly in mm**
   - Set `width="42mm" height="8mm"` as SVG attributes (not CSS) so the printer driver gets exact physical dimensions
   - Remove `preserveAspectRatio` issues by setting `preserveAspectRatio="none"` — bars stretch uniformly

3. **Proper quiet zone via centered container**
   - `.barcode-wrap` becomes `padding: 0 3mm` (3mm each side = sufficient quiet zone for CODE128 at this bar width)
   - Sticker is 50mm wide → 50 − 6 (quiet zone) − 1.6 (label padding) ≈ 42mm barcode width
   - SVG centered within wrap

4. **Remove `image-rendering: pixelated`** — no longer needed; SVG is vector.

5. **Keep CODE128 module ratio integer-clean** — with SVG `width: 2` and explicit `width="42mm"`, the printer scales vector coordinates uniformly. No fractional-pixel jitter.

### Why this works
- **Vector = perfect bars**: Thermal/laser printers rasterize SVG at their native DPI. Every narrow bar prints exactly the same width; every wide bar is exactly 2× or 3×. This is what CODE128 scanners require.
- **Real quiet zone**: 3mm white space each side ≥ 10× narrow bar width (0.25mm) → meets ISO/IEC 15417 quiet zone spec.
- **No scaling distortion**: The `width: 100% + pixelated` PNG stretch was the real culprit — even crisp PNGs become unreadable when scaled non-integer-multiples.

### File
- `src/lib/barcodePrint.ts` — only file changed.

