

# Remove Auto-Selection of Cash in Due Payment Collection

## Problem
When opening the "Collect Payment" dialog in the Due Payments tab, "Cash" is automatically selected with the full due amount pre-filled. The user wants a blank slate — no payment mode pre-selected.

## Change in `src/components/lims/DuePayments.tsx`

In the `openCollect` function (~line 53-57), change:
```typescript
// Current
setSelectedModes(new Set(["Cash"]));
setModeAmounts({ Cash: p.due_amount });

// New
setSelectedModes(new Set());
setModeAmounts({});
```

This forces the user to explicitly select payment mode(s) before collecting. The existing validation (`selectedModes.size === 0` check and `totalPaying <= 0` check) already prevents saving without a selection.

