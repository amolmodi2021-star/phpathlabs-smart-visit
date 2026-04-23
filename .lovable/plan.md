

# Stop storing Excel data + auto-delete Cloudinary images on campaign delete

## What you asked for

1. **Confirm impact of large Excel uploads on cloud usage**
2. **Stop persisting uploaded Excel rows in the database**
3. **Auto-delete Cloudinary card images when a campaign is deleted**

---

## 1. Cloud usage impact of large Excel uploads (current state)

- Each upload is parsed in the browser, then the **full row array is stored as JSONB** in `loyalty_card_jobs.excel_data`.
- For your 1,653-row campaign that column is **~51 KB** (small, but it scales linearly — a 50k-row file would be ~1.5 MB per job).
- **Card images are NOT in Lovable Cloud Storage** — they go to Cloudinary (free tier). So Excel size only affects the Postgres row, not storage egress.
- **Conclusion:** today's load is negligible, but `excel_data` is dead weight after generation finishes — there's no code that ever reads it back. Removing it is a clean win.

---

## 2. Stop storing Excel data in the database

**Schema change** (migration):
- Drop column `loyalty_card_jobs.excel_data`.
- The per-row data we actually need (name, mobile, UMR, discount, expiry, image URL, status) is already saved in the `loyalty_cards` table during generation. Nothing else reads `excel_data`.

**Code change** (`src/components/LoyaltyCardSender.tsx`):
- Remove `excel_data: excelData as any` from the `loyalty_card_jobs` insert.
- The Excel file itself stays in the user's browser only — never uploaded anywhere.

Result: campaigns store only the job row (a few hundred bytes) + per-card rows (already needed for status tracking).

---

## 3. Auto-delete Cloudinary images when a campaign is deleted

### How it has to work

Cloudinary deletion requires a **signed Admin API call** (cloud name + API key + API secret). The browser cannot do this safely, so the delete flow becomes:

1. User clicks **Delete Selected** / **Delete All** in Loyalty Cards → History.
2. Password gate (unchanged).
3. Frontend collects `image_url`s from `loyalty_cards` for the chosen jobs and calls a new edge function `delete-loyalty-cloudinary` with the list of public IDs.
4. Edge function deletes them from Cloudinary in batches via `/resources/image/upload` DELETE (up to 100 per call).
5. Frontend then deletes the DB rows (`loyalty_cards` then `loyalty_card_jobs`) — same as today.

If Cloudinary deletion partially fails (network blip), the DB delete still proceeds and the orphaned images get swept later by the existing `cleanup-card-images` cron pattern (we'll extend it to scan Cloudinary too — see "Optional safety net" below).

### New edge function: `delete-loyalty-cloudinary`

- Accepts `{ publicIds: string[] }`.
- Uses Cloudinary Admin API with HMAC-SHA1 signature (Deno `crypto.subtle`).
- Batches in groups of 100 (Cloudinary limit).
- Returns `{ deleted, failed }`.

### Required secrets (you'll need to add these once)

| Secret name | Where to get it |
|---|---|
| `CLOUDINARY_API_KEY` | Cloudinary Dashboard → Settings → API Keys |
| `CLOUDINARY_API_SECRET` | Same screen (click "Reveal") |

Cloud name (`dd7qn3t3d`) is already hard-coded in `cardStorageCloudinary.ts`, so no third secret is needed.

I'll prompt you for these via the secrets dialog when implementation starts.

### Helper: extracting the Cloudinary public ID

`secure_url` looks like
`https://res.cloudinary.com/dd7qn3t3d/image/upload/v1234567890/abc123xyz.jpg`
The public ID is the path after `/upload/v\d+/` minus the extension (`abc123xyz`). A small parser in the edge function handles this.

### Optional safety net (recommended, low effort)

Extend `cleanup-card-images` (or add `cleanup-cloudinary-orphans`) to run nightly: list Cloudinary resources in the `loyalty-cards` folder older than 7 days that have no matching `loyalty_cards.image_url` in the DB, and delete them. Catches any image whose delete call failed transiently. Can be added now or later.

---

## Files touched

| File | Change |
|---|---|
| `supabase/migrations/<new>.sql` | `ALTER TABLE loyalty_card_jobs DROP COLUMN excel_data;` |
| `src/components/LoyaltyCardSender.tsx` | Remove `excel_data` from insert |
| `supabase/functions/delete-loyalty-cloudinary/index.ts` | **New** — signed Cloudinary delete |
| `src/components/LoyaltyCardHistory.tsx` | In `handleDeleteConfirmed`, fetch image URLs → invoke edge function → then delete DB rows |
| `supabase/functions/cleanup-card-images/index.ts` (optional) | Add Cloudinary orphan sweep |

## What you'll see after deploy

- Uploading a 50k-row Excel: zero DB growth from the file itself.
- Deleting a campaign: cards vanish from Cloudinary within a few seconds, DB rows go too.
- Existing campaigns: deleting them now will also clean up their Cloudinary images (no migration needed for old data).

## Risk

Low. Schema drop is for an unused column. Edge function is small and isolated. Delete flow keeps password protection and remains atomic from the user's perspective.

