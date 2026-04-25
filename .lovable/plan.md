## Goal

When a Completed Home Visit is registered from LIMS (either via the quick "Save & Register" button or the "Edit & Register" dialog), the payment collected at that moment must be credited to the **logged-in LIMS user** (e.g. Aman) in the Daily Report — not to the phlebotomist who originally completed the visit (e.g. Rahul).

## Current State

- `logPaymentTransaction()` in `src/lib/paymentTransactions.ts` already stamps `performed_by` from `getCurrentUser()` — so the payment audit row IS technically attributed to the logged-in user.
- However, the `patient_registrations` insert in both Completed Home Visit flows is **missing the `registered_by` field**. Other registration flows (e.g. `PatientRegistration.tsx` line 397) do set this. This causes downstream confusion — invoices, dispatch, due-payments and reports that reference `registered_by` end up blank for these records, and any future per-user reporting on registrations breaks.
- Daily Report itself groups by `performed_by` on `payment_transactions`, so the cash/UPI totals already flow to the correct user once `getCurrentUser()` returns the logged-in session.

## Changes

### 1. `src/components/lims/CompletedHomeVisits.tsx` (Save & Register path)
In the `registerMutation` insert into `patient_registrations` (around line 143), add:
```ts
registered_by: getCurrentUser()?.display_name || getCurrentUser()?.username || null,
```
Import `getCurrentUser` from `@/lib/auth`.

### 2. `src/components/lims/EditAndRegisterHomeVisitDialog.tsx` (Edit & Register path)
In the `registerMutation` insert into `patient_registrations` (around line 296), add the same `registered_by` field. Import `getCurrentUser` from `@/lib/auth` (currently not imported).

### 3. Verification (no code change needed)
`logPaymentTransaction` is already invoked in both flows with the correct payments array and uses `getCurrentUser()` internally for `performed_by`. So Daily Report attribution will work automatically as soon as the user is logged in. We will keep the existing log call.

## Result

- The patient registration row stores `registered_by = Aman` (the LIMS user who clicked Save & Register).
- The `payment_transactions` audit row stores `performed_by = Aman`, so Daily Report's per-user grouping (Cash / GPay / Paytm / Card / NEFT) credits the payment to Aman.
- Rahul (the phlebotomist) remains linked only via `home_visits.phlebotomist_id` for phlebo-incentive / home-visit-charge calculations — unaffected.
