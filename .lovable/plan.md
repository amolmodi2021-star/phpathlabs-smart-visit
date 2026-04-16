

## Plan: Fix Barcode Size to 37mm Width × 10mm Height

### Assumption
User typed "3.7 MM" but means **37 mm** (3.7 cm) — a 3.7mm-wide barcode would be physically unreadable on a 50mm sticker. Confirming via the sticker context: 50mm sticker, current barcode placed at 46mm wide. 37mm wide × 10mm tall fits cleanly with margins.

### Change
In `src/lib/barcodePrint.ts`, update the `doc.addImage()` call inside the tube loop:

**Current:**
```typescript
doc.addImage(png, "PNG", 2, 6.5, 46, 12, undefined, "FAST");
```

**New — center 37mm wide × 10mm tall barcode on 50mm sticker:**
```typescript
// Center horizontally: (50 - 37) / 2 = 6.5mm left margin
doc.addImage(png, "PNG", 6.5, 7.5, 37, 10, undefined, "FAST");
```

### Layout Impact
- Barcode occupies y: 7.5 → 17.5 (10mm tall)
- Sample ID line at y: 20.5 — still clears the barcode (3mm gap) ✓
- Bottom row at y: 23.5 — unchanged ✓

Native CODE128 rendering from bwip-js stays untouched (per previous request). jsPDF will scale the native PNG down to fit the 37×10mm box.

### File
- `src/lib/barcodePrint.ts` — single line change (`doc.addImage` parameters)

### No DB / other file changes

