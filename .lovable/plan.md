

## Plan: Use Pure Native CODE128 — No Formatting Tweaks

### Goal
Strip all custom barcode formatting (scale boost, height boost, padding, etc.) and let bwip-js render CODE128 in its **default native format** — exactly as the spec defines, no embellishments.

### Current State (in `src/lib/barcodePrint.ts`)
```typescript
bwipjs.toCanvas(canvas, {
  bcid: "code128",
  text: value,
  scale: 5,
  height: 12,
  includetext: false,
  paddingwidth: 10,
  paddingheight: 2,
  backgroundcolor: "FFFFFF",
});
```

### Change To — Native Defaults Only
```typescript
bwipjs.toCanvas(canvas, {
  bcid: "code128",
  text: value,
  includetext: false,
});
```

That's it. No scale, no height, no padding, no background color overrides. bwip-js will use its built-in CODE128 defaults (scale 2, height 10mm, default quiet zone per spec).

### PDF Placement
Keep the existing barcode image area on the sticker (`2, 6.5, 46, 12` mm). The PNG will simply render at native bwip-js dimensions and jsPDF will scale it to fit the 46×12 mm box on the label.

### File
- `src/lib/barcodePrint.ts` — `renderBarcodePng()` options only (remove `scale`, `height`, `paddingwidth`, `paddingheight`, `backgroundcolor`)

### No DB / other file changes

