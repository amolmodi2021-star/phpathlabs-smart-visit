

## Plan: Strip Internal Code from LIMS Interface Response

### Problem
Current GET response (`?action=query&sample_id=XXX`) sends both `code` (machine code) AND `internal_code` (PRM####) for each test. The analyzer should only see the machine code mapped via `lims_code_mapping`. Also, when no mapping exists, we currently fall back to the internal code — which leaks PRM#### to the machine.

### Example
For a test with internal code `PRM0025` mapped to machine code `O11`:
- **Current response**: `{ "code": "O11", "internal_code": "PRM0025", "name": "...", "unit": "...", "machine_id": "..." }`
- **New response**: `{ "code": "O11", "name": "...", "unit": "...", "machine_id": "..." }`

If `PRM0025` has no mapping in `lims_code_mapping`, the test will be **excluded** from the response (analyzer won't see internal codes at all).

### Change — `supabase/functions/lims-interface/index.ts`

In the GET handler (around lines 122–134), update the test enrichment:

**Current:**
```ts
const enrichedTests = pendingTests.map((t: any) => ({
  code: reverseCodeMap[t.code] || t.code,   // falls back to PRM####
  internal_code: t.code,                     // leaks PRM####
  name: t.name,
  unit: t.unit || "",
  machine_id: t.machine_id || machineMap[t.code] || "",
}));
```

**New:**
```ts
const enrichedTests = pendingTests
  .filter((t: any) => reverseCodeMap[t.code])  // only include tests with a mapping
  .map((t: any) => ({
    code: reverseCodeMap[t.code],              // machine code only (e.g. "011")
    name: t.name,
    unit: t.unit || "",
    machine_id: t.machine_id || machineMap[t.code] || "",
  }));
```

### Behaviour Notes
- POST (results submission) flow is unchanged — analyzer continues to send `machine_code` (e.g. `O11`) and we map it back to `PRM0025` via `lims_code_mapping`.
- If a sample has tests with no mapping configured, those tests are silently dropped from the analyzer response (admin can add the mapping in the new "Add Mapping Manually" UI we just built).
- `lims_interface_logs` will record the cleaned response — useful for debugging.

### File
- `supabase/functions/lims-interface/index.ts` — single block change in GET handler (lines 122–134)

### No DB / other file changes

