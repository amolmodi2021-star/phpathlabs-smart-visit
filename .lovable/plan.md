

# Qualitative / Descriptive parameters: highlight on mismatch, no flag letter

## What you'll get

For parameters where **Range Type = Qualitative** or **Descriptive**:

- If the entered result **matches** the configured normal (Qualitative `Display Text` / Descriptive `Normal Findings` from the parameter's normal-range entry), the row stays plain — no highlight, no flag.
- If the result **does not match**, the row in the **report** is highlighted (light red row background + bold red parameter name and result, same look used today for abnormal numeric H/L), but the **Flag column stays blank** (no "H", "L", "A", or any badge).
- Numeric parameters keep H/L exactly as today.

In LIMS entry/verification/approval screens, the existing red "Abnormal" badge is replaced for these two range types with a subtle row tint only (so technicians still see something is off, but no misleading H/L/Abnormal label is stored).

## How matching is decided

- **Qualitative**: result must equal `normal_range.expected_value` (the "Expected Normal Value" picked from the pair, e.g. *Absent*, *Non Reactive*, *Negative*) — case-insensitive, trimmed. Mismatch → highlight only.
  - Today's behavior writes `flag = "A"`. We change it to `flag = "X"` (sentinel meaning *highlight without label*).
- **Descriptive**: result must equal one of `normal_range.descriptive_options` listed under "Normal Findings" (case-insensitive, trimmed). Empty → no highlight (today: also no flag).
  - Today's behavior writes `flag = ""` always. We change it to write `flag = "X"` when the result is non-empty AND not in the configured normal list, otherwise `""`.

`"X"` is invisible to the report's Flag column (only "H"/"L" render badges) but is recognised by a new branch of `isAbnormalFlag` to apply the row highlight.

## Files touched

### 1. `src/lib/reportFlags.ts`
- Extend `AbnormalFlag` type to include `"X"`.
- No change to numeric path. (Util is only used for normalisation in a few callers — leaving qualitative handling there alone is fine because the LIMS save paths below are the source of truth.)

### 2. `src/components/lims/ResultsEntry.tsx` — `calculateFlag` (line 676)
```ts
if (rangeType === "qualitative") {
  if (!expectedValue) return "";
  return value.trim().toLowerCase() === expectedValue.trim().toLowerCase() ? "N" : "X";
}
if (rangeType === "descriptive") {
  const opts = (descriptiveOptions || []).map(o => o.trim().toLowerCase()).filter(Boolean);
  if (opts.length === 0) return "";                          // nothing configured → no highlight
  return opts.includes(value.trim().toLowerCase()) ? "N" : "X";
}
```
Pass `descriptiveOptions` through (already on `ParameterResult`). Update the row styling branches that today react to `flag === "A"` to also react to `"X"` (red border on input, light row bg). Replace any `<Badge>Abnormal</Badge>` rendering for these two types with no badge — only the row tint.

### 3. `src/components/lims/ResultVerification.tsx`
Same `calculateFlag` change (line 430). Same UI tweaks: drop the "Abnormal" badge for qualitative/descriptive, keep `bg-destructive/5` row tint when `flag === "X"`. Remove the `"A"` `<SelectItem>` for the manual-flag override on outsourced rows for these two range types (keep H/L/N selectable — only relevant for outsourced numeric anyway).

### 4. `src/components/lims/DoctorApproval.tsx`
Same `calculateFlag` change (line 334). Same badge/highlight cleanup. Snapshot saved into `approved_reports.test_results` will carry `flag: "X"` (or `""`) instead of `"A"`.

### 5. `src/components/lims/ModifiedApproval.tsx` — `calculateFlag` (line 156)
Currently numeric-only. Extend signature to accept `rangeType`, `expectedValue`, `descriptiveOptions` (already available on `p` because the query is `select("*")`; expose them on the `tg.params` rows). Apply the same three-branch logic. Drop any "A"/"Abnormal" UI; preserve highlight only via `"X"`.

### 6. `src/components/report/ReportResultsSection.tsx`
- `isAbnormalFlag` (line 90): include `"X"` so row tint + bold red name/result fire.
- Flag-column render branches (lines 131 and the equivalent `showFlagText` branch lower down): only render the badge/text when the flag is **H/L/High/Low** — when flag is `"X"`, render nothing in the Flag cell. Add a tiny helper:
  ```ts
  const isHighlightOnly = (f?: string) => f === "X";
  const showFlagBadge = (f?: string) => f === "H" || f === "L" || f === "High" || f === "Low";
  ```
  Use `showFlagBadge` to gate the badge; `isAbnormalFlag` (now true for X too) gates the row styling.

### 7. One-time data normalisation (no migration needed)
Existing rows in `patient_results` and `approved_reports.test_results` may already contain `flag = "A"` from the previous logic. Two options:
- **A.** Leave them as-is. Report renderer should also treat legacy `"A"` as highlight-only (don't display the letter, do tint the row). I'll add `"A"` alongside `"X"` in `isAbnormalFlag` and **exclude `"A"` from `showFlagBadge`** so historical reports retroactively render correctly.
- **B.** Backfill `UPDATE patient_results SET flag = 'X' WHERE flag = 'A'` + JSONB rewrite.

Plan goes with **A** (additive, zero risk to historical immutability).

## What stays untouched

- Numeric flagging (H/L/N) — unchanged in entry, verification, approval, report.
- `normal_range_text` parsing and `parameter_normal_ranges` schema — unchanged.
- CRM Abnormal Tests and `useAbnormalHistory` — they currently key off `flag IN ('H','L','A')`; after this change, qualitative/descriptive mismatches use `'X'`. I'll add `'X'` to those filters (one-line change in `src/lib/abnormalTests.ts` and `src/hooks/useAbnormalHistory.ts` if they exist with that pattern — confirmed in passing).
- Outsourced manual-flag override stays for numeric tests.

## Verification

1. **Qualitative** (e.g. *HIV — Expected Normal: Non Reactive*). Enter `Reactive` → row tinted red in Results, Verification, Approval; Flag cell empty; report shows red row, no H/L badge.
2. Enter `Non Reactive` → no tint, no flag.
3. **Descriptive** (e.g. *Mantoux REMARK — Normal Findings: Negative*). Enter `Negative` → plain row. Enter `Positive` → row tinted, Flag column blank in report.
4. **Numeric** (e.g. FBS) — H/L badge and tint behave exactly as before.
5. Open an old approved report that has `flag = "A"` → row tints red but no "A" letter shown in the Flag column (legacy compatibility).
6. CRM Abnormal Tests still surfaces qualitative/descriptive mismatches (X added to the abnormal predicate).

## Risk

Low. Single new sentinel value `"X"`, presentational + lightweight save-path change. Numeric flow untouched. Historical `"A"` rows render correctly without backfill.

