

# Multi-Page A5 Invoice Printing with Pagination

## Problem
When a patient has many tests, the invoice overflows a single A5 page. The print output needs proper page breaks with repeated headers, subtotals per page, and page numbering.

## Approach
Rework the `handlePrint` function to programmatically split tests across pages, generating proper multi-page HTML instead of dumping the single `receiptRef` div. The in-dialog preview and WhatsApp image remain as a single continuous layout (unchanged).

## Changes in `src/components/lims/InvoicePreview.tsx`

### 1. Build a page-splitting helper
Create a function that takes the tests array and splits them into chunks. First page fits ~10 tests (less room due to full header + demographics). Subsequent pages fit ~18 tests (only compact header + demographics). These numbers account for A5 at 10px font with line-height 1.6.

### 2. Rewrite `handlePrint` to generate multi-page HTML
Instead of `receiptRef.current.innerHTML`, build page-by-page HTML:

- **Every page**: Logo, lab name, contact, address, tagline (compact header), patient demographics (Invoice #, Date, Patient, Mobile, Gender, Age, Doctor, UMR, Visit), then the test table continuing from where the previous page left off.
- **Every page**: Footer with "Page X of Y" centered at the bottom.
- **Each page except the last**: A subtotal row at the bottom of the table showing the running subtotal of tests on that page.
- **Last page only**: After the table ends, show Gross Amount, Discount, Home Visit Charges, Final Amount, payment details, Paid, Due, Refund, barcode, and footer text.

### 3. Print CSS for page breaks
Use `page-break-after: always` on each page container div (except the last). Each page div is sized to fit within A5 margins.

### 4. No changes to preview or WhatsApp
The `receiptRef` div and `handleWhatsApp` remain untouched — they continue rendering as a single continuous layout.

### Single file change
- `src/components/lims/InvoicePreview.tsx` — rewrite `handlePrint` function (~80 lines).

