

# Fix: Print Misalignment Due to Letterhead Spacing

## Problem
The report reserves a large top margin (`top_margin_cm`, likely ~2.5cm = 25mm) to position content below the letterhead. When printing via the browser's Print dialog, background images are hidden by default — so the letterhead disappears but the blank space remains, pushing content far down the page.

## Solution
Make the top/bottom padding conditional on the `showLetterhead` toggle:
- **Letterhead ON**: Use the configured `top_margin_cm` / `bottom_margin_cm` (current behavior)
- **Letterhead OFF**: Use a minimal print margin (e.g., 10mm top, 10mm bottom)

This affects two places in `src/pages/LimsReportView.tsx`:

### Changes

1. **Pagination logic** (line ~217): Use conditional margins when calculating `usableHeight` so content is paginated correctly for both modes
2. **Render padding** (line ~364, ~440): Apply the same conditional margins to the rendered page padding

```
// Conceptual change:
const topMm = showLetterhead ? layoutSettings.top_margin_cm * 10 : 10;
const bottomMm = showLetterhead ? layoutSettings.bottom_margin_cm * 10 : 10;
```

Both the `useMemo` pagination calculation and the render section use `topMm`/`bottomMm`, so both must reference `showLetterhead`.

### Files
- `src/pages/LimsReportView.tsx` — conditional margins based on `showLetterhead` state

No database changes needed.

