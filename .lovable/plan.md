

## Goal
In the LIMS interface `query` response, exclude any test/parameter whose `machine_id` is null/empty so the machine never sees entries like `"machine_id": ""`.

## Current behavior
`supabase/functions/lims-interface/index.ts` (lines 324–340) builds `enrichedTests` with `machine_id: t.machine_id || machineMap[t.code] || ""` and only filters out by requesting machine when `machineId` query param is provided. When the requesting machine doesn't pass `machine_id`, parameters with no assigned machine slip through with empty string.

## Fix — single file
**`supabase/functions/lims-interface/index.ts`** (~5 line change in the enrichment block):

1. Compute `resolvedMachineId = t.machine_id || machineMap[t.code] || ""` for each test.
2. **Skip the test entirely if `resolvedMachineId` is empty** (in addition to the existing skip when `reverseCodeMap[t.code]` is missing).
3. Keep the existing requesting-machine filter as-is — but since we now guarantee every returned test has a non-empty `machine_id`, the "treat empty as universal" branch becomes dead code (harmless, leave it).

Net effect on the example:
- `HbA1c` with `machine_id: ""` → **dropped**.
- `PROTEINS` / `Albumin` with `machine_id: "Indiko"` → returned unchanged.

## Out of scope
- No DB changes.
- No changes to results-submission (POST) path.
- No changes to reprocess action.
- No client-side LIMS UI changes.

## Files
- `supabase/functions/lims-interface/index.ts` — tighten `enrichedTests` filter (~5 lines).

