

# Fix Barcode Not Showing in Print

## Problem
The barcode displays in the preview because it's rendered by JsBarcode into a React-managed SVG ref. However, the `handlePrint` function builds HTML strings from scratch and never includes the barcode SVG markup.

## Fix in `src/components/lims/InvoicePreview.tsx`

### Capture the barcode SVG and inject it into the print HTML

In the `handlePrint` function, before building `summaryHtml` on the last page, grab the rendered barcode SVG's `outerHTML` from `barcodeRef.current` and inject it into the last page's summary section (after payment details, before the "Thank you" footer).

```typescript
// Around line 282, before the footer section in summaryHtml
const barcodeSvgHtml = barcodeRef.current ? barcodeRef.current.outerHTML : '';
if (barcodeSvgHtml) {
  summaryHtml += `<div style="margin-top:6px;text-align:center">${barcodeSvgHtml}</div>`;
}
```

This reads the already-rendered SVG from the preview DOM and embeds it as inline SVG in the print HTML. No additional JsBarcode call needed.

### Single file change
- `src/components/lims/InvoicePreview.tsx` — ~3 lines added inside `summaryHtml` block on the last page.

