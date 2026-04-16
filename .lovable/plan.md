
## Plan: Filter Test Orders by Machine ID Only

### Problem
GET handler currently returns ALL mapped tests regardless of which machine queried. Indiko would receive Sysmex tests, etc.

### Fix — `supabase/functions/lims-interface/index.ts` (GET handler)

**1. Re-introduce machine_id filtering on enriched tests:**

```ts
const enrichedTests = pendingTests
  .filter((t: any) => reverseCodeMap[t.code])
  .map((t: any) => ({
    code: reverseCodeMap[t.code],
    name: t.name,
    unit: t.unit || "",
    machine_id: t.machine_id || machineMap[t.code] || "",
  }));

// Filter by requesting machine_id (case-insensitive).
// Tests with no machine_id assigned are treated as universal.
const filteredTests = machineId
  ? enrichedTests.filter((t) =>
      !t.machine_id ||
      t.machine_id.toLowerCase() === machineId.toLowerCase()
    )
  : enrichedTests;
```

**2. Update empty-result message** to be machine-specific when machine_id was provided:
```ts
message: machineId ? `No pending tests for machine ${machineId}` : "No pending tests"
```

### Behaviour
- Query `{sample_id: "2604160004-F", machine_id: "Indiko"}` → returns only Indiko-assigned tests for that sample.
- Tests with no `machine_id` configured remain universal (returned to any querying machine).
- Mappings in `lims_code_mapping` continue to ignore machine_id (per previous fix).
- Duplicate sample IDs (e.g. `-F`, `-S`, `-P` tubes) are NOT addressed in this change.

### File
- `supabase/functions/lims-interface/index.ts` — GET handler only (2 small edits)

### No DB / schema / other file changes
