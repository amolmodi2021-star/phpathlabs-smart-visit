

# Fix: Print Pages Stacking On Top Of Each Other

## Problem
The print CSS sets `position: absolute; top: 0;` on every `[data-page]` element. This places ALL pages at the exact same position (top-left), causing them to overlap into a single printed page.

## Solution
Remove `position: absolute` and `top: 0` from the print CSS. Instead, use `position: relative` and `display: block` so pages flow naturally one after another, each triggering a page break.

## Change in `src/pages/LimsReportView.tsx` (lines 552-571)

Replace the current print styles with:

```css
@media print {
  body * { visibility: hidden; }
  #print-container, #print-container * { visibility: visible; }
  #print-container {
    position: absolute;
    left: 0;
    top: 0;
    width: 210mm;
  }
  [data-page] {
    position: relative;
    display: block;
    width: 210mm !important;
    height: 297mm !important;
    page-break-after: always;
    break-after: page;
    margin: 0 !important;
    padding: 0 !important;
    box-shadow: none !important;
    overflow: hidden;
  }
  @page { size: A4; margin: 0; }
  .print\\:hidden { display: none !important; }
}
```

Also add `id="print-container"` to the wrapping `div ref={printRef}` (line 416) so the print container itself is positioned absolutely but its children (pages) flow naturally within it.

## Files
- `src/pages/LimsReportView.tsx`

