

# Lock Payment Mode Changes to Final Amount When Due is Zero

## Problem
In the Edit Registration dialog (Registered Patients), the payment section currently allows free editing of payment amounts. When a patient has zero due (`due_amount = 0`), users can:
1. Add extra payment modes and increase the total paid beyond the final amount — creating phantom overpayments
2. Redistribute amounts unevenly across modes without ensuring the total matches the bill

## Solution
When the original registration has zero due (`reg.due_amount === 0`), enforce that the total of all payment mode amounts must exactly equal the final amount (including visit charges). Block saving if the total doesn't match.

### Changes in `src/components/lims/EditRegistrationDialog.tsx`

1. **Detect zero-due mode**: Check `reg.due_amount === 0` (or `<= 0`) at the top of the payment section
2. **Lock total to final amount**: When zero-due, the sum of all mode amounts must exactly equal `reg.final_amount` (which already includes home visit charges)
3. **Prevent overpayment**: Cap each mode's input so the total across all modes cannot exceed the final amount
4. **Save button validation**: Disable the "Save Details" button if in zero-due mode and `editPaidAmount !== reg.final_amount`
5. **Visual feedback**: Show a warning message when totals don't match — e.g., "Total must equal ₹{final_amount} (no due adjustment allowed)"
6. **Prevent accepting more money**: When zero-due, `editDueAmount` is forced to 0 — the update will save `paid_amount = final_amount` and `due_amount = 0`, preventing any leakage

### Specific code changes

- Around line 116-117: Add a `isZeroDue` flag based on original registration
- Around line 309-312: Cap input amounts so total cannot exceed `reg.final_amount` when `isZeroDue`
- Around line 315-321: Show validation error when total doesn't match in zero-due mode
- Around line 326: Add disabled condition to Save button when amounts don't match
- Around line 121-151 (`handleSaveDetails`): When `isZeroDue`, force `paid_amount = final_amount` and `due_amount = 0` regardless

