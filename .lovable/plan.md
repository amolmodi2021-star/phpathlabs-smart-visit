

## Fix: Send Machine Codes (Not Internal Param Codes) in LIMS Interface GET Response

### Problem
The `lims-interface` GET endpoint currently returns our internal parameter codes (e.g., `PRM0158`, `PRM0113`) in the `tests[]` array. The middleware has no mapping table — it forwards codes directly to the analyzer machines, which only understand their native codes (e.g., `WBC`, `RBC`, `HGB`).

### Root Cause
In `supabase/functions/lims-interface/index.ts` (lines 101–107), the response is built using `t.code` directly from the order's stored tests, which are our internal `PRM####` codes.

### The Fix — Reverse-lookup machine_code from lims_code_mapping

The `lims_code_mapping` table already stores the bidirectional mapping:
- `machine_code` = analyzer's native code (e.g., `WBC`)
- `mapped_param_code` = our internal code (e.g., `PRM0158`)
- `mapped_test_code` = our internal test code (alternative)

**Changes in `supabase/functions/lims-interface/index.ts` (GET branch only):**

1. **Build a reverse-lookup map: internal code → machine_code**
   - After collecting `testCodes` from pending tests, query `lims_code_mapping`:
     - `select("machine_code, mapped_param_code, mapped_test_code, machine_id").or("mapped_param_code.in.(...),mapped_test_code.in.(...)")`
   - When `machineId` is provided, also filter by `machine_id` so the correct analyzer's code is picked (handles cases where the same parameter has different codes per machine).
   - Build `reverseMap: Record<internalCode, machine_code>`.

2. **Replace internal code with machine_code in the response**
   - In the `enrichedTests` map, set `code: reverseMap[t.code] || t.code` (fallback to internal code only if no mapping exists, so nothing breaks silently).
   - Optionally also include `internal_code: t.code` in the response for traceability/logging — but not required.

3. **Keep POST behavior unchanged**
   - The POST flow already correctly accepts machine codes from analyzers and translates them back to internal codes via the same table — that direction is working.

4. **Logging**
   - The existing `lims_interface_logs` insert continues to log the response_body, which will now show the machine codes that were actually sent (good for debugging middleware/analyzer issues).

### Why this works
- Middleware becomes a dumb pass-through: receives `WBC`, sends `WBC` to analyzer, analyzer responds with `WBC` → POST endpoint translates back to `PRM0158`. Symmetric round-trip.
- Falls back gracefully: if a parameter has no machine_code mapping defined yet, the internal code is still returned (current behavior preserved for unmapped tests).
- No DB schema changes. No frontend changes. No POST logic changes.

### File
- `supabase/functions/lims-interface/index.ts` — GET branch only

