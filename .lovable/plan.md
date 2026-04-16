
## Plan: Ignore machine_id Entirely in Code Mapping Lookup

### Problem
Currently the GET handler filters `lims_code_mapping` rows by `machine_id` when the analyzer query includes one. This causes mappings saved without a machine_id (or with a different casing) to be skipped → tests dropped → "No tests for machine X".

### Fix — `supabase/functions/lims-interface/index.ts`

**1. Mapping lookup (around lines 102-110)** — remove the `machine_id` filter entirely. Always look up mappings purely by `mapped_param_code` / `mapped_test_code`:

```ts
const { data: codeMappings } = await supabase
  .from("lims_code_mapping")
  .select("machine_code, mapped_param_code, mapped_test_code")
  .or(`mapped_param_code.in.(${testCodes.join(",")}),mapped_test_code.in.(${testCodes.join(",")})`);
```
(No `if (machineId) mappingQuery = mappingQuery.eq(...)` block.)

**2. Test list filter (around lines 132-135)** — remove the `machine_id` filter on enriched tests too. All mapped tests are returned regardless of `machine_id`:

```ts
const filteredTests = enrichedTests; // no machine_id filtering
```

**3. Empty-result message** — drop the "No tests for machine X" branch since machine_id no longer filters anything. The existing "No pending tests" / "All tests already completed" messages still cover the empty case.

### Result
- Query `{ sample_id: "2604160004-F", machine_id: "Indiko" }` → returns all mapped tests for that sample, regardless of which machine_id was saved on the mapping row.
- `machine_id` from the analyzer is still logged in `lims_interface_logs` for audit, but no longer affects which tests get returned.
- POST (results submission) flow is unchanged — incoming `machine_code` is still mapped back to the internal param via `lims_code_mapping`, ignoring `machine_id`.

### File
- `supabase/functions/lims-interface/index.ts` — GET handler only

### No DB / schema / other file changes
