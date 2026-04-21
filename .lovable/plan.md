

## Goal
Make `cleanup-outsourced-snips` actually delete old snip files. Two real bugs:

## Root cause
1. **`outsourced_test_snips` table is empty** (0 rows) — every file in the bucket is an orphan from the lab's POV. The current code only deletes via this table → always 0.
2. **Orphan path uses 365-day retention** — every file is currently <2 weeks old, so nothing qualifies. And the filename regex `/^(\d{12,16})_/` never matches because filenames are `<uuid>_<uuid>_<ms>.png` (timestamp is at the END, not the start).
3. Storage `created_at` is the source of truth for age, but the code never reads it.

## Fix
Rewrite the function around two simple rules:

**Rule A — Use storage `created_at`, not filename:**
While walking the bucket with `.list()`, capture each file's `created_at` directly from the API response (already returned). Compare to cutoff. Delete if older.

**Rule B — Configurable retention, default 30 days:**
365 days is far too long for transient lab snips (the loyalty-cards bucket uses 6 hours). Drop the default to **30 days**, override via request body `{ max_age_days: N }`. Cron will keep using the default; the dashboard "Run Cleanup Now" button can pass `max_age_days: 0` to purge all (it's still password-gated by the dashboard for any aggressive value).

**Rule C — Stop using the empty `outsourced_test_snips` table:**
Skip the DB-driven branch entirely. Treat every file as bucket-owned and age-filtered. (The DB table can stay; we just don't need it for deletion.)

## Files

### Edit
- `supabase/functions/cleanup-outsourced-snips/index.ts` — replace the listAllFiles-with-filename-regex path with: walk bucket → for each file capture `created_at` → delete if `now - created_at > max_age_days`. Default 30 days. Reads optional `max_age_days` from JSON body.

### No changes
- `cleanup_runs` schema, dashboard UI, cron schedule, or `outsourced_test_snips` table.

## Verify after
- Click **Run Cleanup Now** on `outsourced-snips` (default 30 days) → toast shows ~0 files (nothing is 30+ days old yet) — but it's now correct logic.
- For an immediate test: temporarily invoke with `{ max_age_days: 7 }` from the dashboard → should remove ~25 files (the 26 dated 2026-04-08 to 2026-04-14).
- Subsequent daily cron will keep the bucket trimmed automatically.

## Optional follow-up (not in this fix)
- Add a small input field on the Cloud Usage row for `outsourced-snips` letting you pick the age threshold per click. Skipping unless you want it.

## Out of scope
- No DB schema change.
- No new RPCs.
- No change to `cleanup-card-images` (already fixed last round and working — logs show `deleted: 118`).

