

# Round 2: Close Remaining PNG Leaks + Tighten JPEG for Photo Backgrounds

## What's already working
The bulk ABC sender (`LoyaltyCardSender`) and drip abnormal sender (`dripCardSenders`) now correctly export downscaled JPEGs. Your new card was 86 KB (JPEG), confirmed in storage.

## Why it wasn't ~35 KB
Your card template uses a **136 KB photo/gradient PNG background**. Photo backgrounds compress to ~80–100 KB at JPEG q=0.72 (vs ~30 KB for flat-color designs). This is normal and unavoidable without changing the background or quality further.

## Remaining issues to fix

### Issue 1 — `CRMAbnormalTests.tsx` still exports PNG
Manual abnormal card sends from the CRM Abnormal Tests page bypass our optimization entirely (line 555 uses `"image/png"`). At your scale this leaks full-size PNGs to storage every time someone sends from CRM directly.

**Fix**: Switch to `exportCanvasAsCompressedJpeg()` and upload as `image/jpeg` with `.jpg` extension.

### Issue 2 — `generate-loyalty-card` edge function still uploads PNG
This edge function accepts a base64 PNG from the client and uploads it as PNG. Need to identify if it's still in use, and if so, switch the client to send JPEG instead (or keep as-is if unused).

**Fix**: Find callers; if active, convert to JPEG path. If unused, mark for deletion.

### Issue 3 — Lower quality lever for photo-style backgrounds (optional)
For your specific template (photo background → 86 KB at q=0.72), dropping to **q=0.62** would yield ~55–60 KB with minor visible compression artifacts on gradients. Acceptable for WhatsApp viewing on mobile.

**Decision needed from you**: Apply the lower quality globally, or only for specific templates? My recommendation: keep q=0.72 for now since 86 KB is still acceptable, and revisit only if monthly egress becomes a problem.

## Changes

1. **`src/components/crm/CRMAbnormalTests.tsx`** (lines ~554–561): Replace direct `toBlob("image/png")` + PNG upload with `exportCanvasAsCompressedJpeg(canvas)` + JPEG upload. Change file extension from `.png` to `.jpg`.

2. **`supabase/functions/generate-loyalty-card/index.ts`** + callers: Search for any code that calls this edge function. If found, change client to send JPEG base64 and edge function to upload as `image/jpeg` with `.jpg` extension. If no callers, leave alone (cron will purge old PNGs anyway).

## Expected result after fix
- All card flows produce JPEGs only
- Abnormal CRM sends drop from ~150 KB PNG → ~80 KB JPEG (~45% reduction)
- Photo-background ABC cards stay at ~86 KB (already optimal at current quality)

## Verification
1. Send 1 abnormal card from CRM Abnormal Tests page → check Cloud Usage; new file should be `.jpg` ~80 KB.
2. Send 1 ABC card from LoyaltyCardSender → already verified at 86 KB ✅.
3. Confirm bucket size growth per send is now consistently 60–90 KB across all flows.

## What I will NOT change
- Quality stays at 0.72 (your current optimum without visible degradation).
- Width cap stays at 800px.
- Template background swap (would need manual design work — let me know if you want guidance on which images compress better).

