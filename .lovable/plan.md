

## Change
Add an **Invoice # search** input on the Daily Payment Register that searches across **all dates**, ignoring the From/To date filter.

## UX
- New text input "Search Invoice #" placed in the filter row (available to everyone, not gated behind admin).
- When the field is empty → current behavior (date-range query).
- When the field has ≥3 characters → switch the query to search `invoice_number ILIKE '%<query>%'` across the entire `payment_transactions` table (no date filter), capped at 200 rows ordered by `transaction_date DESC`.
- A small hint badge appears: "Searching all dates — date filter ignored".
- Clearing the search returns to date-range mode automatically.

## File
**`src/components/lims/DailyReport.tsx`** only:
1. Add state `const [invoiceSearch, setInvoiceSearch] = useState("")` and a 300ms debounced value.
2. Update `useQuery`:
   - Include `invoiceSearch` in the queryKey.
   - If debounced search has ≥3 chars: query `payment_transactions` with `.ilike("invoice_number", "%search%").order("transaction_date", { ascending: false }).limit(200)` — no date `gte`/`lte`.
   - Otherwise: existing date-range query.
3. Add the `<Input>` next to existing filters with a `Search` icon and a clear (×) button.
4. Add the conditional hint badge above the table when search is active.

## What stays the same
- Existing date / user / mode / type filters
- Admin gating for date-range expansion
- All totals / footer / Excel export logic (operates on whatever rows are loaded)
- No DB / RLS / schema changes

