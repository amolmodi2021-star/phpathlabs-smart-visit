

# Fix: Compare qualitative/descriptive results against the displayed Reference Range, not the dropdown source

## The bug

Both Erythema (qualitative) and REMARK (descriptive) tint red even though their result equals the configured normal value shown in the **Ref. Range** column.

Root cause: the `calculateFlag` logic compares against the wrong field.

| Range type | What user configures as "normal" | What I'm currently comparing against |
|---|---|---|
| Qualitative | `normal_range_text` (Display Text, e.g. `"Absent"`) | `expected_value` (pair label, e.g. `"Absent / Present"`) — **always mismatches** |
| Descriptive | `normal_range_text` (Display Text under "Normal Findings", e.g. `"Negative"`) | `descriptive_options` (the full dropdown list including abnormal choices like `["Negative", "Positive"]`) — passes for any selectable option, including abnormal ones |

So qualitative rows currently ALWAYS tint red (label never equals result), and descriptive rows NEVER tint red (every dropdown option counts as normal). Both broken.

## The fix

For both qualitative and descriptive, compare the entered result against **`normal_range_text`** (the same Display Text the user sees in the Ref. Range column on screen — that's the field the user designated as "Normal Findings").

- Match (case-insensitive, trimmed) → flag `"N"` → no tint.
- Mismatch → flag `"X"` → red tint, no badge.
- `normal_range_text` empty → flag `""` → no tint (nothing configured to compare against).

## Files touched

### 1. `src/components/lims/ResultVerification.tsx`
- Extend `calculateFlag` signature to also receive `normalRangeText: string` (the Display Text). Replace the qualitative branch and the descriptive branch with a single shared check:
  ```ts
  if (rangeType === "qualitative" || rangeType === "descriptive") {
    const ref = (normalRangeText || "").trim().toLowerCase();
    if (!ref) return "";
    return value.trim().toLowerCase() === ref ? "N" : "X";
  }
  ```
- All 6 callers of `calculateFlag` (lines 611, 660, 703, 798, 1169, plus row-bg compute) pass `p.normalRangeText` (already loaded — it's `resolved.text` and surfaces as `p.normalRangeText`).

### 2. `src/components/lims/ResultsEntry.tsx`
- Same change to `calculateFlag` (line 676 area). Pass `normalRangeText` from `ParameterResult`.

### 3. `src/components/lims/DoctorApproval.tsx`
- Same change to `calculateFlag` (line 334 area). Pass `normalRangeText`.

### 4. `src/components/lims/ModifiedApproval.tsx`
- Same change to `calculateFlag` (line 156 area). The query already does `select("*")` so `normal_range_text` is available on each row — wire it through.

### 5. `src/components/report/ReportResultsSection.tsx`
- No change needed. The renderer already trusts the stored `flag` value (`X` → tint, no badge).

## Cleanup

- The `expectedValue` and `descriptiveOptions` arguments stay in the signature only because they're still passed by callers; they become unused inside the function (safe to leave for now or remove).

## Verification (against the user's screenshot)

1. **Erythema** (qualitative, Ref. Range = `"Absent"`, Result = `"Absent"`) → `"Absent" === "Absent"` → `"N"` → no tint. ✓
2. **REMARK** (descriptive, Ref. Range = `"Negative"`, Result = `"Negative"`) → `"Negative" === "Negative"` → `"N"` → no tint. ✓
3. Change Erythema result to `"Present"` → `"Present" !== "Absent"` → `"X"` → red row, blank Flag column. ✓
4. Numeric (Examine After / Wheal) — untouched, "Normal" badge still shows. ✓

## Risk

Trivial. Single comparison source-of-truth swap. No DB change. No schema change. Existing approved-report snapshots already render correctly because the report renderer already keys off the `flag` value, which now becomes consistent across new saves.

