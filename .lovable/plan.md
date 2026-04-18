
## Root cause

Signatures in the report are rendered via:
```tsx
<img src={sig.signatureUrl} ... />
```
where `signatureUrl` is a Supabase Storage public URL (cross-origin from `lovable.app`).

`html-to-image` (used by both PDF download and image-based print) inlines images by drawing them to a canvas. For cross-origin images **without** `crossOrigin="anonymous"` set BEFORE the image loads, two things can happen:
1. Image renders fine on screen (browser doesn't care).
2. During capture, `html-to-image` tries to fetch/inline it. If CORS isn't pre-established (or the cached copy was loaded without `crossOrigin`), the image is silently skipped or the canvas is tainted and the request fails → **signature missing in PDF**.

This is exactly why the PDF intermittently misses signatures (Dr. Hemang Jadawala on pages 1 & 3) while the on-screen preview always shows them. Whether it works depends on browser image cache state and the order of loads — explaining the inconsistency between which signatures appear.

The same risk applies to:
- Letterhead image (already handled — it's converted to data URL via `convertPdfToImage` → toDataURL → safe ✓).
- Snip images (also Supabase Storage public URLs — same risk; user reported these are sometimes missing/blurry too).

## Fix plan

Convert all cross-origin images used in capture to **inline data URLs** before render, so `html-to-image` sees same-origin payloads it can rasterize without CORS issues.

### Changes in `src/pages/LimsReportView.tsx`

**1. Preload signature images as data URLs (in `loadAllData`)**

After building `sigMap`, fetch each `signatureUrl` and convert to a base64 data URL:

```ts
const urlToDataUrl = async (url: string): Promise<string | null> => {
  try {
    const res = await fetch(url, { mode: "cors", cache: "no-cache" });
    const blob = await res.blob();
    return await new Promise((resolve) => {
      const r = new FileReader();
      r.onloadend = () => resolve(r.result as string);
      r.onerror = () => resolve(null);
      r.readAsDataURL(blob);
    });
  } catch { return null; }
};

// After building info per signature:
if (sigUrl) {
  const dataUrl = await urlToDataUrl(sigUrl);
  if (dataUrl) info.signatureUrl = dataUrl;
}
```

This makes the signature `<img src="data:image/png;base64,...">` — guaranteed to rasterize.

**2. Same treatment for snip images (in `loadAllData`)**

After building `snipPages`, replace each `imageUrl` with its data URL equivalent. Snips are already at native resolution; converting to data URL doesn't re-encode pixels.

**3. Defensive: also add `crossOrigin="anonymous"` to the `<img>` tags**

For the signature `<img>` and snip `<img>`, add `crossOrigin="anonymous"` as a belt-and-braces measure (helps if step 1/2 ever falls back to original URL).

**4. Show a brief loader while images preload**

The data-URL conversion is asynchronous — keep the existing `setLoading(true)` covering it (it already does, since it's all inside `loadAllData`).

## Files
- `src/pages/LimsReportView.tsx` — add `urlToDataUrl` helper, preload signatures + snips into data URLs (~25 lines), add `crossOrigin` attrs on the two `<img>` tags.

## Out of scope
- No layout/pagination changes.
- No schema or RLS changes.
- No change to capture logic (JPEG/PNG split stays).

## Expected outcome
- All approved doctors' signatures appear correctly on every page of the downloaded PDF and printed output, matching the on-screen preview exactly.
- Snip images also become deterministic in the PDF (no more occasional missing/empty snips).
- File size unchanged (data URL is only used during render; the PDF still encodes via JPEG/PNG capture).
