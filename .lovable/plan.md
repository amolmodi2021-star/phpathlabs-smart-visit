

## Issue
For cancelled bills, the "Bill Cancellation" / "Old Bill Cancelled" row currently appears **after** the "Refund" / "Old Bill Refund" row in the Daily Payment Register. Logically the bill is cancelled first and refund follows — display order should reflect that.

## Root cause
In `EditRegistrationDialog.tsx` the refund row is `logPaymentTransaction(...)` first, then the cancellation marker row. Both get `transaction_date = now()` microseconds apart, refund being slightly earlier. The Daily Report sorts by `invoice_number DESC` then `transaction_date ASC`, so refund wins the tie.

## Fix (display-only, no DB changes)
In `src/components/lims/DailyReport.tsx`, after fetching `transactions`, apply a stable secondary sort: within the same `invoice_number`, place rows of type `bill_cancellation` / `old_bill_cancellation` **before** `refund` / `old_bill_refund`. Other types keep their existing chronological order.

Approach: define a small `typeRank` map (cancellation=0, refund=1, everything else=2) and re-sort `filtered` (or `transactions`) using:
1. invoice_number desc (preserve current grouping)
2. typeRank asc (cancellation before refund)
3. transaction_date asc (preserve existing chronology for non-cancel/refund rows)

Apply the same ordering to the Excel export so the file matches the on-screen view.

## Files
- `src/components/lims/DailyReport.tsx` — add `typeRank` and resort the `filtered` memo (used by both table and Excel export). ~10 lines.

## Out of scope
- No change to `payment_transactions` data, schema, or insertion order.
- No change to `EditRegistrationDialog.tsx` insertion sequence.

