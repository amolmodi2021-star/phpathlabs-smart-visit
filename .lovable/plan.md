

## Goal
1. **Tweak the New Registration form** so the Pickup Point dropdown sits next to the Mobile Number field, only the dropdown shows when Pickup Point visit type is chosen, and **no UMR is generated** for pickup-point registrations.
2. **Add a new "Billing" section** under LIMS to generate consolidated B2B (PUP) invoices for all credit pickup points over a date range, with PDF download, payment recording, reminder dashboard, and per-invoice ledger.

---

## Part 1 — Registration UI tweak + skip UMR for pickup

### a. Layout change (`PatientRegistration.tsx`)
- Wrap the **Mobile Number** field and a new **Pickup Point dropdown** in a 2-col grid: Mobile (col 1), Pickup Point (col 2).
- The Pickup Point dropdown is **always visible** (so the user can select it before/instead of changing visit type). Selecting a pickup point automatically:
  - sets `visitType = "pickup_point"`
  - clears `channelId`
- Move the existing standalone "Select Pickup Point" block out (now redundant — the top-row dropdown replaces it).
- Keep the "Visit Type" radio group as is; if user switches away from `pickup_point`, clear `pickupPointId`.

### b. Skip UMR for pickup point
- In `saveMutation`: if `visitType === "pickup_point"`, set `finalUmr = null` (skip the `generate_umr_number` RPC entirely). Don't write to `patient_master` and don't run the cross-registration demographic sync (both are UMR-keyed).
- Existing `umr_number` column already accepts null — no schema change.

---

## Part 2 — New "Billing" section under LIMS

### a. Database (migration)
Three new tables:

```sql
CREATE TABLE pickup_point_invoices (
  id uuid PK,
  invoice_number text UNIQUE,           -- PUP0426001 (auto via trigger)
  pickup_point_id uuid REFERENCES pickup_points(id),
  invoice_month int, invoice_year int,  -- 04, 26
  period_from date, period_to date,
  patient_count int, total_amount numeric,
  paid_amount numeric DEFAULT 0,
  due_amount numeric,
  status text DEFAULT 'pending',        -- pending | partial | paid
  no_reminder boolean DEFAULT false,
  reminder_days int,                    -- override; null = use global
  last_reminder_sent_at timestamptz,
  notes text,
  created_at, updated_at
);

CREATE TABLE pickup_point_invoice_items (
  id uuid PK,
  invoice_id uuid REFERENCES pickup_point_invoices ON DELETE CASCADE,
  registration_id uuid,                 -- soft ref to patient_registrations
  registration_invoice text,            -- the YYMMDDXXXX patient invoice
  registration_date date,
  patient_name text,
  test_names text,                      -- comma-separated for display
  net_amount numeric,
  display_order int
);

CREATE TABLE pickup_point_invoice_payments (
  id uuid PK,
  invoice_id uuid REFERENCES pickup_point_invoices ON DELETE CASCADE,
  payment_date date,
  amount numeric,
  payment_mode text,                    -- Cash/GPay/Paytm/Credit Card/NEFT/Cheque
  reference_no text,
  remarks text,
  recorded_by text,
  created_at
);

-- Auto-assign PUP{MM}{YY}{NNN} on insert (per month+year scope, 3-digit)
CREATE FUNCTION auto_assign_pickup_invoice_number() ...;
CREATE TRIGGER trg_pickup_invoice_no BEFORE INSERT ON pickup_point_invoices ...;
```
RLS open like sibling tables.

App settings keys for bank details (editable, persisted in `app_settings`):
`bank_account_name`, `bank_account_number`, `bank_name`, `bank_branch`, `bank_ifsc`, `bank_micr`, `bank_pan`, `pickup_invoice_default_reminder_days` (default 15).

### b. New helper `src/lib/pickupBilling.ts`
- `getCreditPickupPoints()` — pickup_points where billing_type='credit' and status='active'.
- `getEligibleRegistrations(pickupPointId, fromDate, toDate)` — patient_registrations rows where `pickup_point_id = X`, `created_at` in range, NOT already invoiced (LEFT JOIN `pickup_point_invoice_items.registration_id`).
- `generateInvoices({ pickupPointIds[], fromDate, toDate })` — for each pickup point with eligible regs, create one `pickup_point_invoices` row + items rows in a transaction.
- `recordPayment(invoiceId, payment)`, `togglePaymentMode(...)`, `setNoReminder(...)`, `sendReminderMessage(invoiceId)` — uses message template + WhatsApp proxy.
- `getInvoiceLedger(pickupPointId)` — chronological list of all invoices + payments for a pickup point with running balance.

### c. New UI components
**`src/components/lims/Billing.tsx`** — top-level tab with sub-tabs:
1. **Generate Invoices**
   - Date range picker (default: previous month 1st → last day of previous month)
   - Multi-select list of credit pickup points (default: all selected)
   - "Generate All Invoices" button → creates one `PUP{MM}{YY}{NNN}` invoice per pickup point with its eligible registrations
   - Preview table per pickup point: Patient invoice no, Patient name, Tests, Net amount
2. **Invoices Dashboard**
   - Table: Invoice No, Pickup Point, Period, Patients, Total, Paid, Due, Status, Reminder badge, Actions
   - Filters: status, pickup point, date range
   - Row actions: View PDF, Download PDF, Record Payment, Toggle "No Reminder", Send Reminder, View Ledger
   - Highlight rows where `due_amount > 0` and `last_reminder_sent_at` older than `reminder_days` and `no_reminder = false` → "Reminder Due" chip
3. **Bank & Reminder Settings**
   - Editable bank account fields (saved to `app_settings`)
   - Default reminder days input

**`src/components/lims/PickupInvoicePDF.tsx`** — A4 PDF render via `html-to-image` + `jsPDF` (same engine used by LIMS reports). Layout (modeled on the reference invoice but cleaner/professional):
- **Header**: Logo (from `invoice_logo_url` in app_settings) on the left, **"INVOICE"** in bold on the right (replaces tagline), lab name + address from invoice designer settings.
- **Invoice meta box** (right side): Invoice No, Invoice Date, Period From, Period To.
- **Bill To box** (left side): Pickup point name, address, contact person, phone.
- **Bank details block** (below header): from app_settings.
- **Line-items table**: No. | Reg. Date | Invoice No (the patient YYMMDDXXXX) | Patient Name | Tests | Net Amount.
- **Totals**: Patient count, Grand Total + Amount in Words.
- **Footer**: "Please pay within X days", contact person for billing queries, declaration line (copy reference invoice's GST exemption phrasing as a configurable note in app_settings).
- **Last page — Ledger Report** for that pickup point: Date | Voucher Type (Sales/Receipt) | Voucher No | Net | Credit | Debit | Closing Balance.

PDF filename: `{PICKUP_POINT_NAME}_{INVOICE_NUMBER}.pdf`.

**`src/components/lims/PickupPaymentDialog.tsx`** — record payment with mode (Cash/GPay/Paytm/Credit Card/NEFT/Cheque), amount, reference, remarks, date.

**`src/components/lims/PickupLedgerDialog.tsx`** — full ledger view (also embedded as last page of PDF).

### d. Wire into LIMS tabs
In `src/pages/Lims.tsx`:
- Add `{ key: "billing", label: "Billing" }` to `allLimsTabs` (between `bad_debts` and `daily_report`).
- Add `<TabsContent value="billing"><Billing /></TabsContent>`.

### e. Reminder messaging
- Reuse existing WhatsApp proxy + `message_send_log`. New `message_templates` key: `pickup_invoice_reminder` with placeholders `{pickup_name}`, `{invoice_no}`, `{amount}`, `{period}`, `{days_overdue}`.
- Sending logs to `message_send_log` with `message_type='pickup_invoice_reminder'` and updates `last_reminder_sent_at`.

---

## Files

### Edit
- `src/components/lims/PatientRegistration.tsx` — top-row Mobile + Pickup grid; skip UMR/master/sync for pickup point.
- `src/pages/Lims.tsx` — add Billing tab.

### New
- `supabase/migrations/<ts>_pickup_billing.sql` — 3 tables, sequence-by-month trigger, app_settings seeds.
- `src/lib/pickupBilling.ts` — query/mutation helpers.
- `src/components/lims/Billing.tsx` — main container with sub-tabs.
- `src/components/lims/BillingGenerate.tsx` — generate-invoices sub-tab.
- `src/components/lims/BillingDashboard.tsx` — invoices list + reminders.
- `src/components/lims/BillingSettings.tsx` — bank details + reminder days.
- `src/components/lims/PickupInvoicePDF.tsx` — PDF renderer.
- `src/components/lims/PickupPaymentDialog.tsx` — record payment.
- `src/components/lims/PickupLedgerDialog.tsx` — per-pickup ledger.

## Out of scope (ask if needed)
- TDS / GST tax columns on the invoice.
- Editing/voiding a generated invoice (will only support delete-and-regenerate).
- Email delivery of PDF (only WhatsApp + manual download).
- Aging buckets (30/60/90) — only "Reminder Due" badge for v1.
- Auto-cron for reminders — manual "Send Reminder" button only.

