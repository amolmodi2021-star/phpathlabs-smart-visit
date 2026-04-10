

# Print Always Without Letterhead

## What changes
When the **Print** button is clicked, the report will always render **without the letterhead background**, regardless of the toggle state. The **With Letterhead** toggle will only affect the **Download PDF** button and the on-screen preview.

## How

In `src/pages/LimsReportView.tsx`:

1. **In `handlePrint`** — Before capturing pages as images, temporarily set `showLetterhead` to `false`, wait for a re-render, capture pages, then restore the original value.

   Specifically:
   - Save current `showLetterhead` value
   - Set `showLetterhead` to `false`
   - Use a short `await new Promise(r => setTimeout(r, 100))` to let React re-render without the letterhead background
   - Capture all `[data-page]` elements as PNGs (existing logic)
   - Restore `showLetterhead` to its previous value
   - Continue with iframe print as before

2. No changes to the toggle UI — it remains visible and continues to control the PDF download and on-screen preview.

## File
- `src/pages/LimsReportView.tsx` — modify `handlePrint` function (~5 lines added)

