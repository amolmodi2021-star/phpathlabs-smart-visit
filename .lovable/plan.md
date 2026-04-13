

# Due Payments & Bad Debts Tabs in LIMS

## Overview
Add two new tabs to the LIMS section: **Due Payments** (after Dispatch) and **Bad Debts** (after Due Payments), both before Completed Home Visits. These tabs manage outstanding patient balances with options to collect payments or write off as bad debt.

## Database Change

**Migration:** Add a `is_bad_debt` boolean column to `patient_registrations`:
```sql
ALTER TABLE patient_registrations ADD COLUMN is_bad_debt boolean NOT NULL DEFAULT false;
```

No new tables needed — we reuse the existing `patient_registrations` table, filtering by `due_amount > 0`.

## New Components

### 1. `src/components/lims/DuePayments.tsx`
- Query `patient_registrations` where `due_amount > 0 AND is_bad_debt = false AND bill_cancelled = false`, ordered by `created_at DESC`
- Table columns: Invoice #, Patient Name, Mobile, Doctor, Registration Date, Net Amount, Paid Amount, Due Amount, Actions
- **Collect Payment** button: Opens a dialog/inline form to add a payment entry (mode + amount). Updates `payments` JSONB array, recalculates `paid_amount` and `due_amount` on the registration row.
- **Mark as Bad Debt** button: Sets `is_bad_debt = true` on the registration, removing it from this list.
- Search bar for filtering by name/invoice/mobile.

### 2. `src/components/lims/BadDebts.tsx`
- Query `patient_registrations` where `is_bad_debt = true`, ordered by `created_at DESC`
- Same table columns as Due Payments plus the original due amount context.
- **Restore to Due** button: Sets `is_bad_debt = false`, moving the patient back to Due Payments tab.
- Search bar for filtering.

### 3. Collect Payment Dialog
- Simple dialog with payment mode selector (Cash/Card/UPI/Online) and amount input (pre-filled with due amount).
- On save: append to `payments` JSONB, update `paid_amount` and `due_amount`.
- Reuses existing payment mode patterns from the codebase.

## Changes to `src/pages/Lims.tsx`
- Add tab entries after "dispatch":
  ```
  { key: "due_payments", label: "Due Payments" }
  { key: "bad_debts", label: "Bad Debts" }
  ```
- Import and render both new components in their respective `TabsContent`.

## Technical Notes
- The `is_bad_debt` flag preserves the due amount data for audit purposes — no financial figures are modified when marking as bad debt.
- Payment collection follows the same JSONB `payments` array pattern already used in `EditRegistrationDialog` and `PaymentDetailsDialog`.
- Query invalidation on `lims-dispatch` and `lims-registrations` keys ensures Dispatch tab picks up payment changes immediately (patient no longer blocked if due is cleared).

