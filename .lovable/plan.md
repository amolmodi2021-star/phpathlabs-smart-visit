
## Goals
1. Shrink PDF size from ~170MB → 1–2MB.
2. Keep snip-on-letterhead images at native quality (no blur).
3. Honour top/bottom margins; never overflow into doctor signature.

## Root cause recap
- `LimsReportView.handleDownloadPdf` rasterizes each A4 page as **PNG @ pixelRatio 4** → ~14 MP per page → ~40MB/page.
- Snip pages are *already* the source-quality screenshot embedded in the page. Re-rasterizing the whole page at high DPI doesn't improve them — it just bloats every other page.
- Signature overflow: snip placement uses a single `topMarginPct` but no bottom guard, so a tall snip can extend past the signature band.

## Fix plan

### 1. Smart per-page rasterization (`src/pages/LimsReportView.tsx`)
Detect snip pages vs. text pages and rasterize differently:

- **Text/results pages** (no `<img data-snip>` inside): JPEG, `quality 0.92`, `pixelRatio 2`. → ~250–500 KB/page.
- **Snip pages** (contains a snip image): embed the **original snip image bytes directly** into the PDF via `pdf.addImage(snipUrl, ...)` positioned over the letterhead background, instead of rasterizing the whole page. Letterhead + header + signature band get rendered as a separate light JPEG layer. This preserves snip pixels 1:1 (zero re-encoding) while keeping everything else small.
  - Simpler fallback if dual-layer is risky: rasterize snip page as **PNG @ pixelRatio 2** (snip is already the bottleneck for clarity, pixelRatio 2 ≈ 192 DPI which matches snip native resolution without upscaling artifacts). Keep all other pages as JPEG.
  - Will go with the **simpler fallback** first — it's deterministic and matches existing layout math.

Net result: 4-page mixed report ≈ 1–3 MB; snip clarity unchanged from current.

### 2. Mark snip pages
Add `data-has-snip="true"` on the page wrapper in `ReportResultsSection` (or detect at capture time via `el.querySelector('img[alt^="Snip"]')`). Detection at capture time avoids touching the renderer.

### 3. Bottom-margin guard for snips (`src/components/lims/SnipOnLetterhead.tsx` is the editor; the **renderer** lives in the report page generator — likely `ReportResultsSection` or a dedicated snip page component)
Need to inspect where snips render inside the A4 page during report generation (not the editor). Add CSS:
- Snip image container: `max-height: calc(297mm - topMargin - bottomReservedForSignature)`.
- Reserve ~35mm at bottom for signature band (matches existing signature block height).
- `object-fit: contain` so tall snips scale down rather than overflow.

### 4. Print path (`handlePrint`)
Same JPEG-for-text / PNG-pixelRatio-2-for-snip split. Faster print preview, identical visual output.

## Files to edit
- `src/pages/LimsReportView.tsx` — capture logic split (text=JPEG, snip=PNG@2), apply to both PDF and Print paths.
- Snip render component inside the report (to be located — likely `src/components/report/ReportResultsSection.tsx` or a dedicated snip page) — add `max-height` + bottom signature reservation.

## Out of scope
- No change to snip editor (`SnipOnLetterhead.tsx`) — capture quality on the snipping side is unchanged.
- No change to A4 dimensions, pagination engine, or signature snapshotting.
- `pixelRatio: 4` stays for loyalty cards / abnormal cards / receipts.

## Expected outcome
| Metric | Before | After |
|---|---|---|
| 4-page PDF (mixed) | ~170 MB | ~1–3 MB |
| Snip clarity | current | identical |
| Signature overflow | possible | prevented (max-height + reserve) |
| Generation time | 30–60s | 4–8s |
