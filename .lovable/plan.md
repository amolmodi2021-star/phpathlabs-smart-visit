## Goal
When a numeric result arrives prefixed with a comparison operator — `>2000`, `> 2000`, `<2000`, `< 2000`, `>=2000`, `≥ 2000`, `<=2`, `≤ 2` — auto-flag it as **H** (high) or **L** (low) regardless of how the operator and number are spaced. The current `computeAbnormalFlag` strips the operator and only compares the bare number, so `>2000` against a normal range of `0–3000` is incorrectly returned as `N`.

## Where the fix lives
Single file: `src/lib/reportFlags.ts`. Every screen (Results Entry, Verification, Doctor Approval, PDF report, abnormal history) already routes through `computeAbnormalFlag` / `normalizeTestResultFlags`, so one fix propagates everywhere — including bidirectional analyzer interface results, since they also pass through the same flag computation.

## Logic change

1. Add an `ResultOperator` detector that recognises a leading `>`, `>=`, `≥`, `<`, `<=`, `≤` followed by optional whitespace and a number. Tolerant of spaces, case-insensitive.

2. In `computeAbnormalFlag`, after extracting the number, also detect the operator. Apply these rules (standard lab interpretation of capped/saturating readings):

   - **`>X` (or `≥X`)**: the true value is at or above X, possibly higher.
     - If a `high` bound exists and `X ≥ high` → **H** (definitely above range).
     - Else if a `high` bound exists and `X < high` → still **H** is the safe call when the result is reported as ">X" because analyzers only report this when the reading saturates the upper limit; treat as **H**.
     - If no `high` exists but a `low` exists and `X ≥ low` → **N** (within open-ended range).
     - If no bounds at all → **H** (operator implies abnormal/notable).

   - **`<X` (or `≤X`)**: the true value is at or below X, possibly lower.
     - Mirror the above with `low`. If `low` exists and `X ≤ low` → **L**. Else with `low` and `X > low` → **L** (saturating below detection limit). No bounds → **L**.

3. When no operator is present, behaviour is unchanged (existing equality comparison against low/high).

4. Whitespace handling is already implicit — the regex allows `\s*` between the operator and number, so `>2000`, `> 2000`, `>  2000` all match.

## Examples after fix

| Result | Range | Old flag | New flag |
|--------|-------|----------|----------|
| `>2000` | 0–1500 | H | H (unchanged) |
| `>2000` | 0–3000 | N (wrong) | **H** |
| `> 2000` | 0–3000 | N (wrong) | **H** |
| `≥2000` | 0–3000 | N (wrong) | **H** |
| `<2` | 5–20 | L | L (unchanged) |
| `< 2` | 0.5–20 | N (wrong) | **L** |
| `≤ 0.1` | 0.5–10 | L | L |
| `2000` (plain) | 0–3000 | N | N (unchanged) |

## No DB changes
Pure presentation/computation logic; no schema or migration needed.