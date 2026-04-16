

# Fix: Recalculate due_amount on Discount Change + Overpayment Refund

## Problem
1. When a discount is applied via Edit Registration, `due_amount` is not recalculated — causing Due Payments to show the old (higher) due, leading to overpayment.
2. If the new final amount is less than what was already paid, there's no way to process a refund for the overpayment.

## Changes — `src/components/lims/EditRegistrationDialog.tsx`

### 1. Recalculate `due_amount` when discount changes (line ~220-228)
In `handleSaveDetails`, inside the `if (discountChanged)` block, add:
```
updateData.due_amount = Math.max(0, discountCalc.finalAmount - lockedPaidAmount);
```
This ensures the Due Payments section always reflects the correct outstanding balance.

### 2. Detect overpayment and show refund UI
Add a computed value:
```
const discountOverpayment = discountChanged && discountCalc.finalAmount < lockedPaidAmount
  ? lockedPaidAmount - discountCalc.finalAmount : 0;
```

Add state for overpayment refund mode and a password dialog trigger.

### 3. Show overpayment refund block in the "Discount Changed" summary (line ~609-619)
When `discountOverpayment > 0`, replace the "New Due" line with:
- **"Overpaid: ₹X"** warning in orange/destructive
- Refund mode selector (Cash / NEFT)
- "Process Refund" button (password-protected)

### 4. Handle overpayment refund on save
When saving with an overpayment:
- Set `due_amount = 0`
- Set `paid_amount = discountCalc.finalAmount` (reduce to match new final)
- Set `refund_amount = existing refund + overpayment`
- Set `refund_mode` and `refund_date`

This will be integrated into `handleSaveDetails` so discount change + refund happen atomically in one save.

### 5. Disable Save if overpayment exists but no refund mode selected
The Save button remains enabled only when the overpayment refund flow is acknowledged (refund mode selected). Password confirmation required before processing.

### UI behavior
- **No overpayment**: Save works as before, just also updates `due_amount`
- **Overpayment detected**: Orange warning block appears with refund amount, mode selector, and password-protected save
- **Bill Summary**: Reflects the corrected due/refund values in real time

### Single file change
- `src/components/lims/EditRegistrationDialog.tsx`

