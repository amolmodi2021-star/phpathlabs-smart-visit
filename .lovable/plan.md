

# LIMS Patient Registration Module - Build Plan

## Overview
Build the first LIMS module — **Patient Registration** — as a tab inside a new `/lims` page. This establishes the foundation for all future LIMS modules (Sample Collection, Processing, Verification, etc.) to be added as additional tabs on the same page.

## Architecture Decisions

### Database Schema

**New tables:**

1. **`pickup_points`** — External labs/hospitals that refer samples
   - `id`, `name`, `phone`, `address`, `contact_person`, `billing_type` (credit/debit), `default_discount_pct`, `billing_cycle` (monthly/weekly), `status` (active/inactive), `created_at`, `updated_at`

2. **`pickup_point_prices`** — Custom test pricing per pickup point
   - `id`, `pickup_point_id` (FK → pickup_points), `test_id` (FK → tests), `custom_price`, `created_at`

3. **`patient_registrations`** — Core registration/invoice table
   - `id`, `invoice_number` (unique, format: YYMMDDSSSSS), `mobile_number`, `patient_name`, `title`, `gender`, `dob`, `email`, `address`, `doctor_name`, `umr_number`, `visit_type` (lab_visit / home_visit / pickup_point), `pickup_point_id` (nullable FK), `tests` (JSONB array of selected tests with prices/discounts), `gross_amount`, `discount_amount`, `net_amount`, `home_visit_charges`, `final_amount`, `payments` (JSONB array: [{mode, amount}]), `paid_amount`, `due_amount`, `global_discount_type`, `global_discount_value`, `status` (registered / sample_collected / processing / completed), `created_at`, `updated_at`

4. **`invoice_counter`** — Daily auto-increment for invoice numbers
   - `date_key` (text, PK, format: YYMMDD), `last_sequence` (integer, default 0)

**Modify existing table:**
- **`tests`** — Add `test_code` column (text, nullable for now) for future LIMS integration

**Database function:**
- `generate_invoice_number()` — Atomically increments the counter for today's date and returns formatted invoice number (e.g., 2604070001)

### Navigation
- Replace the existing "LIMS Interface" nav entry with **"LIMS"** pointing to `/lims`
- The `/lims` page uses a `<Tabs>` component; first two tabs: **New Registration** and **Registered Patients**
- Future modules (Sample Collection, Processing, etc.) become additional tabs
- The existing `/lims-demo` page remains accessible but is no longer in the primary nav

### Patient Search Logic
When the user types a mobile number, search across:
1. `patient_master` (by mobile_number)
2. `crm_contacts` (by mobile_number, prefer PH VESU records)
3. `estimates` (by whatsapp_number)

Show matching results as a dropdown. On selection, auto-fill: name, title, gender, DOB, UMR, email, address, doctor name. All fields remain editable. Edited demographics update `patient_master` on save.

## UI Structure

### Tab 1: New Registration

```text
┌─────────────────────────────────────────────┐
│  MOBILE NUMBER: [__________] 🔍             │
│  ┌── Dropdown: Existing patients ────┐      │
│  │  Mr. NARESH JAIN - UMR0012345     │      │
│  │  Mrs. PRIYA MODI - UMR0067890     │      │
│  └───────────────────────────────────┘      │
│                                             │
│  Title: [Select▾]   Gender: [Select▾]       │
│  Patient Name: [__________]                 │
│  DOB: [dd-mm-yyyy]   Age: (auto-calc)       │
│  Email: [__________]                        │
│  Doctor Name: [__________ ] (default: SELF) │
│  UMR: [__________]                          │
│                                             │
│  Visit Type: ○ Lab Visit  ○ Home Visit      │
│              ○ Pickup Point                 │
│  [If Pickup] → Select Pickup Point: [▾]     │
│  [If not Pickup] → Address: [__________]    │
│                                             │
│  ── Tests ──────────────────────────────    │
│  Search: [__________] (same as estimates)   │
│  | Test Name | MRP | Disc | Net |  ✕  |     │
│  (individual + global discount logic)       │
│                                             │
│  Home Visit Charges: [___]                  │
│  Gross: ₹X  Discount: ₹X  Net: ₹X          │
│                                             │
│  ── Payment ────────────────────────────    │
│  [If pickup=credit → skip payment]          │
│  ☑ Cash [₹___]  ☑ GPay [₹___]              │
│  ☐ Paytm  ☐ Credit Card  ☐ NEFT            │
│  Paid: ₹X   Due: ₹X                        │
│                                             │
│  [Save & Generate Invoice]                  │
│  → Shows invoice preview (image + print)    │
│  → WhatsApp share + Print buttons           │
└─────────────────────────────────────────────┘
```

### Tab 2: Registered Patients
- Paginated table of all registrations (reuse pagination pattern from CRM)
- Search by name, mobile, invoice number, UMR
- Columns: Invoice#, Date, Patient Name, Mobile, Tests, Amount, Status, Actions
- Actions: View invoice, Reprint, Resend WhatsApp

### Tab 3: Pickup Points (sub-section)
- CRUD for pickup points
- Per-pickup-point custom test pricing management
- View monthly billing summary

## Invoice Generation
- **Invoice Number**: Format `YYMMDDSSSSS` — auto-generated via DB function with atomic increment
- **Image version**: Branded JPEG (similar to home visit receipts) for WhatsApp sharing
- **Print version**: HTML-based A4/A5 layout rendered in a print dialog
- Invoice number doubles as the **Sample ID** for the Sample Collection module

## Technical Details

### Files to create
| File | Purpose |
|------|---------|
| `src/pages/Lims.tsx` | Main LIMS page with tab navigation |
| `src/components/lims/PatientRegistration.tsx` | New Registration form |
| `src/components/lims/RegisteredPatients.tsx` | Paginated list of registrations |
| `src/components/lims/PickupPointManager.tsx` | Pickup point CRUD + pricing |
| `src/components/lims/InvoicePreview.tsx` | Invoice image + print preview dialog |
| `src/lib/invoiceRenderer.ts` | Canvas-based invoice image generation |
| New migration | Create tables, functions, add test_code column |

### Files to modify
| File | Change |
|------|---------|
| `src/App.tsx` | Add `/lims` route, keep `/lims-demo` |
| `src/components/AppLayout.tsx` | Replace "LIMS Interface" nav with "LIMS" |
| `src/lib/tests.ts` | Update TestItem interface to include `test_code` |

### Database migration
- Create `pickup_points`, `pickup_point_prices`, `patient_registrations`, `invoice_counter` tables with permissive RLS
- Create `generate_invoice_number()` function (SECURITY DEFINER)
- Add `test_code` column to `tests` table
- Create paginated RPC for registered patients

### Key reusable patterns
- Test selection + discount logic: Reuse from `CreateEstimate.tsx`
- Multi-mode payment: Reuse from `PaymentDetailsDialog.tsx`
- Patient demographics (title/gender auto-link): Reuse from `EditHomeVisitDialog.tsx`
- Pagination: Reuse RPC pattern from CRM contacts

## Scope for this build
**Only the Patient Registration module** (3 sub-tabs: New Registration, Registered Patients, Pickup Points). Future modules will be added as additional tabs on the same `/lims` page.

