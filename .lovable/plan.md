

# Add a new "Undefined" range type for parameters

## What you'll get

A 4th option in the **Range Type** dropdown of Parameter Settings (alongside *Numeric / Qualitative / Descriptive*), called **Undefined**. It is the most flexible type — designed for measurements where there is no fixed normal range (e.g. *Quantity, Volume, Color, Appearance* in Urine Routine).

For an **Undefined** parameter, the configurer can set:

1. **Dropdown options** (optional) — same UI as Descriptive: add/remove text choices the technician can pick from a typeahead.
2. **Unit** (optional) — already present at the parameter level (e.g. `mL`, `cm`, `°C`). Reused as-is.
3. **Display Text** (optional) — free text shown in the report's *Reference Range* column.
4. **Manual entry** is always allowed (the typeahead also accepts free typing — the existing `DescriptiveCombobox` already does this).

### Result column behavior in the report

- If a **Unit** is configured AND the entered result is non-empty, the report's *Result* column shows `<value> <unit>` concatenated (e.g. typing `10` for *Quantity* with unit `mL` → report shows `10 mL`).
  - To avoid the unit appearing twice when the technician already typed it, concatenation is skipped if the result already ends with the unit (case-insensitive trim check).
- If **no Unit**, result shows as-is.

### Reference Range column behavior

- If **Display Text** is empty → that cell is **blank** in the report (no `-` placeholder, no fallback to numeric range).
- If **Display Text** is set → shown verbatim in the *Reference Range* column.

### Highlighting

- **Undefined** parameters are **never highlighted** and **never get a flag badge**, regardless of result value. (No high/low concept; no normal-text comparison either, because the reference is just a label, not a constraint.)

## Files touched

### 1. `src/pages/ReportParameters.tsx` — add the option in the configurator
- Add `<SelectItem value="undefined">Undefined</SelectItem>` to the Range Type select (line 813).
- Add a new branch after the existing `descriptive` branch rendering:
  ```tsx
  ) : r.range_type === "undefined" ? (
    <div className="space-y-2">
      <div className="text-xs text-muted-foreground">
        No flag/highlight for this type. Result value will be concatenated with the parameter Unit on the report.
      </div>
      {/* Reuse the same dropdown-options UI block as descriptive */}
      <div className="flex items-center justify-between">
        <Label className="text-xs font-medium">Dropdown Options (optional, for result selection)</Label>
        <Button … onClick={…add option…}>Add Option</Button>
      </div>
      {(r.descriptive_options || []).map(...)}      {/* identical to descriptive */}
      <div>
        <Label className="text-xs">Display Text for Reference Range (optional, leave blank to omit)</Label>
        <Input value={r.normal_range_text} onChange={...} placeholder="e.g. 10 - 50 mL" />
      </div>
    </div>
  ) : (
  ```
- Update the save mapping (line 209-220) so Undefined persists `descriptive_options` (when any) and `normal_range_text`, with `normal_range_low/high` and `expected_value` set null:
  ```ts
  const isUndef = r.range_type === "undefined";
  const isDesc = r.range_type === "descriptive";
  …
  descriptive_options: (isDesc || isUndef) ? (r.descriptive_options?.filter(o => o.trim()) || []) : [],
  ```
- No DB schema change — `parameter_normal_ranges.range_type` is already a free-form `text` column.

### 2. `src/components/lims/ResultsEntry.tsx`
- `resolveNormalRange` already returns `rangeType` from the row — no change.
- **Input renderer** (lines 1159-1190): add a new branch ABOVE the final `Input` fallback:
  ```tsx
  ) : p.rangeType === "undefined" ? (
    p.descriptiveOptions.length > 0 ? (
      <DescriptiveCombobox
        value={currentValue}
        options={p.descriptiveOptions}
        onChange={(v) => handleValueChange(regId, p.parameterId, v, entry)}
        onKeyDown={handleResultTabKey}
        className="w-[180px]"
      />
    ) : (
      <Input
        value={currentValue}
        onChange={e => handleValueChange(regId, p.parameterId, e.target.value, entry)}
        className="h-7 text-sm w-[180px]"           /* never red */
        placeholder="Enter result"
        data-result-input=""
        onKeyDown={handleResultTabKey}
      />
    )
  ) : (
  ```
- **`calculateFlag`** (line 678): add an early return for undefined:
  ```ts
  if (rangeType === "undefined") return "";
  ```
- **Flag column** (lines 1240-1247): hide the `—` placeholder badge for undefined (just render nothing).

### 3. `src/components/lims/ResultVerification.tsx`
Mirror the same three changes (input branch line 832/1172, `calculateFlag` line 431, flag-cell suppression for `rangeType === "undefined"`).

### 4. `src/components/lims/DoctorApproval.tsx`
Same three changes mirrored.

### 5. `src/components/lims/ModifiedApproval.tsx`
- `calculateFlag` (line 166): add `if (rangeType === "undefined") return "";`.
- The current Modified Approval row uses a plain Input for results — leave that as-is (technicians can still freely edit the value); just ensure the row never tints red when `rangeType === "undefined"` by adjusting the `rowBg` calc (line 449) to skip when meta is undefined.
- For consistency, render the `DescriptiveCombobox` when `rangeType === "undefined"` AND options exist. (Same conditional we add elsewhere.)

### 6. `src/components/report/ReportResultsSection.tsx` — render rules
Two precise changes to `ParamRow` (lines 110-163):

**(a) Result-cell concatenation with unit for the unit-suffix case**
The renderer doesn't currently know `range_type`. Cleanest is to do the concatenation at write-time in the LIMS save paths (so the persisted `result_value` already says `"10 mL"`). That keeps the report renderer unchanged and also makes the value consistent everywhere (LIMS list, CRM history, exports). Add this small helper used in `ResultsEntry`, `ResultVerification`, `DoctorApproval`, `ModifiedApproval` save paths (right before building the row payload):

```ts
function applyUnitSuffix(value: string, unit: string, rangeType?: string): string {
  if (!value || rangeType !== "undefined" || !unit) return value;
  const trimmed = value.trim();
  if (trimmed.toLowerCase().endsWith(unit.trim().toLowerCase())) return trimmed;
  return `${trimmed} ${unit.trim()}`;
}
```

Wrap the `value` going into `result_value:` in all four save paths (`ResultsEntry.tsx` lines 785 & 842; same pattern in Verification/DoctorApproval/ModifiedApproval).

**(b) Blank Reference Range when nothing is configured**
Currently line 148 falls back to `${low} - ${high} ${unit}`. For Undefined parameters with empty `normal_range_text` AND no low/high, the fallback already produces `" -  "` (an artifact). Tighten that fallback to render an empty cell when both `normal_range_text` is empty AND low/high are null:
```tsx
{(r.normal_range_text && r.normal_range_text.trim())
  || (r.normal_range_low != null && r.normal_range_high != null
      ? `${r.normal_range_low} - ${r.normal_range_high}${r.unit ? ` ${r.unit}` : ''}`
      : '')}
```

**(c) Highlight predicate**
No change to `isAbnormalFlag` — undefined parameters never write `flag = "X"`, so they will not be tinted (already correct).

### 7. `supabase/functions/lims-interface/index.ts` — interface path
The shared `computeFlagFromInterface` (added in the previous round) currently returns `""` only when `normal_range_text` is empty. That naturally handles undefined parameters fed via instrument (no normal_range_text → no flag). No change needed here.
However, the interface bridge does NOT do unit suffixing, so machine-fed values for undefined parameters won't auto-concat the unit. Add the same `applyUnitSuffix` server-side just before writing `result_value` into `patient_results` (both `submit_results` and `reprocess` paths). The function selects `unit` and `normal_range_text` already; we don't have `range_type` in the bridge query — fall back to the safe rule: **if `normal_range_low/high` are null AND `unit` is set AND value doesn't already end with unit → concat**. That covers the "Undefined" intent without needing range_type joins.

## Verification

1. In Parameter Settings, edit *Quantity* under *Urine Routine*. Set **Range Type = Undefined**, **Unit = mL**, leave Display Text blank, no dropdown options. Save.
2. In Results Entry, type `10` for Quantity → save → check `patient_results.result_value` = `"10 mL"`. Open report → *Result* column shows `10 mL`, *Reference Range* column is blank, no highlight.
3. Edit *Color* under *Urine Routine*. Range Type = Undefined, add dropdown options `Yellow / Pale Yellow / Red`, Display Text = `Pale Yellow`. Pick `Red` → report shows `Red` in Result, `Pale Yellow` in Ref. Range, no highlight.
4. Edit *Appearance*. Range Type = Undefined, no dropdown, no Display Text, no unit. Type `Cloudy` → report shows `Cloudy`, ref-range cell blank, no highlight.
5. Numeric/Qualitative/Descriptive parameters: behavior unchanged.
6. Machine-fed undefined results (e.g. via interface) get the unit suffix the same way.

## Risk

Low. Additive sentinel value `"undefined"` for `range_type`. No DB schema change. Numeric, qualitative, and descriptive logic unchanged. Single shared helper for unit concat used in 4 client save paths + 2 edge-function paths.

