

## Change
Update sort order in Daily Payment Register table.

## Current
`DailyReport.tsx` query orders by `invoice_number` ascending only.

## Fix
File: `src/components/lims/DailyReport.tsx`

In the `useQuery` fetch (around line 47), replace the single `.order("invoice_number", { ascending: true })` with:
```ts
.order("invoice_number", { ascending: false })
.order("transaction_date", { ascending: true })
```

This produces:
- Latest invoice number on top (descending)
- Within each invoice, oldest transaction first → newest last (e.g. Registration → Due Collection → Refund)

Totals row and Excel export are unaffected (they iterate `filtered` which already respects the new order).

## Files
- `src/components/lims/DailyReport.tsx` — two-level order in Supabase query

