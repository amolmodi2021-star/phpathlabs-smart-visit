

## Problem
Daily Payment Register relies on `payment_transactions`, but THREE registration paths fail to insert a row in certain cases:

1. **`PatientRegistration.tsx` line 497** — `if (paidAmount > 0)` skips logging when patient registers as 100% due. Invoice **2604170001** (₹300 final, ₹0 paid, ₹300 due) was created but never logged. Same will happen for any future "register now, collect later" patient.
2. **`CompletedHomeVisits.tsx` `handleRegister`** — never calls `logPaymentTransaction` at all, even when the home visit collected payment.
3. **`EditAndRegisterHomeVisitDialog.tsx`** — also never calls `logPaymentTransaction` after inserting into `patient_registrations`.

The Daily Report shows "Money In ₹0" rows correctly for due-only registrations once they are logged — totals stay accurate because gross/discount/final/paid/due are all snapshotted, and `total_amount=0` adds nothing to mode columns. So always logging is safe.

## Fix

### A. `PatientRegistration.tsx` (line 497)
Remove the `if (paidAmount > 0)` guard. Always log the registration row, with empty `payments` array if nothing collected. The row records the bill snapshot (gross/discount/final/paid=0/due=full) so the patient appears in Daily Report from day one. When the due is later collected via `DuePayments`, that adds a separate delta row on the collection day (already correct).

```ts
const payments = Array.from(selectedModes)
  .filter(m => (modeAmounts[m] || 0) > 0)
  .map(m => ({ mode: m, amount: modeAmounts[m] || 0 }));
logPaymentTransaction({
  registration_id: reg.id,
  invoice_number: reg.invoice_number,
  patient_name: reg.patient_name,
  transaction_type: "registration_payment",
  direction: "in",
  payments,                 // [] when nothing collected
  total_amount: paidAmount, // 0 when nothing collected
  gross_amount: calculations.totalAmount,
  discount_amount: calculations.totalDiscount,
  final_amount: calculations.finalAmount,
  paid_amount: paidAmount,
  due_amount: dueAmount,
});
```

### B. `CompletedHomeVisits.tsx` (`handleRegister`)
After inserting into `patient_registrations`, fetch the new row's `id` and call `logPaymentTransaction` with the same registration snapshot + parsed `payments` (already built locally). Always log — even when paid_amount is 0.

To get `reg.id`: change the insert to `.insert({...}).select().single()`.

### C. `EditAndRegisterHomeVisitDialog.tsx`
Mirror change B — capture inserted row, then log a `registration_payment` transaction. Always log.

### D. One-time data fix for invoice 2604170001
Insert the missing `payment_transactions` row matching the registration snapshot (paid_amount=0, due_amount=300, total_amount=0, gross/discount/final from registration, performed_by from `registered_by`).

## Files to edit
- `src/components/lims/PatientRegistration.tsx` — remove `paidAmount > 0` guard
- `src/components/lims/CompletedHomeVisits.tsx` — add `logPaymentTransaction` call + capture insert id
- `src/components/lims/EditAndRegisterHomeVisitDialog.tsx` — add `logPaymentTransaction` call + capture insert id
- One-time SQL `INSERT INTO payment_transactions` for invoice 2604170001

## Why this is safe
- Existing rows logged with `total_amount=0` contribute nothing to Cash/GPay/Net Collection cards or mode totals.
- They DO populate Gross/Discount/Final columns — exactly what Daily Report needs to show "this patient was billed today".
- Future due collection adds its own delta row; no double counting (already proven for invoice 2604150003 fix).

