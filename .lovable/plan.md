

## Problem
Invoice **2604150003** appears as TWO `due_collection` rows in Daily Report. Each row carries the registration's full `gross=1400`, `final=1400`, plus its own `paid` & `due` snapshots. When the totals row SUMs all rows for the day, those snapshots stack:
- Gross 1400 + 1400 = 2800 added (only ₹150 cash actually collected across both)
- Final 1400 + 1400 = 2800 added
- Paid 100 + 200 = 300 (200 already counted again from later snapshot)
- Due 1000 + 900 = 1900 added (already on the original Registration row)

The original `registration_payment` row separately holds the true gross/discount/final/paid/due. Due-collection rows duplicate them → grand totals inflate every time a due is collected.

## Fix (mirrors the Refund fix)
Treat `due_collection` rows the same way as `refund` / `bill_cancellation` rows: they represent ONLY the money-in delta. They must NOT duplicate registration snapshot fields.

### A. `src/components/lims/DuePayments.tsx` — `handleCollect`
Change the `logPaymentTransaction` call so the due-collection row stores ONLY the delta:
- `gross_amount = 0`
- `discount_amount = 0`
- `final_amount = 0`
- `paid_amount = 0` (this is the per-row payment delta — already represented by `total_amount` and the per-mode columns)
- `due_amount = 0`
- `total_amount` = amount collected this time (unchanged)
- `cash/gpay/paytm/credit_card/neft_amount` = the split for this collection (unchanged)

The original `registration_payment` row continues to hold the authoritative gross/discount/final. Daily Report totals then naturally show:
- Gross/Final = registration's actual values (counted once)
- Cash/GPay etc. = SUM of registration row + each due-collection row = real cash drawer
- Paid = registration's initial paid + each due collection (correct delta sum)

### B. Daily Report display
No change needed. The current renderer already shows ₹0 for zero values which is fine for delta rows.

Optionally (cleanup): for `due_collection` / `refund` / `bill_cancellation` / `discount_applied` rows, render the snapshot columns (Gross/Discount/Final/Paid/Due) as `-` instead of `₹0` so the eye doesn't try to read them as money. Small UX polish.

### C. One-time data fix
Update existing `due_collection`, `discount_applied` (and any other supplemental) rows in `payment_transactions` to zero out the snapshot fields:
```sql
UPDATE payment_transactions
SET gross_amount = 0, discount_amount = 0, final_amount = 0,
    paid_amount = 0, due_amount = 0
WHERE transaction_type IN ('due_collection', 'discount_applied');
```
This corrects the historical data (including both rows for invoice 2604150003) so today's Daily Report immediately reflects accurate totals.

### Note on `discount_applied` rows
Same conceptual issue — discount audit rows carry a snapshot too. Including them in the same backfill prevents future inflation when discounts are edited later.

## Files
- `src/components/lims/DuePayments.tsx` — set snapshot fields to 0 in `logPaymentTransaction` call (lines 144–148)
- `src/components/lims/DailyReport.tsx` *(optional polish)* — render `-` instead of `₹0` for snapshot columns when row type is `due_collection` / `refund` / `bill_cancellation` / `discount_applied`
- One-time SQL UPDATE on `payment_transactions` (no schema change)

## What stays the same
- Schema unchanged
- Audit trail intact — due-collection row still tagged with `transaction_type: "due_collection"`, full mode split, and remarks
- `EditRegistrationDialog` flows already correct (in-place sync of registration row)
- Refund / bill-cancellation handling unchanged
- Net Collection card stays accurate (in − out)

