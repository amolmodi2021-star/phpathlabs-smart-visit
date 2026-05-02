# Outsourced Results — Match Patient-Wise Layout & Sort

Bring the **Outsourced** section in line with **Results Entry → Patient-Wise**: show invoice number as the primary identifier, patient name as secondary, and order the list by invoice number descending.

## Changes (single file: `src/components/lims/OutsourcedResults.tsx`)

### 1. Sort by invoice number descending
In the accepted-registrations query (around line 144-145), replace the current `is_stat` + `updated_at` ordering with:
- `.order("is_stat", { ascending: false })` (keep STAT-first urgency rule per project standards)
- `.order("invoice_number", { ascending: false })`

This mirrors how `ResultsEntry` orders its list (line 209) and ensures newest invoices appear at the top.

### 2. Swap invoice ↔ name in the patient header (around lines 1117-1129)
Currently:
```
[patient_name]  [STAT dot]  [invoice_number (small, muted)]
```
Change to match Patient-Wise (lines 1810-1825 of ResultsEntry):
```
[invoice_number (font-medium font-mono)]  [PARTIAL]  [STAT dot]  [patient_name (small, muted)]
```

Sub-line (`mobile • N test(s)`) stays unchanged.

## Out of scope
- No DB / migration changes.
- No changes to expansion content, snip handling, or status badges.
- Other sections (Results Entry, Verification, Approval, Dispatch) already follow this layout — untouched.
