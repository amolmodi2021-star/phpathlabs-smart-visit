

# Hide "Old Bill Cancelled" marker rows from Daily Report

## The current behavior

When a bill from a previous day is cancelled today, `processCancelBill` (in `EditRegistrationDialog.tsx`) inserts **two rows** dated today:

1. **`old_bill_refund`** — the actual cash outflow (Cash or NEFT, negative).
2. **`old_bill_cancellation`** — a marker row with all mode amounts = 0 and negative gross/discount/final, purely for audit visibility.

Both rows then appear in today's Daily Report. The screenshot shows the marker row (`Old Bill Cancelled`, ₹-100 final, no mode movement) — which the user says is redundant. The refund line above it already carries the patient context and the actual cash impact.

## The fix

Suppress `old_bill_cancellation` rows from the Daily Report view (table + summary totals + Excel export), but keep writing them to the database (audit trail and historical immutability are preserved). Same-day `bill_cancellation` rows continue to display unchanged.

### Single-file change — `src/components/lims/DailyReport.tsx`

1. **`filtered` memo (line 100)** — add a guard that drops `old_bill_cancellation` rows before any other filter logic runs:
   ```ts
   const rows = transactions.filter((t: any) => {
     if (t.transaction_type === "old_bill_cancellation") return false;
     // … existing filters
   });
   ```

2. **Type filter dropdown (line 210)** — remove the `old_bill_cancellation` option from the Select so admin filters can't surface it either:
   ```ts
   {Object.entries(TRANSACTION_LABELS)
     .filter(([k]) => k !== "old_bill_cancellation")
     .map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
   ```

3. **`TRANSACTION_LABELS` map** — keep the `old_bill_cancellation` label entry (still needed if the row ever surfaces, e.g. via invoice search on a historical day where it was originally inserted), but it's effectively dormant in today's view.

That's it. Because `filtered` is the source for both the summary totals memo and the Excel export, both automatically exclude the marker rows.

## What stays untouched

- `processCancelBill` in `EditRegistrationDialog.tsx` — still writes both audit rows (refund + cancellation marker). DB schema and audit trail are intact.
- Same-day `bill_cancellation` rows — still display normally (only the cross-day "old" marker is hidden).
- `old_bill_refund` row — continues to display with patient name, invoice, refund mode, and ₹-100 cash impact.
- Cash drawer totals — already correct, since the marker row had all mode amounts = 0.

## Verification

1. Cancel a bill registered on a previous day. The Daily Report (today) should show only the **Old Bill Refund** row (e.g. invoice 2604210003, MANISH, -₹100 in chosen refund mode). The "Old Bill Cancelled" row should not appear.
2. Same-day bill cancellation still produces both `bill_cancellation` and `refund` rows visible — unchanged.
3. Excel export of today's report excludes the marker row.
4. Database `payment_transactions` still contains the `old_bill_cancellation` row for full audit (visible only via direct query, not in UI).

## Risk

Negligible. Pure presentation filter; no DB or business-logic change. Audit trail in `payment_transactions` is preserved. Cash drawer totals were already independent of the marker row.

## Memory update

Update `mem://features/lims/bill-cancellation-rule.md` to note: "The `old_bill_cancellation` marker is written to DB for audit but hidden from the Daily Report UI to avoid redundancy with the `old_bill_refund` row that already shows the cash impact."

