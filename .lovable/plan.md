

## Problem
Screenshot shows registration row for invoice 2604170001:
- Final = ₹240 (after ₹60 discount on ₹300 gross)
- Due = ₹300 (RED) ← wrong, should be ₹240

The earlier one-time SQL fix set `due_amount=300` to restore the "at-registration" state. But at registration, paid was 0 and final was 240 → due should have been 240, not the gross 300. I incorrectly used gross.

Invariant: **due_amount = final_amount − paid_amount** must always hold on the registration row.

## Fix

### A. Data correction (one-time SQL)
```sql
UPDATE payment_transactions
SET due_amount = 240  -- final 240 − paid 0
WHERE id = 'bfd9add0-f3c7-4477-950a-f27a509b7603';
```

Also sweep any other rows where the invariant is violated (registration_payment rows where due ≠ final − paid):
```sql
UPDATE payment_transactions
SET due_amount = final_amount - paid_amount
WHERE transaction_type = 'registration_payment'
  AND due_amount <> (final_amount - paid_amount);
```

### B. Code guard in `src/lib/paymentTransactions.ts` — `syncRegistrationPaymentRow`
When `sync_payment_split` is **false** (the default — discount/test edits), the existing `paid_amount` on the audit row stays frozen. The caller passes the live registration's `due_amount` (which reflects current paid via collections), but for the registration audit row the correct value is:

```
due_on_registration_row = final_amount - existing.paid_amount
```

Compute this inside `syncRegistrationPaymentRow` using the row we already fetch. Override the passed `due_amount` when not syncing the split. This keeps the invariant true forever, regardless of what the caller passes.

When `sync_payment_split` is **true**, use the passed `due_amount` as-is (matches the new paid_amount being written).

## Verification
After fix, registration row for 2604170001:
- Gross 300, Discount 60, Final 240, Paid 0, Due **240** ✓
- Due Collection row unchanged: GPay ₹150
- Net: collected 150, outstanding 240−150 = 90 (matches reality)

## Files
- `src/lib/paymentTransactions.ts` — recompute `due_amount` from frozen `paid_amount` when not syncing split
- One-time SQL update (two statements above)

## What stays the same
- Schema, audit trail, sync flag semantics
- Refund / bill_cancellation / due_collection logic untouched

