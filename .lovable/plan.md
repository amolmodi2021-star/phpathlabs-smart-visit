

# Regenerate Invoice After Due Payment Collection

## Problem
After collecting a due payment, the invoice is not shown/regenerated. The user needs to see an updated invoice reflecting the new payment with its date/time, while preserving all original data. If due remains, the patient stays in Due Payments.

## Solution

### Changes in `src/components/lims/DuePayments.tsx`

1. **Import `InvoicePreview`** component and add state for showing it.

2. **Fetch additional fields** needed by `InvoicePreview`: Add `title, gender, dob, email, address, umr_number, visit_type, tests, gross_amount, discount_amount, home_visit_charges, final_amount, refund_amount, refund_mode, refund_date, cancelled_tests` to the select query.

3. **After successful payment collection**, instead of just closing the dialog, update the `selected` object with the new payment data (new payments array, new paid_amount, new due_amount) and open the invoice preview dialog.

4. **Add `InvoicePreview` component** at the bottom of the JSX, passing the updated registration data and controlling its open/close state.

The `InvoicePreview` already dynamically renders all payments with their modes/amounts, shows the current due, and handles print/WhatsApp sharing. The new payment entry already includes `{ mode, amount, date }` so it will display with the correct date/time. No changes needed to `InvoicePreview.tsx`.

### Behavior
- Collect payment → DB updated → invoice preview opens with refreshed data
- If due remains > 0, patient stays in Due Payments list (already works this way)
- Invoice shows all payment entries including the newly collected one with timestamp

