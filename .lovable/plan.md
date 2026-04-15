

# Invoice Footer Tweaks

## Changes in `src/components/lims/InvoicePreview.tsx`

### 1. Center the barcode
Wrap the `<svg>` in a `<div style={{ textAlign: "center" }}>` (already done) — but also ensure the SVG itself is centered with `display: "block"` and `margin: "0 auto"`.

### 2. Hide UMR number below barcode
Change JsBarcode config from `displayValue: true` to `displayValue: false` (line ~108).

### 3. Add electronic receipt disclaimer
After the barcode `<div>`, add:
```
This is an Electronically Generated Receipt & Does Not Require Signature
```
Styled as `fontSize: 10, color: "#888", marginTop: 6, textAlign: "center"`.

### Single file change
- `src/components/lims/InvoicePreview.tsx`

