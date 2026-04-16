
## Plan: Allow Duplicate Machine Codes Mapped to Multiple Parameters

### Why
User wants one machine code (e.g. `GLU`) to map to multiple internal parameter codes (e.g. `PRM0025` Fasting + `PRM0026` Random). Currently this is likely blocked by a unique constraint on `lims_code_mapping.machine_code`, and the GET/POST handlers assume 1:1 lookup.

### Investigation needed (before final plan)
Quick reads to confirm:
1. Check `lims_code_mapping` schema/constraints for any UNIQUE on `machine_code`.
2. Confirm the GET reverse-mapping logic (`reverseCodeMap[t.code] = m.machine_code`) — already 1-to-many friendly (internal → machine), so GET is fine.
3. Confirm POST forward-mapping logic (`codeMap[m.machine_code] = {...}`) — currently overwrites; needs to expand to array.

### Changes

**1. DB migration — drop uniqueness on `machine_code` (if present)**
- Remove any UNIQUE constraint/index on `lims_code_mapping.machine_code` alone.
- Add a composite UNIQUE on `(machine_code, mapped_param_code, mapped_test_code)` to still prevent exact duplicate rows.

**2. Edge function `supabase/functions/lims-interface/index.ts` — POST handler**

Change `codeMap` from `code → single mapping` to `code → array of mappings`:
```ts
let codeMap: Record<string, Array<{mapped_param_code, mapped_test_code, parameter_name}>> = {};
for (const m of mappings) {
  if (!codeMap[m.machine_code]) codeMap[m.machine_code] = [];
  codeMap[m.machine_code].push({...});
}
```

When processing each incoming result, look up matching mapping(s) and pick the one whose `mapped_param_code` / `mapped_test_code` is present in the order's pending tests. Fallback: if none match the order, fall back to first mapping (or mark unmapped). This guarantees `GLU` going to a fasting-glucose order maps to `PRM0025`, and to a random-glucose order maps to `PRM0026`.

**3. UI — `src/components/lims/LimsSettings.tsx` (Code Mapping tab)**
- Remove any client-side "machine_code already exists" duplicate-check.
- Allow saving multiple rows with the same `machine_code` but different `mapped_param_code`.
- Display grouped or sortable by `machine_code` so duplicates are visible.

### Files to inspect/edit
- `supabase/functions/lims-interface/index.ts` (POST handler)
- `src/components/lims/LimsSettings.tsx` (or wherever `lims_code_mapping` CRUD lives)
- Migration to adjust constraints on `lims_code_mapping`

### No changes
- GET handler reverse-map (already 1:N safe)
- `lims_test_orders`, `lims_test_results` schemas
