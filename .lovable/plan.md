

# Fix: Auto-resolve unmapped results when mapping already exists

## Problem
When a machine code (e.g., RBC) is mapped via the Code Mapping tab, only the single unmapped result row that triggered the mapping gets resolved. Other unmapped results with the same machine code remain visible in the "Unmapped Results" section. Additionally, their result values are never transferred to `lims_test_results` for the respective sample.

## Solution — Two changes

### 1. Edge Function: Already correct
The edge function POST handler already checks `lims_code_mapping` before routing results. The existing unmapped rows are from results submitted *before* the mapping was created. No edge function changes needed.

### 2. UI: When mapping an unmapped result, also auto-resolve all other unmapped results with the same machine_code

**File:** `src/pages/LimsDemo.tsx`

In the `mapResult` mutation (around line 190-214), after inserting the code mapping and resolving the clicked row:
- Query `lims_unmapped_results` for all other rows with the same `machine_code` and `is_resolved = false`
- For each, insert a corresponding row into `lims_test_results` using the newly created mapping's `paramCode` and `parameter_name`
- Mark all those rows as `is_resolved = true`

This ensures that when you map RBC → PRM0113, all existing unmapped RBC results across all samples are automatically resolved and their values transferred to the results entry system.

### 3. UI: Filter unmapped results that already have a mapping

As a visual safety net, also filter the unmapped results query or display to exclude rows whose `machine_code` already exists in `lims_code_mapping`. This handles the edge case where the auto-resolve hasn't run yet.

### Single file change
- `src/pages/LimsDemo.tsx` — modify `mapResult` mutation to batch-resolve siblings, and filter display

