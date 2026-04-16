

# Restrict Payment Editing to Mode Change Only

## Problem
The Edit Registration Dialog currently allows modifying payment amounts, which should only happen via the Due Payments section. Users should only be able to **change how the already-paid amount is split across payment modes**, not add or reduce payments.

## Changes — `src/components/lims/EditRegistrationDialog.tsx`

### 1. Lock total to `paid_amount`
The payment section will enforce that the sum of all mode amounts always equals `reg.paid_amount`. No more, no less.

### 2. Single mode auto-fill
When only one payment mode is selected, automatically fill it with the full `paid_amount`. The amount field becomes read-only (single mode = no split needed).

### 3. Multi-mode validation
When multiple modes are selected, allow editing amounts per mode but show a real-time validation message if the total doesn't match `paid_amount`. Disable Save until it matches exactly.

### 4. Show read-only summary
Display "Amount Paid: ₹X" as a fixed label above the mode selector. Remove the due amount calculation logic from this section — dues are handled elsewhere.

### 5. Remove due amount display
Remove the `Due:` line and the zero-due mismatch warning. The dialog only manages mode redistribution, not payment collection.

### UI behavior summary
- **No payment received (paid = 0):** Payment mode section hidden entirely
- **Single mode selected:** Auto-fills with paid amount, read-only field
- **Multiple modes:** Editable fields, must sum to paid amount exactly
- **Save disabled** if mode amounts don't sum to paid amount

### File
- `src/components/lims/EditRegistrationDialog.tsx`

