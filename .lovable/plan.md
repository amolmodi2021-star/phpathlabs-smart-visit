

# Fix: Revert Conditional Margins & Fix Print Alignment

## Problem
1. The conditional margin logic (switching between letterhead margins and 10mm) introduced in the last change broke the print layout
2. The print CSS doesn't properly position each page as a standalone A4 sheet — the flex container gaps and browser print rendering cause the large blank space and misalignment seen in the screenshot

## Changes to `src/pages/LimsReportView.tsx`

### 1. Revert conditional margins back to always use layout settings
```typescript
// Line 217-218: Change back to:
const topMm = (layoutSettings.top_margin_cm || 2.5) * 10;
const bottomMm = (layoutSettings.bottom_margin_cm || 1.5) * 10;

// Line 364-365: Same revert:
const topMm = (layoutSettings.top_margin_cm || 2.5) * 10;
const bottomMm = (layoutSettings.bottom_margin_cm || 1.5) * 10;
```

### 2. Fix print CSS for proper A4 alignment
The current print styles don't force each `[data-page]` to fill exactly one printed page. Update the print styles to:
- Set each page to `width: 210mm; height: 297mm` explicitly in print
- Remove flex gaps that add extra space between pages
- Use `page-break-inside: avoid` to keep page content intact
- Hide the `Parameter` column header text "Parameter" and show only data (the "Flag" column header too) — actually, looking at the screenshot again, test names ARE expected. The user concern is about alignment, not hiding test names.

```css
@media print {
  body * { visibility: hidden; }
  [data-page], [data-page] * { visibility: visible; }
  [data-page] {
    position: absolute;
    left: 0;
    top: 0;
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

### Files
- `src/pages/LimsReportView.tsx` — revert margins, fix print positioning CSS

