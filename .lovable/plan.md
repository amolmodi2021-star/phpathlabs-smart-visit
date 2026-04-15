

# Fix Auto-Calculation of Parameters in Results Entry

## Root Cause
The formula builder (in `ReportParameters.tsx`) saves fixed-value tokens with `type: "fixed"`, but the `evaluateFormula` function in all four result entry components checks for `type: "fixed_value"`. This mismatch means any formula containing a constant (like `HbA1c × 28.7 − 46.7`) silently fails — the fixed values are skipped, producing an invalid expression that returns empty string.

## Fix
Update `evaluateFormula` in all four files to accept **both** `"fixed"` and `"fixed_value"` as the token type:

### Files to change (1 line each):

1. **`src/components/lims/ResultsEntry.tsx`** (~line 652)
   - Change: `token.type === "fixed_value"` → `token.type === "fixed_value" || token.type === "fixed"`

2. **`src/components/lims/ResultVerification.tsx`** (~line 411)
   - Same fix

3. **`src/components/lims/DoctorApproval.tsx`** (~line 238)
   - Same fix

4. **`src/components/lims/ModifiedApproval.tsx`** (~line 133)
   - Same fix

### Additionally — make calculated fields editable with recalculate button
As previously discussed, the calculated field input is currently `readOnly`. This will also be updated to allow manual override with a recalculate icon button, in all four components.

### No database changes needed.

