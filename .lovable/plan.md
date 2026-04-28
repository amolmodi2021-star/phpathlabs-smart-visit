## Goal

When a parameter's numeric result comes in as a negative value (e.g. `-1.02`, `- 1.02`, ` -0.5`, including operator-prefixed `> -2`), make it visually obvious as a likely instrument/typing error across all three workflow screens. Saving, verifying, and approving must still be allowed — this is a warning, not a block.

## Detection rule

A result is "suspect negative" when:
- After trimming whitespace and any leading comparison operator (`>`, `>=`, `≥`, `<`, `<=`, `≤`), the remaining value parses to a finite number `< 0`.
- Whitespace between operator/sign and digits is ignored, so `-1.02`, `- 1.02`, `>-1`, `> -1` all match.
- Pure text results (e.g. "Negative", "Absent") are NOT flagged — only numeric values.

This will live in a tiny helper inside each screen (kept local to match the existing pattern of duplicated `calculateFlag` helpers) so we don't need a new shared module:

```ts
const isSuspectNegativeResult = (value: string | number | null | undefined): boolean => {
  if (value === null || value === undefined) return false;
  const stripped = String(value).trim().replace(/^(?:>=|≥|>|<=|≤|<)\s*/, "").trim();
  if (!stripped) return false;
  const num = Number.parseFloat(stripped.replace(/,/g, ""));
  return Number.isFinite(num) && num < 0;
};
```

## Visual highlight

Consistent treatment everywhere so users learn the cue:

1. **Test name header** — when ANY parameter in the test has a suspect-negative value:
   - Text becomes `text-red-600` and `font-bold`
   - Small inline badge `⚠ Negative value — please verify` (red bg, white text, `text-[10px]`) next to the test name

2. **Parameter row** — for the specific row(s) with the negative value:
   - Result input: red border (`border-red-500 ring-1 ring-red-300`) and `text-red-700 font-semibold`
   - Row background tint: `bg-red-50`
   - Inline `⚠` icon (lucide `AlertTriangle`, `text-red-600 h-3.5 w-3.5`) right after the input

3. **Saving / verifying / approving stays enabled.** No confirm dialog, no disabled buttons. The highlight persists through Results Entry → Verification → Doctor Approval → Modified Approval as long as the value remains negative.

## Files to edit

| File | What changes |
|---|---|
| `src/components/lims/ResultsEntry.tsx` | Add helper; in render, when iterating params compute `hasNegative` per test group → apply red styles to test-name span (line ~880 area) and per-row input/background/icon |
| `src/components/lims/ResultVerification.tsx` | Same helper + same styling on test name (line 1043) and each parameter row |
| `src/components/lims/DoctorApproval.tsx` | Same helper + same styling on test name (line 840) and each parameter row |
| `src/components/lims/ModifiedApproval.tsx` | Same helper + same styling on test name (line 397) and each parameter row, taking the currently-edited `currentValue` (not just the saved one) into account |

Detection uses the **live edited value** (where the user is typing) in Results Entry and Modified Approval, and the saved `result_value` in Verification / Doctor Approval (which are read-only there).

## Out of scope

- No DB schema change.
- No change to the flag logic (H/L/N) — negative values still compute their normal flag; the highlight is purely a UI warning overlay.
- Reports/PDF rendering unchanged (negative values will print as-is, since the user said "allow to continue").
- Interface ingest doesn't need changes — it just stores the value; the screens warn on display.
