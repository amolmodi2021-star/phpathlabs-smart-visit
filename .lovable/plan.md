

# Remove STAT Badge & Priority After Full Dispatch

## Problem
When all tests for a STAT patient are dispatched, the patient still shows the flashing red dot and STAT badge, and remains pinned to the top of the list.

## Solution
In `Dispatch.tsx`, conditionally hide the STAT indicator and exclude STAT sorting priority when `completionStatus === "all_done"` (all tests dispatched).

### Changes in `src/components/lims/Dispatch.tsx`

1. **Patient list item (flashing dot):** Change the condition from `reg.is_stat` to `reg.is_stat && entry.completionStatus !== "all_done"` — hides the blinking dot once fully dispatched.

2. **Detail header (STAT badge):** Same condition change for the `<Badge variant="destructive">STAT</Badge>` element.

3. **Sorting:** After computing `dispatchEntries`, re-sort them so that STAT patients with `completionStatus === "all_done"` lose their top-of-list priority. Sort logic:
   - First: `is_stat && completionStatus !== "all_done"` (active STAT stays on top)
   - Then: by `updated_at` descending (normal ordering)

This is a UI-only change — the `is_stat` flag in the database remains unchanged so the STAT status is preserved for historical records.

