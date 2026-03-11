

## Problem
The "Failed to send a request to the Edge Function" error occurs because the PDF-to-image conversion creates extremely large base64 payloads (scale 2.0, quality 0.85, up to 20 pages). This exceeds the edge function request body size limit (~6MB for Supabase Edge Functions). The function logs are empty, confirming the request never reaches the server.

## Solution
Two changes to fix this:

1. **Reduce image size dramatically** in `UploadReport.tsx`:
   - Lower render scale from `2.0` to `1.0` (still readable for AI extraction)
   - Lower JPEG quality from `0.85` to `0.6`
   - Limit max pages from 20 to 10
   - Cap canvas dimensions (max 1200px width)

2. **Send pages in batches** — if the PDF has multiple pages, send them to the edge function in smaller batches (e.g., 3 pages at a time) and merge results, OR send all pages but at much lower resolution.

Given that Gemini Flash can read lower-resolution images effectively, reducing size is the simplest and most reliable fix. A single page at scale 1.0 and quality 0.6 will be ~50-100KB vs ~500KB-1MB at the current settings.

### Files to modify:
- **`src/pages/UploadReport.tsx`**: Reduce scale to `1.0`, quality to `0.6`, cap canvas width at 1200px, and limit to 10 pages. Also add chunked processing — if total payload is still large, send pages in batches of 3 to the edge function and merge extracted results.

- **`supabase/functions/extract-report/index.ts`**: No changes needed if single-call approach works with smaller images. If batching is used, the function stays the same (called multiple times).

### Approach detail:
In `convertPdfToImages`, after rendering each page, resize the canvas if width exceeds 1200px. This ensures consistently small payloads regardless of source PDF resolution. The edge function remains unchanged.

