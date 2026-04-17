

## Change
Add an "Invoice Date" column to the Daily Payment Register table, placed immediately to the right of the existing "Date/Time" column.

## Source of the date
Use `transaction_date` from `payment_transactions` rows, formatted as `dd-MM-yyyy` (date only, no time). This represents when the bill/invoice action actually happened.

For cross-day rows (Old Bill Refund, Old Due Recovered, Old Bill Cancelled), the existing `transaction_date` is already today; the original invoice's creation date lives on `patient_registrations.created_at`. To show the **original invoice date**, we'll need to join.

## Question for you
Which date should "Invoice Date" show?
1. **Original bill date** — `patient_registrations.created_at` (so old-bill rows show e.g. 15-04-2026 even though the action happened today). Requires joining `patient_registrations` in the query.
2. **Same as Date/Time but date-only** — just `transaction_date` formatted `dd-MM-yyyy`. No query change.

I'll proceed with **Option 1** unless you say otherwise — it's the more useful one (lets you see at a glance which bills are old).

## File
**`src/components/lims/DailyReport.tsx`**:
1. Update the `useQuery` select to also pull `patient_registrations(created_at)` via FK relationship (column `registration_id`).
2. Add `<TableHead>Invoice Date</TableHead>` right after the existing Date/Time header.
3. Add `<TableCell>{format(parseISO(r.patient_registrations?.created_at ?? r.transaction_date), "dd-MM-yyyy")}</TableCell>` right after the Date/Time cell.
4. Update the footer `colSpan={5}` → `colSpan={6}` so the "Totals" label stays aligned.
5. Add "Invoice Date" column to the Excel export rows.

No DB / RLS / schema changes. No logic changes elsewhere.

