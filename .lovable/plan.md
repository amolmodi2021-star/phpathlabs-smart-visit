
Goal: make Print output exactly match the on-screen report/PDF, instead of letting the browser re-layout the live DOM.

What I found
- In `src/pages/LimsReportView.tsx`, the PDF path is reliable because it captures each `[data-page]` as an image with `html-to-image` and places that into A4 pages.
- The Print button still uses `window.print()` on the live DOM.
- That means the browser re-paginates the report again during print. Because this page uses normal-flow footer content, an inner content wrapper with `height: 100%` plus vertical padding, and no `box-sizing: border-box` on the page shell, tiny print-time layout differences push `Page 1 of 2` onto a new sheet.
- So this is not just a CSS page-break bug. The print engine is laying out a slightly different document than the one you see on screen / in the PDF.

Plan
1. Replace live-DOM printing with image-based printing
- Add a dedicated `handlePrint` in `src/pages/LimsReportView.tsx`.
- Reuse the same capture pipeline already used for PDF export:
  - wait for fonts/render
  - capture each `[data-page]` to PNG
  - open a clean print window
  - render one full-page image per A4 sheet
  - call `print()` only after all images load
- This guarantees the printed output matches the visible report exactly, page-for-page.

2. Refactor the report page shell to be deterministic
- Keep each page at exact A4 size with `boxSizing: "border-box"`.
- Move vertical page padding to the page shell or a fixed layout structure instead of using a `height: 100%` inner wrapper that also has top/bottom padding.
- Make signature + page number a fixed bottom/footer area, positioned like the more stable `ViewReport.tsx` approach.
- Give the main content region an explicit remaining height so it cannot push the footer into another physical page.

3. Simplify print CSS
- Remove reliance on the current complex `@media print` live-page pagination rules for the main report.
- Keep only minimal print CSS for the popup print document:
  - `@page { size: A4; margin: 0 }`
  - each printed sheet is `210mm x 297mm`
  - page break only between sheets, never inside one
- This avoids further blank/intermediate pages caused by browser interpretation of the app DOM.

4. Keep PDF and Print aligned
- Extract shared page-capture logic so both “Download PDF” and “Print” use the same rendered pages.
- This avoids future drift where PDF looks right but print looks different.

Files to update
- `src/pages/LimsReportView.tsx`

Technical details
- New flow:
  1. Screen renders report pages
  2. Print captures those pages as images
  3. Print window prints only those captured A4 images
- I will follow the existing safe capture patterns already used in:
  - `LimsReportView.tsx` PDF export
  - `DirectAI.tsx` off-screen/sandbox capture approach
  - `ViewReport.tsx` fixed footer/page shell layout pattern

Expected result
- No extra middle page
- No footer text spilling to another page
- Printed output matches the displayed report and generated PDF exactly
- Stable A4 output regardless of browser print reflow quirks
