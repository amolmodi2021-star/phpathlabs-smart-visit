## Fix Provisional Watermark Overflow

The "PROVISIONAL REPORT" text currently uses `fontSize: 92px` + `letterSpacing: 8px` rotated -35°, which projects wider than the A4 page (210mm) and bleeds past the left/right edges.

### Change

In `src/pages/LimsReportView.tsx` (lines 1060–1080), update the watermark wrapper and span:

- Constrain the wrapper with horizontal padding so the rotated text cannot reach the page edge:
  - Add `padding: "0 20mm"` and `overflow: "hidden"` to the absolute container.
- Reduce the text size so even rotated it fits inside the A4 inner width:
  - `fontSize: "64px"` (was 92px)
  - `letterSpacing: "6px"` (was 8px)
  - Keep rotation at `-35deg`, opacity/color unchanged.
- Keep `whiteSpace: "nowrap"` and `pointer-events: none`.

This keeps the watermark centered, light, and diagonal — but fully contained within the page borders with comfortable side margins. No other files affected.