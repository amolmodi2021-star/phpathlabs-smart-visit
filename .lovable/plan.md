

# Fix: Delete Sample Tubes for Cancelled Tests

## Problem
When test CBC was cancelled for patient 2604150003, the `sample_tubes` row for that test still exists with `pending` status. The Sample Collection view queries `sample_tubes` directly and has no knowledge of `cancelled_tests`, so the cancelled test still appears for collection.

## Root Cause
The `processCancelTests` function in `EditRegistrationDialog.tsx` was recently updated to clean up `patient_results`, `outsourced_test_snips`, and `lims_test_orders` — but it does **not** clean up `sample_tubes`.

## Solution
Add one cleanup step in `processCancelTests` (in `EditRegistrationDialog.tsx`):

For each newly cancelled test ID, delete any `sample_tubes` rows where:
- `registration_id = reg.id`
- The `test_ids` array contains the cancelled test ID

Since `test_ids` is a JSONB array, we need to query all tubes for the registration and filter client-side (or use a contains filter), then delete matching rows.

Additionally, the `SampleCollection.tsx` component should add a safety filter: when grouping tubes by registration, exclude tubes whose `test_ids` are entirely within the registration's `cancelled_tests` array. This provides defense-in-depth for any tubes that weren't cleaned up.

### Changes

**1. `src/components/lims/EditRegistrationDialog.tsx` — in `processCancelTests`**
After the existing `outsourced_test_snips` deletion, add:
```typescript
// Delete sample_tubes for cancelled test
const { data: tubes } = await supabase
  .from("sample_tubes")
  .select("id, test_ids")
  .eq("registration_id", reg.id);
if (tubes) {
  const tubesToDelete = tubes.filter((t: any) =>
    (t.test_ids || []).includes(testId)
  );
  for (const tube of tubesToDelete) {
    await supabase.from("sample_tubes").delete().eq("id", tube.id);
  }
}
```

**2. `src/components/lims/SampleCollection.tsx` — defense-in-depth filter**
In `pendingGroups` and `collectedGroups` memos, filter out tubes whose every `test_id` is in the registration's `cancelled_tests` array.

### No database changes needed

