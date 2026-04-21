

## Goal
Clarify what "Run Cleanup" can and should remove from `loyalty-cards`, and add a one-click way to nuke the reusable asset folders (`logos/`, `backgrounds/`) when you want a true zero-byte bucket.

## Current state (verified against storage.objects)
The `loyalty-cards` bucket holds only **5 files / 230 kB**:
- `logos/abnormal_<ts>.png` × 4  (cached lab logo renders)
- `backgrounds/<ts>.png` × 1  (cached campaign background)

All previous campaign output (`generated/<UUID>/<file>.png`, the 118 files that were 54 MB) is already deleted by the last cleanup run.

The `logos/` and `backgrounds/` files are **reusable assets** — re-uploaded automatically the next time a card is generated. Nothing is broken. The dashboard `54 MB` figure was a stale snapshot.

## Why "Run Cleanup" leaves them
By design, `cleanup-card-images` only walks `generated/` (the per-campaign output folder). `logos/` and `backgrounds/` are intentionally preserved to avoid re-uploading the same logo on every send.

## Fix — three small additions

### 1. Expand the cleanup walker
Update `cleanup-card-images/index.ts` to ALSO walk `logos/` and `backgrounds/` with the same 6-hour age filter. Files older than 6h get removed; the next card send re-creates them on demand. Same safety profile as `generated/`.

### 2. Show the real bucket size on the dashboard
The Cloud Usage dashboard reads from a snapshot RPC `get_cloud_usage_stats`. Confirm the **Refresh** button on the page top forces a re-fetch (it should — but verify after the cleanup is rerun the number drops to ~0 kB).

### 3. Add an explicit "Purge ALL" override for loyalty-cards
For the rare case you want to wipe even fresh assets: enable the existing **Purge** button (currently shown only for `report-uploads`) for `loyalty-cards` too. It already uses the password-gated `purge-bucket` edge function.

In `src/lib/cloudUsage.ts`, add `loyalty-cards` to `ORPHAN_BUCKETS`:
```ts
export const ORPHAN_BUCKETS = new Set(["report-uploads", "loyalty-cards"]);
```
Then `StorageBreakdown.tsx` will render the red **Purge** button next to it automatically.

## Files

### Edit
- `supabase/functions/cleanup-card-images/index.ts` — add `logos` and `backgrounds` to the top-level folder list (one-line change to the `topFolders` array on line 113).
- `src/lib/cloudUsage.ts` — add `"loyalty-cards"` to `ORPHAN_BUCKETS` so the **Purge** button appears.

### No changes
- `purge-bucket` function (already handles arbitrary buckets).
- Dashboard UI (button auto-renders for any orphan bucket).
- Cron schedule.

## Verify after
1. Click **Run Cleanup Now** on `loyalty-cards` → 4 logos + 1 background removed (they're all >6h old).
2. Refresh dashboard → bucket shows 0 files / 0 B.
3. Send any abnormal/loyalty card from the app → logos/backgrounds re-cached automatically (verify card renders correctly).
4. **Purge** button now visible for `loyalty-cards` for emergency use.

## Out of scope
- No changes to card-rendering logic.
- No retention-window changes (still 6 hours — safe for in-flight WhatsApp deliveries).

