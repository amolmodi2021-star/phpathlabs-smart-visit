

# Clean Up Interface Orders, Results & Snips on Test Cancellation

## Problem
When a test is cancelled via the Edit Registration dialog (especially post-sample-collection with password), the system only updates `cancelled_tests` in `patient_registrations`. It does **not**:
1. Remove the cancelled test's parameters from `lims_test_orders` (interface orders)
2. Delete `patient_results` rows for the cancelled test
3. Delete `outsourced_test_snips` rows for the cancelled test

This means cancelled tests still appear in interface machine queries and leave orphan result/snip data.

## Solution
Extend the `processCancelTests` function in `EditRegistrationDialog.tsx` to perform cascading cleanup after updating `patient_registrations`.

### Changes in `src/components/lims/EditRegistrationDialog.tsx` — `processCancelTests` function

After the existing `patient_registrations` update (line ~265), add cleanup for each newly cancelled test:

1. **Delete `patient_results`** for each cancelled test:
   ```
   DELETE FROM patient_results WHERE registration_id = reg.id AND test_id = cancelledTestId
   ```

2. **Delete `outsourced_test_snips`** for each cancelled test:
   ```
   DELETE FROM outsourced_test_snips WHERE registration_id = reg.id AND test_id = cancelledTestId
   ```

3. **Clean up `lims_test_orders`** — interface orders use `sample_id` (invoice number ± tube suffix) and store tests as a JSONB array with `code` fields (param codes or test codes). For each cancelled test:
   - Fetch the test's parameter codes from `test_parameters` + `report_test_parameters` and the test code from `tests` table
   - Query all `lims_test_orders` where `sample_id LIKE '{invoice_number}%'` and status is `pending` or `in_progress`
   - For each matching order, filter out entries from the `tests` JSONB array whose `code` matches any cancelled param/test code
   - If the filtered array is empty, delete the order row entirely
   - If not empty, update the order with the filtered tests array

4. **Recalculate registration status** by calling `recalculateRegistrationStatus(reg.id)` to ensure the status reflects the removal (import from `src/lib/limsStatus.ts`)

### No other files need changes
The downstream modules (Sample Acceptance, Results Entry, Result Verification, Doctor Approval, Dispatch) already filter out cancelled test IDs via the `cancelled_tests` array. Deleting the `patient_results` and `outsourced_test_snips` rows ensures no orphan data appears in those views.

### No database schema changes needed

