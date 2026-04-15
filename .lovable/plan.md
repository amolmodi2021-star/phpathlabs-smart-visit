

# Resize Invoice to A5 Paper

## What changes
Scale down the invoice layout to fit A5 paper dimensions (148mm × 210mm) instead of the current wider format.

## Changes in `src/components/lims/InvoicePreview.tsx`

### 1. Reduce dialog and content width
- Change `max-w-lg` on DialogContent to `max-w-sm` (~384px, closer to A5 proportions).

### 2. Scale down font sizes throughout
| Element | Current | New |
|---------|---------|-----|
| Lab name heading | 20px | 16px |
| Contact / tagline | 12px / 11px | 10px / 9px |
| Address | 11px | 9px |
| Patient details grid | 13px | 11px |
| Table headers/cells | 12px | 10px |
| Totals section | 13px | 11px |
| Footer text | 11px | 9px |
| Disclaimer | 10px | 8px |
| "Received with thanks" | 12px | 10px |

### 3. Reduce padding/margins
- Container padding: `p-4` → `p-3`
- Table cell padding: `6px` → `4px`
- Margins between sections reduced proportionally.
- Logo max-height: `50px` → `40px`.

### 4. Print stylesheet for A5
- Update the print `<style>` in `handlePrint` to set `@page { size: A5; margin: 8mm; }` and constrain body width.

### 5. Barcode sizing
- Reduce barcode `height: 30` → `24` and `width: 1.5` → `1.2` to fit A5 proportions.

### Single file change
- `src/components/lims/InvoicePreview.tsx`

