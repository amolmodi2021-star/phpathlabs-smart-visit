

## Goal
Fix the `loyalty-cards` cleanup so it actually removes the 118 files (54 MB) currently sitting in `generated/<UUID>/...` subfolders. Apply the same fix to `outsourced-snips` for safety.

## Root cause
`cleanup-card-images` lists only 3 hardcoded folders (`generated/crm`, `generated/abnormal`, `generated`). The real layout is `generated/<campaign-UUID>/<file>.png` — dozens of UUID subfolders that are never traversed. `.list("generated")` returns those UUIDs as folder placeholders (null `id`), and the existing code explicitly skips them. Net result: `scanned: 0`.

## Fix
Rewrite the listing logic to **recurse into every subfolder under `generated/`** instead of relying on a hardcoded list:

1. List `generated/` → get folder placeholders (entries with null `id`).
2. For each subfolder, list its contents (paginated, 1000 per page).
3. Apply the existing age filter (>6 hours old, via `created_at` or filename timestamp prefix).
4. Batch-remove eligible paths (100 per call), keeping the existing safety caps.

Also keep the original 3 hardcoded folders as a fallback in case any flat files exist directly under `generated/`.

Apply the same recursive pattern to `cleanup-outsourced-snips` so future subfolders won't break it either.

## Files

### Edit
- `supabase/functions/cleanup-card-images/index.ts` — replace the fixed-folder loop with a recursive walker (one level deep is enough; we don't need full recursion since files are always exactly one folder below `generated/`).
- `supabase/functions/cleanup-outsourced-snips/index.ts` — apply the same recursive walker pattern (defensive — current snips may be flat, but this future-proofs it).

No changes to `supabase/config.toml`, no migration, no frontend changes. The existing "Run Cleanup" button will start working immediately after redeploy.

## Verify after
- Click **Run Cleanup Now** on `loyalty-cards` → toast should report ~118 files removed (~54 MB freed).
- Refresh dashboard → `loyalty-cards` size drops near zero.
- Edge function logs should show `scanned: 118, deleted: 118`.

## Out of scope
- No new tables, no schema changes, no UI changes.
- No change to the 6-hour age threshold (still safe — protects in-flight WhatsApp deliveries).

