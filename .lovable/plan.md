

# Mobile-Friendly Results Entry Section

## Problems Found
1. **Parameter table has 10 columns** with fixed widths totaling ~1000px — overflows on mobile (390px)
2. **Test header bar** has long "Transfer to Outsourced" button text that doesn't fit
3. **Patient card header** has too many inline elements (name, badges, progress bar, counts) — wraps poorly
4. **Search + Tabs bar** stacks awkwardly on small screens
5. **Blank confirmation dialog** table also has 8 columns, same overflow issue

## Approach
Rather than hiding columns (which would lose critical clinical data), wrap all tables in horizontal scroll containers and make the non-table UI elements stack vertically on mobile.

## Changes — `src/components/lims/ResultsEntry.tsx`

### 1. Wrap parameter tables in scroll container
Add `<div className="overflow-x-auto -mx-1">` around all `<Table>` elements inside the expanded patient view (line ~1414) and the blank confirmation dialog (line ~1635).

### 2. Mobile-stack the test header bar (line ~1359-1411)
Change the test name + "Save & Verify" / "Transfer to Outsourced" row from `flex items-center justify-between` to `flex flex-col sm:flex-row` on mobile. Shorten "Transfer to Outsourced" to just an icon on small screens.

### 3. Mobile-stack the patient card header (line ~1551-1597)
- Move the progress bar + pending count below the patient name on mobile using `flex-wrap`
- Stack badges vertically on narrow screens

### 4. Mobile-stack search + tabs bar (line ~1446-1488)
Change to `flex flex-col sm:flex-row` so search goes full-width above tabs on mobile.

### 5. Snip-only test rows (line ~1315-1329)
Add `flex-wrap` so the test name and buttons wrap on mobile instead of overflowing.

### Single file
- `src/components/lims/ResultsEntry.tsx`

