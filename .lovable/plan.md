

# Dynamic Test Row Distribution Across Invoice Pages

## Problem
The current pagination uses hardcoded constants (10 tests on page 1, 18 on subsequent pages), which leads to wasted space when there are few tests, and doesn't account for the summary/refund section needing space on the last page — causing potential overflow.

## Approach
Replace the fixed row counts with a dynamic calculation that:
1. Estimates the available height on each page type (first page has header+demographics overhead; subsequent pages have header+demographics but no summary)
2. Reserves space on the last page for payment summary, refund details, barcode, and footer
3. Distributes test rows across pages to fill them optimally
4. Ensures the summary section never overflows to an extra page

## Changes in `src/components/lims/InvoicePreview.tsx`

### 1. Replace hardcoded FIRST_PAGE_TESTS / SUBSEQUENT_PAGE_TESTS with dynamic calculation (lines 146-160)

Estimate available height per page in approximate row units:
- A5 printable height ≈ 210mm - 24mm margins = ~186mm usable
- Header + demographics + page footer ≈ ~70mm on every page
- Each test row ≈ ~6mm
- Summary section height varies: base ~40mm + refund section ~25mm + barcode ~20mm + payments (5mm per payment entry)

Calculate `summaryHeight` based on actual data (has refund? has cancelled tests? how many payments?), then:
- `lastPageMaxTests = floor((usableHeight - headerHeight - summaryHeight) / rowHeight)`
- `otherPageMaxTests = floor((usableHeight - headerHeight) / rowHeight)`

Distribute tests backward from the last page: reserve enough rows for the last page, then fill earlier pages to their max.

### 2. Smarter page splitting logic

```
const summaryRows = estimateSummaryRows(data, cancelledTests, payments, hvcRefund);
const ROW_HEIGHT = 6; // mm per test row
const USABLE_HEIGHT = 186; // mm (A5 minus margins)
const HEADER_HEIGHT = 70; // mm (logo + demographics + table header + page footer)
const SUMMARY_HEIGHT = summaryRows * 6 + 40; // base summary height

const lastPageCapacity = Math.floor((USABLE_HEIGHT - HEADER_HEIGHT - SUMMARY_HEIGHT) / ROW_HEIGHT);
const normalPageCapacity = Math.floor((USABLE_HEIGHT - HEADER_HEIGHT) / ROW_HEIGHT);

// Build pages: fill normal pages first, ensure last page fits within capacity
```

### 3. Remove the hardcoded constants
Delete `FIRST_PAGE_TESTS = 10` and `SUBSEQUENT_PAGE_TESTS = 18`.

### Single file change
- `src/components/lims/InvoicePreview.tsx` — rewrite pagination logic (~30 lines around lines 146-160).

