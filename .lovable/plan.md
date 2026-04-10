

# Swap Prev 2 and Prev 1 Column Order in Results Entry

## Problem
Currently the column order is: Code, Parameter, **Prev 1**, **Prev 2**, Result, ... — but the user wants **Prev 2 before Prev 1** so the chronological order reads left-to-right (older → newer → current result).

## Changes — `src/components/lims/ResultsEntry.tsx`

### 1. Swap table header labels (lines 1273-1274)
```
Before: Prev 1, Prev 2
After:  Prev 2, Prev 1
```

### 2. Swap renderHistoryCell calls in renderParamRow (lines 957-958)
```
Before: renderHistoryCell(p.parameterId, 0)  then  renderHistoryCell(p.parameterId, 1)
After:  renderHistoryCell(p.parameterId, 1)  then  renderHistoryCell(p.parameterId, 0)
```

This swaps the cells so index 1 (older/Prev 2) renders first, then index 0 (newer/Prev 1), matching the new header order.

## File
- `src/components/lims/ResultsEntry.tsx` — two small edits only

