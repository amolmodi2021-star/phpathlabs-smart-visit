

# Fix Formula Evaluation Operator Placement Bug

## Root Cause
The formula builder UI stores the operator on each token and displays it **before** that token (as an infix between the previous and current token). But `evaluateFormula` appends the operator **after** the token's value, shifting all operators by one position.

Example with `HbA1c * 28.7 - 46.7`:
- Current (wrong): builds `6.5 + 28.7 * 46.7` = 1346.79
- Correct: should build `6.5 * 28.7 - 46.7` = 139.85

## Fix
In `evaluateFormula`, move the operator to appear **before** the token's value (for tokens after the first one), instead of after.

### Current logic (all 4 files):
```typescript
// Appends value, THEN operator after
expr += parseFloat(val);  // or fixed_value
if (token.operator && ...) expr += ` ${op} `;
```

### New logic:
```typescript
// For idx > 0, prepend operator BEFORE value
if (idx > 0 && token.operator) expr += ` ${token.operator} `;
expr += parseFloat(val);  // or fixed_value
// Remove the post-value operator append
```

### Files to change (same fix in each):
1. `src/components/lims/ResultsEntry.tsx` — `evaluateFormula` function (~line 643-677)
2. `src/components/lims/ResultVerification.tsx` — same function
3. `src/components/lims/DoctorApproval.tsx` — same function
4. `src/components/lims/ModifiedApproval.tsx` — same function

### Bracket handling adjustment
- `bracket_open`: prepend operator before `(` if idx > 0
- `bracket_close`: just append `)`, no operator after

### No database changes needed — stored formulas are correct; only the evaluation order is wrong.

