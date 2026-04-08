

## Problem

The `pdfjs-dist` v4.x uses **top-level await** in its source, which is incompatible with Vite's default esbuild target (`es2020`). This crashes the entire app — not just the snipping page.

## Solution

Two changes are needed:

### 1. Downgrade `pdfjs-dist` to v3.11.174
Version 3.x doesn't use top-level await and works perfectly with Vite 5. The API is identical for what we use (loading PDF, rendering page to canvas).

- Update `package.json`: `"pdfjs-dist": "3.11.174"`
- Update the worker URL in `SnipOnLetterhead.tsx` to match v3 format

### 2. Update worker source URL in SnipOnLetterhead.tsx
Change the worker initialization to use the matching v3 CDN URL:
```
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js`;
```

### Files to modify
- `package.json` — pin `pdfjs-dist` to `3.11.174`
- `src/components/lims/SnipOnLetterhead.tsx` — hardcode worker URL to v3

This will immediately restore the app to a working state.

