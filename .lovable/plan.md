
## Problem
Daily Report reads from `payment_transactions`. When you edit payment mode split in `EditRegistrationDialog`, only `patient_registrations.payments` is updated — no row in `payment_transactions` is touched. So the original registration row (cash 1850) stays, and the report keeps showing stale numbers.

## Fix — `src/components/lims/EditRegistrationDialog.tsx` (`handleSaveDetails`)

After the successful `update`, detect whether the `payments` split changed vs the original `reg.payments`. If it did, **update the original `registration_payment` transaction row in-place** so the audit trail and Daily Report always reflect the latest split.

### Logic
1. Compare new `payments` array to `reg.payments` (compare per-mode totals using `splitPaymentModes`). If identical → skip.
2. If changed → call a new helper `updateRegistrationPaymentSplit(registration_id, invoice_number, payments)` that:
   - Finds the most recent `payment_transactions` row where `registration_id = X AND transaction_type = 'registration_payment'`.
   - Updates its `cash_amount / gpay_amount / paytm_amount / credit_card_amount / neft_amount` columns from the new split (via `splitPaymentModes`).
   - Appends remark like `"Payment mode edited on dd-MM-yyyy hh:mm AM/PM by <user>"`.
   - If no row found (legacy registration before audit table existed) → insert a fresh `registration_payment` row using current totals so the report stays correct.
3. Same change applied inside `processOverpaymentRefund` (it also rewrites the payments array).

### File: `src/lib/paymentTransactions.ts`
Add helper:
```ts
export async function updateRegistrationPaymentSplit(
  registration_id: string,
  invoice_number: string,
  patient_name: string,
  payments: Array<{mode:string;amount:number}>,
  paid_amount: number,
  final_amount: number,
  due_amount: number,
)
```
Implements the find-and-update / fallback-insert above. No throws.

### What stays the same
- `payment_transactions` schema — no migration.
- `Daily Report` UI — no change.
- Discount-change logging path — already inserts a separate `discount_applied` row.
- Due collection / refund flows — already log correctly.

### Why not insert a new "edit" row?
Because the original cash 1850 would still be summed alongside the corrected split, double-counting collections in Daily Report. We must mutate the original row to preserve true daily totals.

### Files
- `src/lib/paymentTransactions.ts` — add helper
- `src/components/lims/EditRegistrationDialog.tsx` — call helper inside `handleSaveDetails` and `processOverpaymentRefund` whenever the payment split differs from `reg.payments`
