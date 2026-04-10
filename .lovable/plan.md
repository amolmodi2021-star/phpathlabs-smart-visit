

# Plan: Reduce Test Name Header Border Thickness

## Problem
The test name header box uses `border-2` (2px) which is thicker than the parameter table row borders (`border-b border-gray-100`, which is 1px).

## Change — `src/components/report/ReportResultsSection.tsx`

**Line 304**: Change `border-2 border-gray-600` to `border border-gray-600` (1px border instead of 2px), matching the parameter row border thickness.

### Files Modified
- `src/components/report/ReportResultsSection.tsx` — 1 line changed

