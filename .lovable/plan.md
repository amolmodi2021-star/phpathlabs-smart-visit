

# Fix: Letterhead Not Showing When Toggle Is On

## Problem
The letterhead PDF is correctly stored and the toggle is working, but the `convertPdfToImage` function (which uses `pdfjs-dist` to render the PDF to a canvas) is silently failing — its `catch` block returns `null`, so `letterheadImageUrl` stays `null` and no image is rendered regardless of the toggle state.

This is likely a CORS or PDF worker loading issue with `pdfjs-dist`.

## Solution
Add error logging to diagnose, and also add a more robust fallback approach:

### Changes to `src/pages/LimsReportView.tsx`

1. **Add console.error to the catch block** in `convertPdfToImage` so failures are visible during debugging.

2. **Add a fallback approach**: If PDF-to-image conversion fails, fall back to rendering the letterhead as an `<iframe>` or `<object>` element (similar to how `ReportLayoutSettings.tsx` successfully previews it). However, for PDF download purposes, iframes won't work.

3. **Better approach — fetch PDF as blob to avoid CORS**: Instead of passing the URL directly to `pdfjsLib.getDocument()`, fetch the PDF as an `ArrayBuffer` first using `fetch()`, then pass the buffer to `pdfjsLib.getDocument()`. This avoids CORS issues with the worker.

```typescript
const convertPdfToImage = async (pdfUrl: string) => {
  try {
    // Fetch as ArrayBuffer to avoid CORS issues
    const response = await fetch(pdfUrl);
    const arrayBuffer = await response.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    await page.render({ canvasContext: ctx, viewport }).promise;
    return canvas.toDataURL("image/png");
  } catch (err) {
    console.error("Failed to convert letterhead PDF to image:", err);
    return null;
  }
};
```

This single change to the `convertPdfToImage` function should fix the letterhead rendering. The toggle logic itself is already correct.

## Files Modified
- `src/pages/LimsReportView.tsx` — Update `convertPdfToImage` to fetch PDF as ArrayBuffer and add error logging

