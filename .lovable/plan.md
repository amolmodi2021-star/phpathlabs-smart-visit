

## Problem (invoice 2604170001)
Three rows appear in Daily Report for one patient:
1. **Registration** (10:26 AM) — already correctly synced with post-edit values
2. **Due Collection** (10:41 AM) — correct delta-only row, GPay ₹150
3. **Discount Applied** (10:42 AM) — duplicates the registration snapshot (gross 300, disc 60, final 240, paid 150, due 90) → inflates Daily Report totals AND looks like a "second collection" to the user

The discount edit ALREADY updates the registration row in-place via `syncRegistrationPaymentRow` (lines 264–278 of `EditRegistrationDialog.tsx`). The separate `discount_applied` audit row (lines 281–296) is redundant — it's pure duplication.

## Fix

### A. Remove the separate `discount_applied` audit insert
File: `src/components/lims/EditRegistrationDialog.tsx`, lines 280–296.

Delete the entire `if (discountChanged) { logPaymentTransaction({...}) }` block. The discount change is already captured by `syncRegistrationPaymentRow` which:
- Updates the existing registration_payment row's gross/discount/final/paid/due in place
- Appends a remark line: "Discount edited on {date} by {user}" (visible in Daily Report's Remarks column)

Result: only ONE row per registration, always reflecting current state. No duplication, no inflated totals.

### B. (Optional) Drop the `discount_applied` transaction_type entirely
Since no other call site emits it, we can leave the type in the union for backwards-compat with existing rows, but no new ones will be created.

### C. One-time data fix
Delete the existing stray `discount_applied` row for invoice 2604170001 (id `75212236-cc35-4d58-b5c0-96cb80db6f71`) so today's report immediately reflects the clean state. Also delete any other historical `discount_applied` rows project-wide (their info is already preserved in the corresponding `registration_payment` row's remarks via the sync flow).

```sql
DELETE FROM payment_transactions WHERE transaction_type = 'discount_applied';
```

## Verification
After fix, invoice 2604170001 will show exactly 2 rows in Daily Report:
- **Registration** — Gross ₹300, Disc ₹60, Final ₹240, Paid ₹150, Due ₹90, GPay ₹150, Remarks: "Discount edited on 17/04/2026, 10:42 am by Unknown"
- **Due Collection** — snapshots all ₹0, GPay ₹150 (the delta)

Grand totals naturally correct: Gross ₹300, Final ₹240, Paid ₹150, Due ₹90, GPay ₹300 (real cash drawer = registration ₹150 + collection ₹150).

## Files
- `src/components/lims/EditRegistrationDialog.tsx` — remove redundant `logPaymentTransaction` call (lines 280–296)
- One-time SQL: `DELETE FROM payment_transactions WHERE transaction_type = 'discount_applied'`

## What stays the same
- `syncRegistrationPaymentRow` continues to handle ALL edits (split/discount/test-cancel) by updating the original row in place with appended remarks
- Refund / bill_cancellation / due_collection logic unchanged
- Schema unchanged

