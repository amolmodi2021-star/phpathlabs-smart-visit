

# Add Paper Border Margins to Invoice Print

## What changes
The printed invoice currently has `@page { margin: 8mm }` but the body content has no padding, so it appears edge-to-edge. Add padding to the invoice content container so there's a visible border margin on print.

## Changes in `src/components/lims/InvoicePreview.tsx`

### 1. Increase `@page` margin
Change `margin: 8mm` → `margin: 12mm` in the print stylesheet for more breathing room.

### 2. Add padding to the receipt container
On the `ref={receiptRef}` div (line 202), add `padding: 16px` inline so that when the innerHTML is injected into the print window, the content has internal margins. Update the print body style to include `padding: 10mm` as well.

### 3. Update print body style
Change `body { padding: 0; ... }` to `body { padding: 8mm; ... }` so the content doesn't touch the page edges.

### Single file change
- `src/components/lims/InvoicePreview.tsx`

