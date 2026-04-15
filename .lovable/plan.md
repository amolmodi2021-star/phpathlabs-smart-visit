

# Invoice Preview Fixes

## Changes in `src/components/lims/InvoicePreview.tsx`

1. **Fix barcode not rendering** — The barcode `useEffect` runs before the SVG is mounted in the DOM (since it depends on `open` and `data?.umr_number` but the SVG may not be in the DOM yet). Add a small timeout or use a callback ref to ensure the SVG element exists before calling `JsBarcode`.

2. **Maximize test name column width** — Set the `#` column and amount columns to `width: 1%` / `whiteSpace: nowrap` so the Test column gets all remaining space.

3. **Fix "Thank you" text** — Change `"Thank you for choosing {brand.invoice_lab_name}"` to `"Thank you for choosing us"`.

4. **Add "Received with thanks" line** — Below the Paid amount line, add:
   ```
   Received with thanks from {PATIENT_NAME} a sum of Rs. {paid_amount}.00/- ({amount in words} Rupees)
   ```
   Add a helper function `numberToWords` to convert the paid amount to words (e.g., 520 → "Five Hundred Twenty").

## Technical details

- **Number to words**: Implement a simple `numberToWords()` function handling Indian currency amounts (units, teens, tens, hundreds, thousands, lakhs, crores).
- **Barcode fix**: Use `setTimeout(() => { ... }, 100)` inside the useEffect to let React complete DOM rendering before JsBarcode tries to access the SVG ref. Alternatively use a callback ref pattern.
- **Column widths**: Add `width: "30px"` to `#` column and `whiteSpace: "nowrap"` to amount columns, letting the Test column auto-expand.

### Single file change
- `src/components/lims/InvoicePreview.tsx`

