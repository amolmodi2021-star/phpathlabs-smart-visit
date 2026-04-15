

# Fix Top Margin on Subsequent Invoice Pages

## Problem
On multi-page invoices, the logo/header on page 2+ sticks to the very top of the page because `body { padding: 8mm }` only applies to the first page's top. The `@page { margin: 12mm }` should handle this, but the content div has no additional top padding.

## Fix in `src/components/lims/InvoicePreview.tsx`

### 1. Add top padding to each page container (line 299)
Change the page div to include `padding-top: 8mm` on all pages except the first (the first page already benefits from body padding):

```html
<div style="${pageBreak} ${pageIdx > 0 ? 'padding-top:8mm;' : ''}">
```

### 2. Alternative: remove body padding entirely, add uniform padding to every page div
Since body padding only applies once, it's cleaner to move it to the page containers. Update the body style (line 313) to remove `padding: 8mm` and add `padding: 8mm` to every page div (line 299).

**Chosen approach**: Add `padding-top:8mm` to subsequent page divs only (option 1), keeping existing layout for page 1 intact.

### Single file change
- `src/components/lims/InvoicePreview.tsx` — one line edit at line 299.

