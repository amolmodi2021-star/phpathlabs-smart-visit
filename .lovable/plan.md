

# Add Line Spacing to Invoice Print

## Problem
The printed invoice has lines too close together compared to the on-screen preview, because the print stylesheet doesn't include any line-height rules.

## Changes in `src/components/lims/InvoicePreview.tsx`

### 1. Add `line-height` to print body style (line 148)
Add `line-height: 1.6;` to the body rule in the print stylesheet, increasing spacing between all text lines.

### 2. Add table cell line-height (line 150)
Add `line-height: 1.5;` to `th, td` rule so table rows also get more breathing room.

### Single file change
- `src/components/lims/InvoicePreview.tsx` — two small additions to the print `<style>` block.

