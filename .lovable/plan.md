

# Auto-Cap Payment Amount to Due Amount

## Problem
When entering a payment amount that exceeds the due amount, the value turns red instead of being automatically capped to the due amount (like in patient registration).

## Solution

### Change in `src/components/lims/DuePayments.tsx` (line 79-82)

Update `handleModeAmountChange` to cap the entered amount so the total across all modes never exceeds `selected.due_amount`:

```typescript
const handleModeAmountChange = (mode: string, val: string) => {
  const num = parseFloat(val) || 0;
  const othersTotal = Object.entries(modeAmounts)
    .filter(([m]) => m !== mode && selectedModes.has(m))
    .reduce((sum, [, v]) => sum + (v || 0), 0);
  const maxForThis = Math.max(0, (selected?.due_amount || 0) - othersTotal);
  setModeAmounts(prev => ({ ...prev, [mode]: Math.min(num, maxForThis) }));
};
```

This mirrors the patient registration behavior: if due is ₹70 and user types 100, it auto-fills as 70.

