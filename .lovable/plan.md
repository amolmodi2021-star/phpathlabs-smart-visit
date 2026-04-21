

## Goal
Fix all action buttons on the **Cloud Usage** page. Two distinct bugs:

## Bug 1 — Purge button: "Direct deletion from storage tables is not allowed"
The `purge_bucket` SQL function uses `DELETE FROM storage.objects`, which Supabase blocks at the platform level. Only the Storage API can remove objects.

**Fix:** Replace the SQL purge with a new edge function `purge-bucket` that uses the Storage API:
1. List every object in the bucket via `supabase.storage.from(bucket).list()` (paginated, 1000 per page, recursive across folders).
2. Remove in batches of 100 via `supabase.storage.from(bucket).remove(paths)`.
3. Verify password (`9819111107`) inside the function.
4. Log result to `cleanup_runs`.
5. Return `{ files_removed, bucket }`.

Update `src/lib/cloudUsage.ts` → `purgeBucket()` to call `supabase.functions.invoke("purge-bucket", { body: { bucket, password } })` instead of the RPC.

The old `public.purge_bucket()` SQL function will be dropped in the migration to avoid confusion.

## Bug 2 — "Run Cleanup Now" / "Prune Now" / cron "Run Now" buttons silently fail
Edge functions `cleanup-card-images`, `cleanup-outsourced-snips`, `prune-old-logs`, and the new `purge-bucket` are **not listed in `supabase/config.toml`**, so they default to `verify_jwt = true`. The dashboard invokes them with only the anon key (the app uses custom auth via `user-auth`, not Supabase Auth, so there is no real Supabase JWT to send) → every call returns 401 and the toast shows a generic failure.

**Fix:** Add `[functions.<name>] verify_jwt = false` blocks for all four functions. They are already safe to call without JWT (cron calls them this way), and the destructive ones (`purge-bucket`, full-prune) are gated by the `9819111107` password dialog on the client.

## Files

### New
- `supabase/functions/purge-bucket/index.ts` — Storage-API-based bucket purger with password gate.

### Edit
- `supabase/config.toml` — add 4 `verify_jwt = false` blocks (`cleanup-card-images`, `cleanup-outsourced-snips`, `prune-old-logs`, `purge-bucket`).
- `src/lib/cloudUsage.ts` — change `purgeBucket()` to invoke the edge function instead of RPC; keep the same return shape so `StorageBreakdown.tsx` needs no change.

### Migration
- `DROP FUNCTION IF EXISTS public.purge_bucket(text, text);` (the broken SQL version).

## Verify after
- Click **Run Cleanup Now** on `loyalty-cards` → toast shows files removed.
- Click **Run Cleanup Now** on `outsourced-snips` → toast shows files removed.
- Click **Run Full Prune Now** in Database Tables → password prompt → toast shows per-table counts.
- Click **Run Now** on each cron job → toast shows success.
- Click **Purge** on `report-uploads` → password prompt → toast shows ~50 MB / file count freed.

## Out of scope
- No new cron jobs; no schedule changes.
- No UI redesign — only wiring fixes.

