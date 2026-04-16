

## Plan: Map Machine Results into Results Entry

### Problem
The middleware POSTs results back with machine codes (e.g. `WBC`, `RBC`). The current `lims-interface` POST handler:
1. Translates machine_code → `mapped_param_code` (PRM####) ✓
2. Writes them only to `lims_test_results` table (used by the demo screen)
3. Does **NOT** write them to `patient_results`, which is what the production **Results Entry** screen reads

Result: machine values never appear in Results Entry for technicians to verify.

### Fix — Bridge interface results into `patient_results`

In `supabase/functions/lims-interface/index.ts` POST branch, after successfully translating + inserting into `lims_test_results`, also write the same mapped values into `patient_results` so they show up in the Results Entry UI.

#### Step-by-step logic

1. **Resolve registration_id from sample_id**
   - `sample_id` = `invoice_number[+suffix]` (set during Sample Acceptance).
   - Strip the trailing single-letter suffix (A/B/C…) if present, then look up `patient_registrations` by `invoice_number` to get `registration_id`.
   - If not found, skip patient_results write (still log + write to lims_test_results as today).

2. **Resolve parameter_id + test_id from `mapped_param_code`**
   - Query `report_test_parameters` by `param_code IN (...)` → get `id` (parameter_id), `parameter_name`, `unit`, `normal_range_low/high/text`.
   - Query `test_parameters` joined with `tests` to find which `test_id` this parameter belongs to within the registration's tests list. If a parameter belongs to multiple tests, prefer the one present in `patient_registrations.tests[]`.

3. **Compute flag** server-side using the parameter's normal range:
   - Numeric: `< low` → `L`, `> high` → `H`, else `N`.
   - If parameter has descriptive/qualitative range, leave flag as machine-provided or empty.

4. **Upsert into `patient_results`** (no unique constraint exists, so do manual select-then-insert/update):
   - Match on `(registration_id, parameter_id)`.
   - If exists with `status = "pending"` or empty `result_value` → UPDATE `result_value`, `flag`, `unit`, `is_from_interface = true`, `entered_at = now()`, `entered_by = 'INTERFACE'`, keep `status = 'pending'` (technician still reviews).
   - If does not exist → INSERT a new row with `status = 'pending'`, `is_from_interface = true`.
   - If row already has `status` beyond `pending` (entered/verified/approved) → SKIP (don't overwrite human-entered or verified values).

5. **Trigger status recalculation** — after writes, no need to call `recalculateRegistrationStatus` from the edge function (that runs client-side); the realtime sync hook (`useRealtimeSync("patient_results", ...)`) on Results Entry will auto-refresh and the new row appears, pre-filled with `isFromInterface: true`.

6. **Keep existing behavior** — `lims_test_results` and `lims_test_orders` updates remain unchanged. Unmapped results still go to `lims_unmapped_results`.

7. **Response payload** — extend with `patient_results_written: <count>` and `registration_resolved: true|false` for traceability in `lims_interface_logs`.

### Why this is safe
- Only writes to `patient_results` rows that are **pending or new** — never overwrites technician-entered, verified, or approved data.
- `is_from_interface = true` flag already drives existing UI behavior in Results Entry / Verification / Approval (visible in current code).
- Realtime sync already in place — no frontend changes required.
- Falls back gracefully if registration or parameter cannot be resolved (logged, no crash).

### File
- `supabase/functions/lims-interface/index.ts` — POST branch only

### No DB / frontend changes needed
- No schema changes.
- Results Entry already reads `patient_results` via `useQuery(["patient_results_existing", ...])` and displays values with the interface badge.

