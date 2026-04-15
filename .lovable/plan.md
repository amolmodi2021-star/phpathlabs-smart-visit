

# Match Invoice Preview, Print & WhatsApp to A5 Layout

## Problem
The in-dialog preview looks different from the printed output. The WhatsApp image also captures whatever the dialog shows, not a proper A5-proportioned layout.

## Approach
Fix the receipt container to render at a fixed A5-proportioned width (148mm ≈ 560px) with consistent padding, so the dialog preview, print output, and WhatsApp capture all look identical.

## Changes in `src/components/lims/InvoicePreview.tsx`

### 1. Fix receipt container to A5 dimensions
On the `receiptRef` div (line 202), set a fixed width and padding matching A5 paper with margins:
```
width: 560px (≈148mm at 96dpi)
padding: 32px (≈8mm margins)
```
Remove the `p-3` class and use inline styles for exact control.

### 2. Update DialogContent width
Change `max-w-sm` to `max-w-2xl` so the dialog can accommodate the fixed-width receipt without squeezing it.

### 3. WhatsApp capture — set fixed width
In `handleWhatsApp`, the `html2canvas` call already captures `receiptRef` — since the container is now fixed-width, the output will match print exactly. Set `width: 560` in html2canvas options to enforce consistent rendering.

### 4. Print handler — keep consistent
The print handler injects `receiptRef.innerHTML` into a new window. Since the receipt now has inline fixed width and padding, the print output will match. Keep the existing `@page { size: A5; margin: 12mm; }` stylesheet.

### Single file change
- `src/components/lims/InvoicePreview.tsx`

