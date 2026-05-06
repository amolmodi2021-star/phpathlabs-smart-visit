# Cloudinary Account Manager in WhatsApp Settings

## Goal
Let admins register multiple named Cloudinary accounts in WhatsApp Settings, mark exactly one as **Active**, and have all card image uploads (Loyalty/ABC cards + Abnormal History cards) use the active account automatically. Switching the active account later seamlessly routes all subsequent uploads to the new one.

## Where things live today
- `src/lib/cardStorageCloudinary.ts` hard-codes `CLOUD_NAME = "dd7qn3t3d"` and `UPLOAD_PRESET = "phpathlabs_cards"` and uses unsigned upload.
- Used by: `src/lib/cardRenderer.ts`, `src/lib/dripCardSenders.ts`, `src/components/LoyaltyCardSender.tsx`, `src/components/AbnormalBulkSender.tsx`.
- Cleanup edge function `supabase/functions/delete-loyalty-cloudinary/index.ts` uses `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET` secrets + same hard-coded cloud name.
- WhatsApp Settings page: `src/pages/WhatsAppSettingsPage.tsx` + `src/components/WhatsAppSettings.tsx`.

## Data model (new table)
Create `cloudinary_accounts`:
- `id uuid pk`
- `account_name text` (user-given label, unique)
- `cloud_name text` (Cloudinary cloud name)
- `upload_preset text` (unsigned upload preset)
- `is_active boolean default false`
- `created_at`, `updated_at` timestamps
- RLS: permissive (matches existing settings tables).
- Trigger / app-side write to enforce single active row (set others to false on activate).

Note: API key/secret for the **delete** function stay as Supabase secrets per cloud account. We will add optional `api_key` / `api_secret_secret_name` columns but the actual secret value is still stored via Lovable Cloud secrets (the user adds `CLOUDINARY_API_KEY_<slug>` if they want deletion for that account). Initial scope can store the api_key in the row for unsigned-upload accounts since deletion uses signed Admin API; we'll prompt the user if they want signed deletion support.

## UI: new "Cloudinary Accounts" section in WhatsApp Settings
In `src/components/WhatsAppSettings.tsx` add a new card below the existing one:
- Table of accounts: Name | Cloud Name | Upload Preset | Active (radio) | Edit | Delete.
- "Add Account" button → dialog with fields: Account Name, Cloud Name, Upload Preset, (optional) API Key, (optional) API Secret.
- Activating an account flips `is_active` to true for that row and false for all others (single update transaction).
- Inline test button that uploads a 1x1 pixel to verify credentials and shows toast.

## Runtime wiring (active account → uploads)
1. Add `src/lib/cloudinaryAccount.ts` with:
   - `getActiveCloudinaryAccount()` → fetches the active row (cached in-memory for 60s + invalidated on settings save).
   - `uploadJpegToActiveCloudinary(blob)` → uses active row's `cloud_name` + `upload_preset`.
2. Update `src/lib/cardStorageCloudinary.ts`:
   - Replace constants with a runtime lookup. Export `uploadJpegToCloudinaryWithRetry(blobFn)` unchanged in signature, but internally it resolves the active account first; throws `cloudinary_not_configured` if none.
3. No changes needed in callers (`cardRenderer.ts`, `dripCardSenders.ts`, `LoyaltyCardSender.tsx`, `AbnormalBulkSender.tsx`) — they keep calling `uploadJpegToCloudinaryWithRetry`.

## Edge function update (deletion)
`supabase/functions/delete-loyalty-cloudinary/index.ts`:
- Accept optional `cloudName`, `apiKey`, `apiSecret` from request body OR fall back to the active row queried via service-role client.
- Caller (cleanup cron) passes the active account's cloud name; if api key/secret per account isn't stored in DB, it falls back to the existing `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET` env vars (back-compat for the legacy "dd7qn3t3d" account).

## Migration
- Create `cloudinary_accounts` table + permissive RLS.
- Seed with the existing hard-coded account so nothing breaks on first deploy:
  `('Default', 'dd7qn3t3d', 'phpathlabs_cards', true)`.

## Behavior summary
- Multiple accounts can exist; exactly one active.
- All Loyalty/ABC + Abnormal card uploads use the currently-active account.
- Switching active account immediately reroutes new uploads; old image URLs remain valid (they live on whichever account uploaded them).
- Cleanup function continues to delete from the account it knows credentials for.

## Files to touch
- New: `supabase/migrations/<ts>_cloudinary_accounts.sql`
- New: `src/lib/cloudinaryAccount.ts`
- Edit: `src/lib/cardStorageCloudinary.ts` (dynamic cloud_name/preset)
- Edit: `src/components/WhatsAppSettings.tsx` (new section + dialog)
- Edit: `supabase/functions/delete-loyalty-cloudinary/index.ts` (per-account creds)

## Open question (will ask after approval if unclear)
Should deletion of old card images for non-default accounts also be supported now? It requires storing API key/secret per account (acceptable since RLS is permissive but values are sensitive). Default plan: store them in the row, only used server-side by the edge function.
