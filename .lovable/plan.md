

# Add Post-Registration Discount Editing in Edit Registration Dialog

## Problem
Currently, the Edit Registration dialog shows tests with their prices but provides no way to apply or modify discounts after a patient has been registered.

## Solution
Add individual test discount controls (same as in Patient Registration) and a global discount option to the Edit Registration dialog. If the patient's status is past sample acceptance, require password `9819111107` before allowing discount changes.

### Changes in `src/components/lims/EditRegistrationDialog.tsx`

1. **New state variables**:
   - `editTests` — local copy of the tests array with editable `individual_discount_type`, `individual_discount_value`, and `discount_applicable` per test
   - `globalDiscountType` / `globalDiscountValue` — for global discount
   - `showDiscountUnlockPwd` / `discountUnlocked` — password gate for post-accepted stages

2. **Initialize on dialog open** (in existing `useEffect`):
   - Populate `editTests` from `reg.tests`, preserving any existing discount data
   - Populate global discount from `reg.global_discount_type` / `reg.global_discount_value`
   - Reset `discountUnlocked` to `false`

3. **Discount controls in the Tests section**:
   - For each active (non-cancelled) test with `discount_applicable`, show a discount type selector (`%` / `₹`) and value input — same UI pattern as `PatientRegistration.tsx`
   - Show global discount inputs (type + value) below the test list
   - If `isPastAccepted && !discountUnlocked`, show a locked message with "Unlock Discount" button → triggers `DeletePasswordDialog`

4. **Recalculate amounts** (via `useMemo`):
   - Compute `newGrossAmount`, `newDiscountAmount`, `newFinalAmount` from `editTests` + global discount, mirroring the `PatientRegistration` calculation logic
   - Show updated bill summary with the new values

5. **Update `handleSaveDetails`**:
   - Save the updated `tests` array (with new `discounted_price` per test)
   - Save `gross_amount`, `discount_amount`, `final_amount`, `global_discount_type`, `global_discount_value`
   - Recalculate `due_amount` based on new final amount minus paid amount
   - Preserve the zero-due logic: if original due was 0 and discount reduces the final amount, the difference becomes a refund-eligible amount (or adjust paid accordingly)

6. **Add another `DeletePasswordDialog`** instance for discount unlock (separate from refund unlock)

### Security
- Before sample acceptance: discounts are freely editable
- After sample acceptance: discount section is locked, requires password `9819111107` to unlock per session

### No database schema changes needed — all discount data is stored in the existing `tests` JSONB array and existing columns (`gross_amount`, `discount_amount`, `final_amount`, `global_discount_type`, `global_discount_value`).

