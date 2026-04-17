

## Problem (invoice 2604170001 — confirmed in DB)

Current rows in `payment_transactions`:
1. **Registration row** (10:26): GPay ₹150, paid ₹150, due ₹90, remarks "Discount edited..."
2. **Due Collection row** (10:41): GPay ₹150, total ₹150

→ GPay total = ₹300, but real cash drawer = ₹150. Inflation.

**Root cause:** Patient was registered with **paid=0, due=300, payments=[]**. Later:
- DuePayments collected ₹150 GPay → wrote into `patient_registrations.payments` array → updated `paid_amount=150` → logged a delta `due_collection` row ✓
- Then EditRegistrationDialog was opened to edit discount. It loaded `reg.payments` (now containing the ₹150 GPay from due collection) and `syncRegistrationPaymentRow` overwrote the original Registration audit row with the CURRENT payment split → registration row now shows GPay ₹150 even though at registration time nothing was paid.

The Registration audit row must reflect **what was paid AT REGISTRATION TIME** — never updated by later collections.

## Fix

### A. `src/lib/paymentTransactions.ts` — `syncRegistrationPaymentRow`
Change semantics: when syncing the registration row for a discount/test-cancel edit, sync ONLY the **bill snapshot** (gross/discount/final) and the **due_amount**. Do NOT overwrite per-mode payment columns or `paid_amount` or `total_amount`. Those represent the original at-registration-time payment and must stay frozen.

Add a new optional flag `sync_payment_split?: boolean` (default `false`). It's only set to `true` when the user genuinely edits the original payment split in the dialog (mode swap correction, e.g. cash→GPay typo) — NOT when adding a new payment that is really a due collection.

### B. `src/components/lims/EditRegistrationDialog.tsx` — `handleSaveDetails`
The dialog currently treats ANY change to mode amounts as a "split edit". This is wrong because the dialog's payment editor is pre-populated from `reg.payments`, which already includes due-collection entries. Fix:

- Determine the **original-at-registration** payment split. The cleanest source: filter `reg.payments` to entries WITHOUT a `date` field (registration entries have no `date`; due-collection entries have `date: now` — see DuePayments line 105). That gives the original split.
- When deciding `splitChanged`, compare the dialog's edits against this **original split only** — not the full payments array.
- Pass `sync_payment_split: true` only when the user actually changed the original split.
- Always pass discount/gross/final via sync when `discountChanged` (bill snapshot updates correctly).

Also: when persisting `payments` to `patient_registrations`, preserve all due-collection entries (entries with `date`) and only replace the original-no-date entries with the edited split. Today the dialog overwrites the full array, which destroys due-collection history on the registration record.

### C. `src/components/lims/DuePayments.tsx`
No code change. Confirmed it already:
- Logs delta-only row ✓
- Does NOT touch the registration audit row ✓

The bug was entirely caused by the EditRegistrationDialog→sync path overwriting the audit row.

### D. One-time data fix for invoice 2604170001
Restore the registration audit row to its true at-registration state:
```sql
UPDATE payment_transactions
SET cash_amount=0, gpay_amount=0, paytm_amount=0, credit_card_amount=0, neft_amount=0,
    total_amount=0, paid_amount=0, due_amount=300
WHERE id='bfd9add0-f3c7-4477-950a-f27a509b7603';
```
Keeps gross=300, discount=60, final=240 (the corrected post-discount-edit bill snapshot) and the remark trail. Due collection row stays unchanged.

After fix: GPay total = ₹150 (only the due collection). Paid = ₹0 + ₹150 = ₹150. Due column on registration row = ₹300 (matches red badge convention). Net ✓.

## What stays the same
- Schema unchanged
- Audit trail intact — registration row shows original state + remark history of edits
- Delta-only behavior of due_collection / refund / bill_cancellation unchanged
- Bill snapshot (gross/discount/final) on registration row continues to update on discount edits — only the payment columns are frozen

## Files
- `src/lib/paymentTransactions.ts` — add `sync_payment_split` flag; conditionally include payment-mode columns + paid_amount + total_amount in update
- `src/components/lims/EditRegistrationDialog.tsx` — derive original split (entries without `date`); pass `sync_payment_split` only when original split truly changed; preserve due-collection entries when writing `payments` array
- One-time SQL UPDATE on the stray registration row

