

# Fix: Sync Sample Tube Type from Test Management to Existing Registrations

## Problem
When a test's `sample_tube` type is updated in Test Management after a patient has already been registered, the `sample_tubes` records retain the old tube type value. The tube type is only captured at registration time and never refreshed.

## Solution
In the **SampleCollection** component, after fetching the sample tubes, cross-reference each tube's test IDs against the current test definitions to get the latest `sample_tube`, `tube_color`, and `sample_type` values. If they differ from what's stored, update the `sample_tubes` record in the database.

### Changes

#### `src/components/lims/SampleCollection.tsx`
1. After fetching `allTubes`, extract all unique test IDs from every tube's `test_ids` array.
2. Fetch the current `sample_tube`, `tube_color`, `sample_type` from the `tests` table for those test IDs.
3. For each tube, check if the stored `tube_type` matches the current test definition. If any tube has a stale value, issue an update to the `sample_tubes` table with the latest values and invalidate the query so the UI refreshes.
4. This sync runs as a `useEffect` after tubes are loaded — it's a one-time reconciliation that only fires when mismatches are detected.

### Technical Detail
```text
SampleCollection loads tubes
  → Extract all test_ids from tubes
  → Fetch latest sample_tube from tests table
  → Compare tube.tube_type vs tests[tube.test_ids[0]].sample_tube
  → If mismatch → update sample_tubes row → invalidate query
```

This ensures that even old registrations reflect the current tube configuration without requiring re-registration.

