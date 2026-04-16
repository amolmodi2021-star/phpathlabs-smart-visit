

# Payment Transaction Audit Trail + Daily Report Module

## Overview
Create a `payment_transactions` audit table to log every money-in/money-out event with username and timestamp. Then build a "Daily Report" tab in LIMS for end-of-day account closing.

## Part 1: Database — New `payment_transactions` Table

**Migration:**
```sql
CREATE TABLE public.payment_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_id uuid NOT NULL,
  invoice_number text NOT NULL,
  patient_name text,
  transaction_type text NOT NULL, -- 'registration_payment', 'due_collection', 'discount_applied', 'refund'
  transaction_date timestamptz NOT NULL DEFAULT now(),
  performed_by text, -- username/display_name
  cash_amount numeric DEFAULT 0,
  gpay_amount numeric DEFAULT 0,
  paytm_amount numeric DEFAULT 0,
  credit_card_amount numeric DEFAULT 0,
  neft_amount numeric DEFAULT 0,
  total_amount numeric DEFAULT 0,
  direction text NOT NULL DEFAULT 'in', -- 'in' or 'out'
  gross_amount numeric DEFAULT 0,
  discount_amount numeric DEFAULT 0,
  final_amount numeric DEFAULT 0,
  paid_amount numeric DEFAULT 0,
  due_amount numeric DEFAULT 0,
  refund_amount numeric DEFAULT 0,
  remarks text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.payment_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on payment_transactions" ON public.payment_transactions FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX idx_pt_date ON public.payment_transactions (transaction_date);
CREATE INDEX idx_pt_invoice ON public.payment_transactions (invoice_number);
CREATE INDEX idx_pt_reg ON public.payment_transactions (registration_id);
```

## Part 2: Log Transactions from All Payment Points

### 2a. `PatientRegistration.tsx` — After successful insert
Log a `registration_payment` transaction with the username, payment mode amounts, and bill details.

### 2b. `DuePayments.tsx` — After successful due collection
Log a `due_collection` transaction with the collecting user and mode-wise amounts.

### 2c. `EditRegistrationDialog.tsx` — After discount change (due recalculation)
Log a `discount_applied` transaction recording the discount amount change and new due.

### 2d. `EditRegistrationDialog.tsx` — After refund processed
Log a `refund` transaction (direction: 'out') with refund amount and mode.

Each log entry will include:
- `performed_by`: from `getCurrentUser()?.display_name`
- `transaction_date`: current timestamp (stored as ISO, displayed as dd-MM-yyyy hh:mm AM/PM)
- Mode-wise breakdown columns (cash, gpay, paytm, credit_card, neft)

## Part 3: Daily Report Component — `src/components/lims/DailyReport.tsx`

### Default view (all users): Current date only
- Table with columns: Invoice #, Date/Time (dd-MM-yyyy hh:mm AM/PM), Username, Transaction Type, Patient Name, Gross Amount, Discount, Final Amount, Total Paid, Total Due, Cash, GPay, Paytm, NEFT, Credit Card, Refund Amount, Remarks
- Sorted by invoice number ascending
- Summary row at bottom with column totals
- Net collection summary: Total In - Total Out

### Admin-only features (password-protected):
- **Date range picker** — From/To date filter for historical reports
- **User-wise filter** — Dropdown to filter by performing user
- **Payment mode filter** — Filter by specific mode
- **Consolidated summary** — Totals grouped by payment mode
- **Export to Excel** button

## Part 4: Add Tab to LIMS

In `src/pages/Lims.tsx`:
- Add `{ key: "daily_report", label: "Daily Report" }` to `allLimsTabs`
- Import and render `DailyReport` component

## Files to create
- `src/components/lims/DailyReport.tsx`

## Files to modify
- `src/components/lims/PatientRegistration.tsx` — insert transaction after save
- `src/components/lims/DuePayments.tsx` — insert transaction after collection
- `src/components/lims/EditRegistrationDialog.tsx` — insert transaction after discount/refund
- `src/pages/Lims.tsx` — add Daily Report tab

## Technical Notes
- All transaction inserts are fire-and-forget (non-blocking) — registration flow must not fail if logging fails
- The helper function to split payment array into mode columns will be shared: `{ cash: X, gpay: Y, ... }`
- Admin detection uses existing password gate pattern (`9819111107`)
- Date display uses `format(date, "dd-MM-yyyy hh:mm a")` per project standards

