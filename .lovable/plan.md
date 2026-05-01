# Add "Time" range type (mins + secs) for parameters

For tests like **Bleeding Time** and **Clotting Time** where the result is naturally expressed as minutes + seconds with a normal range (e.g. *2 – 7 min*).

## How it will work for the user

- In **Parameters → Normal Ranges**, a new **Range Type** option **"Time (Min : Sec)"** is added next to Numeric / Qualitative / Descriptive / Undefined.
- When chosen, the normal-range editor shows **Low (min : sec)** and **High (min : sec)** dual inputs instead of generic number boxes. Display text auto-fills as `2 min – 7 min` (or `1 min 30 sec – 7 min` when seconds are non-zero).
- In **Results Entry / Result Verification / Modified Approval / Doctor Approval**, the result cell renders **two small inputs** — `[Min] : [Sec]` — with a thin separator. Seconds clamp to 0–59, auto-rolling over into minutes if entered higher.
- Flagging works as today: total seconds are compared against the low/high (also stored as total seconds) → produces **L / H / Normal** automatically.
- In the **PDF report**, the result column shows `2 min 30 sec` (or `45 sec` if minutes is 0, or `3 min` if seconds is 0). Reference range column shows `1 min 30 sec – 7 min`.

## Storage decisions (no schema change required)

- Reuse existing `parameter_normal_ranges` columns:
  - `range_type = 'time'`
  - `normal_range_low` / `normal_range_high` store **total seconds** (e.g. `120` for 2 min).
  - `normal_range_text` stores the human display (e.g. `2 min – 7 min`) — auto-generated.
- Reuse existing `patient_results.result_value` (text) — store as a canonical string `"M:SS"` (e.g. `"2:30"`). A small helper formats it for the PDF as `"2 min 30 sec"`.

This avoids any DB migration, keeps backward compatibility, and lets historical parameters continue to work.

## Files to change

1. **`src/pages/ReportParameters.tsx`**
   - Add `<SelectItem value="time">Time (Min : Sec)</SelectItem>` to the Range Type dropdown.
   - Add a new editor branch for `r.range_type === "time"` with two pairs of `[min][sec]` inputs (Low / High) and an auto-computed display-text preview.
   - On save, convert min+sec → total seconds for `normal_range_low/high`, build `normal_range_text` like `2 min – 7 min`.

2. **`src/lib/timeRange.ts`** (new tiny helper)
   - `secondsToMinSec(total) → { min, sec }`
   - `minSecToSeconds(min, sec) → number`
   - `formatTimeResult("2:30") → "2 min 30 sec"` (handles edge cases: pure seconds, pure minutes)
   - `formatTimeRange(lowSec, highSec) → "2 min – 7 min"`

3. **`src/components/lims/ResultsEntry.tsx`**
   - In `resolveNormalRange`, propagate `rangeType: "time"`.
   - In the result-cell renderer, add a branch when `p.rangeType === "time"` showing two compact number inputs (`min` / `sec`) joined by `:`. On change, write canonical `"M:SS"` into the same `handleValueChange` pipeline.
   - In `calculateFlag`, when `rangeType === "time"`, parse the value to total seconds and compare against `low/high` (already total seconds).

4. **`src/components/lims/ResultVerification.tsx`** — same three changes as ResultsEntry (renderer branch + flag calc + range resolution).

5. **`src/components/lims/ModifiedApproval.tsx`** — same renderer + flag-calc treatment for `rangeType === "time"`.

6. **`src/components/lims/DoctorApproval.tsx`** — display-only: format `"2:30"` as `"2 min 30 sec"` using the helper.

7. **`src/components/report/ReportResultsSection.tsx`**
   - Update `isNumericResult` so a `"M:SS"` time value is **not** treated as descriptive (keeps it centred under Result column).
   - Format `r.result_value` through `formatTimeResult(...)` when the saved string matches the time pattern. Reference range already comes pre-formatted from `normal_range_text`.

## Notes / edge cases

- Empty seconds input is treated as 0. Empty minutes + empty seconds = no result.
- Backward compatible: any existing parameter without `range_type='time'` is unaffected.
- The same `"M:SS"` value is what gets archived into `approved_reports.test_results` JSONB, so re-printed historical reports also render the friendly format via the report formatter.

No DB migration is needed for this feature.