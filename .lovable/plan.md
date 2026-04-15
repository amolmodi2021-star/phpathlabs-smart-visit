

# Invoice Preview Enhancements

## Changes in `src/components/lims/InvoicePreview.tsx`

### 1. Remove "Sample ID" line
Delete the `<p>Sample ID: {data.invoice_number}</p>` line (line 254). Keep only the "Thank you" line.

### 2. Conditionally hide Discount column
Compute `hasAnyDiscount = tests.some(t => Number(t.discount || 0) > 0)`. If false, hide the "Disc" column header and cells, and rename "MRP" to "Amount" and remove the "Net" column (since MRP = Net when no discount).

### 3. Show only Final Amount when no discount/HVC
If `activeGross === activeFinal`, show only the "Final Amount" line. Skip "Gross Amount" line.

### 4. Show "Prepared by" at the bottom
Display `data.registered_by` (already saved on the registration) above the "Thank you" line.

### 5. Render UMR barcode at bottom
Use a simple Code128-style barcode. Generate an SVG barcode from `data.umr_number` using a lightweight inline approach (or import `JsBarcode` — already in the project or add it). Render below the thank-you text.

### 6. Show channel name beside visit type
Fetch the channel name from the `channels` table using `data.channel_id` when the dialog opens. Display as "Visit: Home Visit (Channel Name)" or just "Visit: Lab".

### 7. Format visit type properly
Replace `data.visit_type?.replace("_", " ")` with a formatter: `home_visit` → "Home Visit", `lab_visit` → "Lab", `pickup_point` → "Pickup Point". Capitalize properly instead of lowercase.

## Technical details

- **Barcode**: Will add `jsbarcode` package dependency and render a canvas/SVG barcode for the UMR number.
- **Channel lookup**: Add a small query in the existing `useEffect` to fetch channel name when `data.channel_id` is set.
- **No database changes needed.**

### File changed
- `src/components/lims/InvoicePreview.tsx`

