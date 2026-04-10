

# Fix: Blank Page Between Print Pages

## Problem
Two issues causing the blank middle page:
1. `page-break-after: always` on every `[data-page]` forces a break after the LAST page too, creating a trailing blank page
2. The `gap-4` class on `#print-container` adds visible spacing between pages during print, which can push content and create extra pages

## Changes in `src/pages/LimsReportView.tsx`

### 1. Remove gap from container in print (line 416)
The `gap-4` class is fine for screen display but must be zeroed out in print CSS.

### 2. Use `page-break-after` only on non-last pages (lines 562-573)
Replace `page-break-after: always` with `:not(:last-child)` selector so the last page doesn't force an extra blank page.

Updated print CSS:
```css
@media print {
  body * { visibility: hidden; }
  #print-container, #print-container * { visibility: visible; }
  #print-container {
    position: absolute;
    left: 0;
    top: 0;
    width: 210mm;
    gap: 0 !important;
  }
  [data-page] {
    position: relative;
    display: block;
    width: 210mm !important;
    height: 297mm !important;
    margin: 0 !important;
    padding: 0 !important;
    box-shadow: none !important;
    overflow: hidden;
  }
  [data-page]:not(:last-child) {
    page-break-after: always;
    break-after: page;
  }
  @page { size: A4; margin: 0; }
  .print\\:hidden { display: none !important; }
}
```

## Files
- `src/pages/LimsReportView.tsx`

