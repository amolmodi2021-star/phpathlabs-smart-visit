
Goal: fix the report preview so the letterhead actually appears when the toggle is ON.

What I found
- The toggle logic is already correct in `src/pages/LimsReportView.tsx`.
- The real failure is in PDF.js worker loading:
  - `LimsReportView.tsx` uses `pdf.worker.min.mjs`
  - the project is pinned to `pdfjs-dist 3.11.174`
  - the working implementation in `src/components/lims/SnipOnLetterhead.tsx` uses `pdf.worker.min.js`
- Your runtime logs confirm this exact error:
  - `Cannot load script at: .../pdf.worker.min.mjs`
- Because of that, `convertPdfToImage()` fails, `letterheadImageUrl` stays `null`, and nothing is shown even when the toggle is on.

Implementation plan

1. Update the PDF.js worker path in `src/pages/LimsReportView.tsx`
- Change:
  - `pdf.worker.min.mjs`
- To:
  - `pdf.worker.min.js`
- This will match the installed PDF.js version and the existing working pattern already used elsewhere in the app.

2. Keep the current `fetch -> ArrayBuffer -> getDocument({ data })` approach
- That part is fine and can stay.
- The missing piece is the correct worker file, not the fetch logic.

3. Improve failure handling in `convertPdfToImage()`
- Keep the `console.error`
- Add a small visible fallback state/message only if conversion fails, so future breakage is easier to spot instead of silently rendering no letterhead.

4. Verify the render path in the report page
- Confirm `letterheadImageUrl && showLetterhead` now resolves truthy after the worker fix.
- Confirm the preview and downloaded PDF both include the letterhead when the toggle is ON and exclude it when OFF.

Optional cleanup I recommend while touching this file
- The console also shows React ref warnings for:
  - `LimsReportHeader`
  - `ReportSignatureBlock`
- These are not the cause of the missing letterhead, but I can clean them up in the same pass if needed by removing/refactoring any invalid ref usage around those components.

Files to update
- `src/pages/LimsReportView.tsx`

Expected result
- Refreshing the report page will show the letterhead by default.
- Turning the toggle OFF will hide it.
- Downloaded PDF will match the selected toggle state.

Technical note
- Root cause is version/worker mismatch, not a storage or toggle bug.
- `pdfjs-dist@3.11.174` should use the classic worker file:
  - `pdf.worker.min.js`
- The current `.mjs` URL is what is breaking runtime worker initialization.
