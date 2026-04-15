

# Add Home Visit Charge Refund in Edit Registration

## Problem
There is no way to refund home visit charges from the Edit Registration dialog. The user wants the same password-gated logic used for test cancellations: if the registration is past sample accepted, require a password to unlock, then allow refunding the home visit charges.

## Solution
Add a "Refund Home Visit Charges" section in the Edit Registration dialog, visible only when `home_visit_charges > 0` and charges haven't already been refunded. Uses the same `isRefundBlocked` / `refundUnlocked` gate.

### Changes in `src/components/lims/EditRegistrationDialog.tsx`

1. **New state**: `homeVisitRefundRequested` (boolean) to track if user wants to refund HVC.

2. **Refund calculation update**: Extend `refundCalc` to include home visit charges when `homeVisitRefundRequested` is true.

3. **UI section**: After the test cancellation area (around line 620), add a section:
   - Show only when `reg.home_visit_charges > 0` and not already refunded (track via a flag, e.g. check if `reg.home_visit_charges_refunded` or simply check if previous refund included HVC)
   - A checkbox/button "Refund Home Visit Charges (₹X)" — gated behind `isRefundBlocked` just like test cancellation
   - When checked, adds the HVC amount to the refund total

4. **Process refund update**: In `processCancelTests`, when `homeVisitRefundRequested`:
   - Add HVC to `totalRefund`
   - Set `home_visit_charges: 0` in the update
   - Recalculate `newFinalAmount` accordingly (subtract HVC)

5. **Allow standalone HVC refund**: The "Process Refund" button should also appear when `homeVisitRefundRequested` is true even if no tests are newly cancelled. Adjust the condition from `newlyCancelled.length > 0` to `newlyCancelled.length > 0 || homeVisitRefundRequested`.

6. **Discount calc update**: The `discountCalc` memo uses `reg.home_visit_charges` for `hvc`. After HVC refund, since we set `home_visit_charges: 0`, subsequent edits will correctly show 0.

### No database schema changes needed
The existing `home_visit_charges` column on `patient_registrations` will simply be set to 0 upon refund, and the refund amount added to `refund_amount`.

