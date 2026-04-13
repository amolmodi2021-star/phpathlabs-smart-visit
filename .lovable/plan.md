

# Multi-Mode Payment Collection & Invoice Date/Time

## Problem
1. Due payment collection only allows a single payment mode — should match registration form (multiple modes with per-mode amounts, capped at due amount).
2. Invoice doesn't show payment date/time alongside each payment entry.

## Changes

### 1. `src/components/lims/DuePayments.tsx` — Multi-mode payment UI

Replace single `payMode`/`payAmount` state with multi-mode pattern from `PatientRegistration.tsx`:

- **State**: Replace `payMode`/`payAmount` with `selectedModes: Set<string>` and `modeAmounts: Record<string, number>`
- **Payment modes**: Use same `PAYMENT_MODES` list with checkbox selection (grid layout)
- **Amount inputs**: For each selected mode, show an amount input. Cap each input so total across all modes cannot exceed `selected.due_amount`
- **Collect handler**: Create one payment entry per selected mode (each with `{ mode, amount, date }`) and append all to the existing payments array. Update `paid_amount` and `due_amount` accordingly.
- **Validation**: Total paid must be > 0 and ≤ due amount.

### 2. `src/components/lims/InvoicePreview.tsx` — Show payment date/time

Update the payments rendering section (lines 154-157) to display the `date` field from each payment entry:

```
{p.mode}: ₹{p.amount}  →  {p.mode} (dd/MM/yyyy HH:mm): ₹{p.amount}
```

Only show date if `p.date` exists (old payments before this change may not have it).

### 3. Update `PAYMENT_MODES` in DuePayments

Change from `["Cash", "GPay", "Paytm", "Credit Card", "UPI", "Online"]` to match registration: `["Cash", "GPay", "Paytm", "Credit Card", "NEFT"]`.

