## Goal

For parameters with **Range Type = Descriptive** (and the analogous **Undefined** type that uses the same display-text field), make the **Display Text** behave like Numeric ranges already do for unit handling:

1. **Auto-append the parameter's Unit** when the user types a display-text value in the Parameters dialog (e.g. typing `12` with Unit `secs` becomes `12 secs`).
2. **Ignore the Unit** when comparing the entered result against the display text for highlighting (X flag). So if Display Text = `12 secs` and the technician enters `12`, it should remain Normal (no red X), not be marked as a mismatch.

## Files to change

### 1. `src/pages/ReportParameters.tsx` — auto-fill unit into Display Text

In the descriptive/undefined branch (around lines 956–967), wire up the Display Text `onChange` to append the parameter unit when the typed value is purely numeric (or when it doesn't already end with the unit). Implementation:

- On change, take the raw input.
- If `form.unit` is set and the trimmed value does **not** already end with the unit (case-insensitive), and the trimmed value is non-empty, store `"<value> <unit>"` (collapsed spaces). Otherwise store as-is.
- This mirrors `applyUnitSuffix` used elsewhere but is applied at edit time so the user sees the final stored text.

(The Numeric branch already auto-fills `low - high <unit>` via `updateRange`, so this brings Descriptive in line.)

### 2. Highlight comparison — strip unit before matching

Update `calculateFlag` in three files so the descriptive/qualitative branch ignores the unit suffix:

- `src/components/lims/ResultsEntry.tsx` (line 689)
- `src/components/lims/ResultVerification.tsx` (line 438)
- `src/components/lims/DoctorApproval.tsx` (line 341)

Change the signature to also accept `unit?: string | null`, and update the descriptive/qualitative comparison block:

```ts
if (rangeType === "qualitative" || rangeType === "descriptive") {
  const stripUnit = (s: string) => {
    let t = s.trim().toLowerCase();
    const u = (unit || "").trim().toLowerCase();
    if (u && t.endsWith(u)) t = t.slice(0, -u.length).trim();
    return t;
  };
  const ref = stripUnit(normalRangeText || "");
  if (!ref) return "";
  return stripUnit(value) === ref ? "N" : "X";
}
```

Pass `p.unit` (already on the parameter object) at every existing `calculateFlag(...)` call site in those three files.

## Behaviour after change

| Display Text saved | Unit | Result entered | Flag |
|---|---|---|---|
| `12 secs` (auto-filled from `12`) | `secs` | `12` | N |
| `12 secs` | `secs` | `12 secs` | N |
| `12 secs` | `secs` | `15` | X (highlight) |
| `Normal` | (none) | `Abnormal` | X (unchanged) |

Numeric, qualitative-pair, and undefined types are not affected beyond the unit-stripping safety added to qualitative (which is harmless because qualitative display texts don't contain units).

## Out of scope

- No DB schema changes.
- No changes to PDF report rendering — display text is already shown as stored.
- Existing parameters whose Display Text was saved without a unit will continue to render and compare as-is; only newly edited descriptive ranges will gain the auto-appended unit.
