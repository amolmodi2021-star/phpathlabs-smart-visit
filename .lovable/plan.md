

## Re-analysis: Suffix is NOT the Problem

User confirms old LIMS also uses alphanumeric suffixes and works fine on Indiko Plus. So Code 128 Subset B with alphanumerics is acceptable to the analyzer. The issue must be elsewhere.

### Comparing the Two Barcodes (from the uploaded image)

Looking again at the image:
- **Old LIMS barcode (bottom)**: Taller bars, wider quiet zones, thicker bar widths → physically more robust
- **Lovable barcode (top)**: Shorter bars (8mm), zero padding (`paddingwidth: 0`), thinner bars → analyzer's internal CCD reader struggles

### Real Root Causes (in order of likelihood)

**1. Quiet Zone is ZERO** ⚠️ Most likely cause
```typescript
paddingwidth: 0,
paddingheight: 0,
```
CODE128 spec **requires** a quiet zone of **at least 10× the narrowest bar width** on both sides. With `paddingwidth: 0`, bars touch the edge of the image — handheld scanners forgive this, but **fixed-mount analyzer readers (like Indiko Plus's internal reader) strictly enforce it** and refuse to decode.

**2. Bar height too short (8mm)**
The Indiko Plus internal reader scans a narrow horizontal slit. Old LIMS barcode is visibly ~10-12mm tall. 8mm gives less vertical tolerance for tube rotation/tilt during loading.

**3. Bar width (X-dimension) too thin**
`scale: 4` at 50mm width with ~10 chars = very thin bars (~0.25mm). Indiko spec sheet typically requires **min X-dimension of 0.30mm (12 mil)** for reliable internal read.

### The Fix — Three Coordinated Changes

```typescript
bwipjs.toCanvas(canvas, {
  bcid: "code128",
  text: value,
  scale: 5,              // ↑ thicker bars (was 4)
  height: 12,            // ↑ taller bars in mm (was 8)
  includetext: false,
  paddingwidth: 10,      // ↑ proper quiet zone (was 0)
  paddingheight: 2,      // ↑ small vertical pad (was 0)
  backgroundcolor: "FFFFFF",
});
```

And adjust PDF placement to fit the taller barcode:
```typescript
doc.addImage(png, "PNG", 2, 6.5, 46, 12, undefined, "FAST");  // wider, taller
```

Plus shift the sample ID line and bottom row down to accommodate the taller barcode within the 25mm sticker.

### Why This Will Work
- Quiet zone of 10 modules = analyzer's decoder sees clean white space before the start bar → recognizes the barcode boundary
- 12mm bar height = matches old LIMS visually, gives tube-tilt tolerance
- Thicker bars = better contrast read on thermal labels at any DPI

### File
- `src/lib/barcodePrint.ts` — `renderBarcodePng()` options + barcode placement coordinates in the PDF loop

### No DB / other file changes

