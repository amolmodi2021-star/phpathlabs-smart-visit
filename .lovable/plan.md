## Why the `>5` for TSH isn't flagging

Honest answer: the previous fix only updated `src/lib/reportFlags.ts` (`computeAbnormalFlag`), but **nothing in the LIMS workflow actually calls that helper**. It's only used for downstream report rendering. Both manual entry and the interface use their own local copies of the flag logic that strip operators via `parseFloat()`, so `>5` becomes `5` and falls inside the TSH range → flagged Normal.

There are **5 duplicate `calculateFlag` implementations** plus the interface edge function — all with the same operator-blind bug:

| Location | Path |
|---|---|
| Manual entry | `src/components/lims/ResultsEntry.tsx` (line 679) |
| Verification | `src/components/lims/ResultVerification.tsx` (line 432) |
| Doctor approval | `src/components/lims/DoctorApproval.tsx` (line 335) |
| Modified approval | `src/components/lims/ModifiedApproval.tsx` (line 170) |
| Interface ingest | `supabase/functions/lims-interface/index.ts` (`computeFlagFromInterface`, line 56; plus a second inline numeric block ~line 212) |

## Plan

1. **Add a shared operator detector** to each of the 5 client copies of `calculateFlag` and to the edge function's `computeFlagFromInterface`. Logic mirrors what's already in `reportFlags.ts`:
   - Regex `^(?:>=|≥|>)\s*-?\d*\.?\d+` → treat as **H**
   - Regex `^(?:<=|≤|<)\s*-?\d*\.?\d+` → treat as **L**
   - Whitespace-tolerant (`>5`, `> 5`, `>= 5`, `≥5` all handled)
   - Applied **before** the numeric range comparison, so the value flags correctly even when the trailing number falls inside the normal range.

2. **Edge function (`lims-interface`)**: also apply the same operator check to the secondary numeric block around line 212 that writes flags directly during ingest.

3. **No DB migration needed.** Flags are recomputed on render/save, so existing rows will reflect the new logic the next time they're touched. Already-saved historical flags are not retroactively rewritten (matches current behaviour).

4. **Out of scope (won't change):** qualitative/descriptive comparisons, calculated parameters, range-text parsing — those already work and aren't affected by operator prefixes.

## Result after fix

- Manual entry of `>5`, `> 5`, `≥5` for TSH → flagged **HIGH** immediately and on save.
- Interface-pushed `<0.01` for TSH → flagged **LOW**.
- Behaviour identical across Results Entry, Verification, Doctor Approval, Modified Approval, and downstream report rendering.