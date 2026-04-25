## Plan: Add Compact PDF Print for Daily Report

The Daily Report has many columns (Invoice, Date, Time, Username, Type, Patient, Visit Type, Source, Billing, Gross, Discount, Final, Paid, Due, Cash, GPay, Paytm, NEFT, CC, Refund, Remarks). A compact PDF that fits everything on a printable page is needed alongside the existing Excel export. Excel stays as-is (already exports all data).

### Implementation (`src/components/lims/DailyReport.tsx`)

**1. Add jsPDF import** (already a project dependency, used by `PickupInvoicePDF.tsx`).

**2. Add `printPdf()` function** that builds a compact A4 **landscape** PDF using manual jsPDF table drawing (no autotable dependency needed):

- **Page**: A4 landscape (297×210mm), margins 6mm.
- **Header**: "PH PathLabs — Daily Payment Register" + date range + filters summary + generation timestamp.
- **Summary band**: Total In, Total Out, Net Collection, Transaction Count + per-mode totals (Cash/GPay/Paytm/NEFT/CC) — single compact row.
- **Table**: 
  - Column widths tuned for landscape A4 (~285mm usable). Tight columns:
    - Inv# (18), Inv Date (14), Time (22), User (16), Type (20), Patient (28), Visit (16), Pickup/Channel (22), Bill (10), Gross (14), Disc (12), Final (14), Paid (14), Due (12), Cash (12), GPay (12), Paytm (12), NEFT (12), CC (12), Refund (12), Remarks (16).
  - Font: Helvetica 6.5pt body, 7pt headers, bold totals row.
  - Numeric columns right-aligned, monospace-like alignment via `align: "right"`.
  - Zero amounts shown as "-" to reduce visual noise.
  - Refunds (negative) shown in dim/parens style (jsPDF: red text via `setTextColor(180,0,0)`).
  - Header row: light grey fill, bold; alternating row shading for readability.
  - Auto page-break: when y exceeds page height, draw new page with repeated header row.
- **Footer**: "Page X of Y" + totals row repeated on last page.
- **Filename**: `Daily_Report_{from}_to_{to}.pdf` (or `_search_{term}` when searching).
- **Open behavior**: `doc.save(filename)` to download.

**3. Add "Print PDF" button** in the toolbar next to "Export Excel":
```tsx
<Button variant="outline" size="sm" onClick={printPdf} disabled={filtered.length === 0}>
  <Printer className="h-3.5 w-3.5 mr-1" /> Print PDF
</Button>
```

**4. Add `Printer` icon import** from lucide-react.

### Compactness techniques

- Landscape orientation (almost double horizontal space vs portrait).
- Helvetica 6.5pt body — small but legible when printed at 100%.
- Strip "₹" prefix from numeric cells in the PDF (column header gets "(₹)" suffix instead) to save width.
- Truncate Patient and Pickup/Channel names with ellipsis if they exceed cell width.
- Truncate Remarks to ~20 chars.
- Time-only in the Date/Time column (date already in Invoice Date column) → saves significant width.
- Visit Type abbreviated: "Lab" / "Home" / "Pickup" / "Channel".

### Files Changed
- `src/components/lims/DailyReport.tsx` — add `printPdf` function, "Print PDF" button, Printer icon, jsPDF import.

No new dependencies, no DB changes, no changes to existing Excel export.