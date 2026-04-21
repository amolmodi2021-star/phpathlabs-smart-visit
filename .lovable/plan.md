

# Reduce ABC/Abnormal Card Egress — JPEG Optimization (Phase 1)

## Goal

Cut WhatsApp image egress by ~55% with a tiny code change. Stays compatible with AOC's URL-based image header (the only option AOC supports per their public docs).

## Why this is the right move now

AOC's documented WhatsApp template API only accepts `image: { link: "https://..." }` — there is **no media upload endpoint** in their public docs. So we cannot eliminate egress while staying on AOC. The next-best lever is making each JPEG significantly smaller. Combined with the existing daily cleanup cron, this keeps storage flat and slashes egress.

## Changes

### 1. `src/lib/cardRenderer.ts` — `generateAndUploadCard()`

Before calling `canvas.toBlob`, downscale the canvas to a max width of 800px (preserving aspect ratio), then export at JPEG quality 0.72 instead of 0.85.

```text
- toBlob(..., "image/jpeg", 0.85)
+ resize-canvas-to-max-800px-width
+ toBlob(..., "image/jpeg", 0.72)
```

Implementation: render at full resolution onto the existing canvas (so placeholder math stays correct), then copy to a smaller off-screen canvas at the target width before exporting. This preserves all positioning logic and only affects the output file.

### 2. `src/components/LoyaltyCardSender.tsx` — `renderCard()` / on-screen render path

Same two changes (resize to 800px max, quality 0.72) applied to the in-component renderer used for ABC sends.

### 3. `src/lib/dripCardSenders.ts` — abnormal card render path

Same two changes for the drip engine's abnormal card flow.

## Expected impact (5,000/day baseline)

| Metric | Today | After Phase 1 |
|---|---|---|
| JPEG size | ~80 KB | ~35 KB |
| Daily storage write | ~400 MB | ~175 MB |
| Monthly egress (WhatsApp fetches) | ~12 GB | ~5 GB |

At 80,000/day this scales linearly: monthly egress drops from ~190 GB to ~85 GB.

## Out of scope (deferred)

- **WhatsApp media upload (Option A)** — not supported by AOC per current public docs. If you confirm with AOC support that they offer an undocumented `/media` endpoint, we add it as Phase 2 and egress drops to ~0.
- **Cloudinary migration** — only worthwhile if Supabase egress costs become painful after Phase 1 measurements. Not justified at current volume.
- **BSP switch** — large migration, only consider if 80k/day economics demand it AND AOC confirms no media upload.

## Verification after deploy

1. Send 5 test ABC cards via the existing flow.
2. Open the public URL of one and inspect: file should be ~30–40 KB and visually identical (text crisp, barcode scannable).
3. Confirm the card displays correctly when delivered to a test WhatsApp number.
4. Check `loyalty-cards` bucket in Cloud Usage — daily growth should drop ~55%.

## Action item for you (parallel to this work)

Email AOC support: *"Does your WhatsApp API support uploading media to receive a reusable media_id, as an alternative to sending `image.link` URLs?"* If yes, we plan Phase 2.

