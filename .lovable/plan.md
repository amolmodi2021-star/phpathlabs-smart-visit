

# Plan: Improve Snip Image Quality in Print

## Problem
The `html-to-image` capture uses `pixelRatio: 2`, which produces a 2x resolution image. For text-based report pages this is acceptable, but snip images (which are already raster images) get double-sampled and lose sharpness — appearing blurry when printed.

## Solution
Increase `pixelRatio` from `2` to `4` in both the print and PDF export capture calls. This produces a 4x resolution PNG capture, which preserves much more detail from the snip images when they're rendered at print resolution (~300 DPI on paper). No other functionality changes.

## Technical Details

### `src/pages/LimsReportView.tsx`

**Line 375** (PDF export) — change `pixelRatio: 2` → `pixelRatio: 4`

**Line 412** (Print) — change `pixelRatio: 2` → `pixelRatio: 4`

### Files Modified
- `src/pages/LimsReportView.tsx` — 2 lines changed

