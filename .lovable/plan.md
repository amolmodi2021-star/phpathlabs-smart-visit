

# Fix: Print Without Opening New Tab

## Current Issues
1. **New tab opens** — `window.open("", "_blank")` creates a visible Chrome tab. User wants only the print dialog.
2. **Images not stored in DB** — Confirmed: images are base64 data URLs generated in-memory, never sent to any server/database. No change needed.
3. **Image quality** — Already using `pixelRatio: 2` which is high quality. No change needed.

## Solution
Replace `window.open("", "_blank")` with a **hidden iframe** approach:
- Create a temporary hidden `<iframe>` in the current page
- Write the same HTML/images into the iframe
- Call `iframe.contentWindow.print()` to trigger the print dialog
- Remove the iframe after printing

This shows only the native print dialog — no new tab, no visible window.

## Changes in `src/pages/LimsReportView.tsx`

Replace lines 378-428 (the `window.open` + print logic) with:

```typescript
// Create hidden iframe for printing
const iframe = document.createElement("iframe");
iframe.style.position = "fixed";
iframe.style.top = "-10000px";
iframe.style.left = "-10000px";
iframe.style.width = "210mm";
iframe.style.height = "297mm";
document.body.appendChild(iframe);

const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
if (!iframeDoc || !iframe.contentWindow) {
  toast.error("Print failed");
  document.body.removeChild(iframe);
  setDownloading(false);
  return;
}

iframeDoc.open();
iframeDoc.write(`
  <html>
    <head>
      <style>
        @page { size: A4; margin: 0; }
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { width: 210mm; }
        .print-page { width: 210mm; height: 297mm; overflow: hidden; page-break-after: always; }
        .print-page:last-child { page-break-after: auto; }
        .print-page img { display: block; width: 210mm; height: 297mm; }
      </style>
    </head>
    <body>
      ${imageUrls.map(url => `<div class="print-page"><img src="${url}" /></div>`).join("")}
    </body>
  </html>
`);
iframeDoc.close();

// Wait for images to load, then print
const images = iframeDoc.querySelectorAll(".print-page img");
let loadedCount = 0;
const onAllLoaded = () => {
  setTimeout(() => {
    iframe.contentWindow!.focus();
    iframe.contentWindow!.print();
    setTimeout(() => document.body.removeChild(iframe), 1000);
  }, 300);
};

if (images.length === 0) onAllLoaded();
else {
  images.forEach(img => {
    (img as HTMLImageElement).onload = () => { loadedCount++; if (loadedCount === images.length) onAllLoaded(); };
    (img as HTMLImageElement).onerror = () => { loadedCount++; if (loadedCount === images.length) onAllLoaded(); };
  });
}
```

## Summary
- **No new tab** — hidden iframe triggers print dialog directly
- **No DB storage** — images are in-memory base64, discarded after print
- **Same quality** — identical capture settings (pixelRatio: 2)

## Files
- `src/pages/LimsReportView.tsx`

