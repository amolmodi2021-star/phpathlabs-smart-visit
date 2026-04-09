

# Plan: Add Historical Result Columns (Previous 2 Values) to Results Entry

## Overview
Add two columns ("Prev 1" and "Prev 2") before the Result column in the patient-wise and machine-wise result entry table. These columns show the last two historical result values for the same parameter from the same patient (matched by UMR number), along with the reference range and date from those past records.

## Data Source
- Query `patient_results` joined with `patient_registrations` to find previous results for the same UMR number and parameter.
- Exclude the current registration's results.
- Order by `created_at DESC` and take the top 2 per parameter.

## Display Format (per column)
Each history cell shows a compact stack:
- **Result value** (bold)
- **Reference range** (small, muted — from that historical record, not current master)
- **Date** (small, muted — dd-MM-yyyy format)

If no historical data exists, show "—".

## Technical Changes

### File: `src/components/lims/ResultsEntry.tsx`

1. **New query**: Fetch historical results for expanded patient's UMR number.
   - When a patient is expanded, query `patient_results` joined with `patient_registrations` where `umr_number` matches and `registration_id != current`, ordered by `created_at DESC`.
   - Build a map: `parameterId → [{ resultValue, referenceRange, createdAt }, ...]` (max 2 per param).

2. **Table header**: Insert two new `<TableHead>` columns ("Prev 1", "Prev 2") between "Parameter" and "Result" columns.

3. **renderParamRow**: Insert two new `<TableCell>` elements that look up the history map and display the stacked value/range/date or "—".

4. **Blank dialog table**: Add the same two columns for consistency.

## UI Layout
```text
Code | Parameter | Prev 1      | Prev 2      | Result | Unit | Ref. Range | Flag | Status | Actions
                   12.5           11.8
                   11-16 g/dL     11-16 g/dL
                   26-03-2026     15-02-2026
```

Columns will be narrow (~100px) with compact text (text-xs) to avoid excessive width.

