
## Root cause
The `lims-interface` edge function writes machine `result_value` directly into `patient_results` without consulting the per-parameter unit-conversion settings on `report_test_parameters` (`unit_conversion_enabled`, `unit_conversion_operator`, `unit_conversion_value`). So PRM0101 (Platelet Count) keeps the machine's raw value (e.g. `200`) instead of converting (e.g. `× 1000` → `200000`) before storing.

## Fix — single file
**`supabase/functions/lims-interface/index.ts`** — apply conversion in both bridge paths.

### 1. Extend parameter SELECT (2 places)
Lines ~84-86 (reprocess) and ~522-525 (POST bridge): add the 3 fields.
```ts
.select("id, param_code, parameter_name, unit, normal_range_low, normal_range_high, normal_range_text, unit_conversion_enabled, unit_conversion_operator, unit_conversion_value")
```

### 2. Add a small converter helper near the top of the file
```ts
function applyUnitConversion(rawValue: string, param: any): string {
  if (!param?.unit_conversion_enabled) return rawValue;
  const factor = Number(param.unit_conversion_value);
  if (!factor || isNaN(factor)) return rawValue;
  const num = parseFloat(rawValue);
  if (isNaN(num)) return rawValue; // leave non-numeric (e.g. "POSITIVE") untouched
  const converted = param.unit_conversion_operator === "/" ? num / factor : num * factor;
  // Trim trailing zeros, cap at 4 decimals
  return Number(converted.toFixed(4)).toString();
}
```

### 3. Apply in both bridge loops
- **POST results bridge** (~line 562): replace `parseFloat(mr.result_value)` and the `result_value` writes with the converted value. Compute once at top of loop:
  ```ts
  const convertedValue = applyUnitConversion(mr.result_value, param);
  const numericVal = parseFloat(convertedValue);
  ```
  Then use `convertedValue` in both the `update({ result_value: ... })` (~line 583) and the `insertPayload.push({ result_value: ... })` (~line 600 area). The flag computation now uses the converted numeric so range-based H/L/N stays correct against the parameter's reference interval (which is in the converted unit).

- **Reprocess action** (~line 122): identical change — `const convertedValue = applyUnitConversion(sr.result_value, param);` then use `convertedValue` for both numeric flag check and `result_value` written at lines 142 and 163.

### Behavior
| Param | Raw from machine | Conversion config | Stored in Results Entry |
|---|---|---|---|
| PRM0101 Platelet Count | `200` | `× 1000` enabled | `200000` |
| PRM0101 Platelet Count | `1.5` | `× 1000` enabled | `1500` |
| Any param | `POSITIVE` (text) | enabled | `POSITIVE` (untouched) |
| Any param | `5.4` | conversion disabled | `5.4` |
| HbA1c etc. | numeric | not enabled | unchanged |

### Notes
- Raw value remains intact in `lims_test_results` (audit trail). Only the value pushed to `patient_results` (Results Entry) is converted.
- Flags (H/L/N) are computed against the converted value vs. parameter's normal range, which is the correct comparison.
- Auto-bridges in real time on next result POST — no manual refresh / reprocess needed.
- Already-stored converted-incorrectly values can be fixed by triggering the existing `reprocess` action (it overwrites pending rows).

## Out of scope
- No DB changes.
- No UI changes (Results Entry already reads `result_value` as-is).
- Manual entries unaffected (conversion only applies on the interface bridge path).

## Files
- `supabase/functions/lims-interface/index.ts` — add helper, extend 2 SELECTs, apply conversion in 2 bridge loops (~15 lines net).
