

# Cloudinary rate limit clarification

## The 500/hour limit only applies to ADMIN API calls, not uploads

Cloudinary has **two separate APIs** with very different limits:

| API | Rate limit (free tier) | What we use it for |
|---|---|---|
| **Upload API** | **Unlimited calls** (only metered by storage + bandwidth quotas) | Uploading the 5,000 card JPEGs every day — already in use today |
| **Admin API** | 500 calls/hour | Listing/deleting resources |

So sending 5,000 cards/day = 5,000 **upload** calls/day = **zero impact** on the 500/hour limit. Uploads are not throttled.

## Where the 500/hour limit actually applies in our plan

Only the new `delete-loyalty-cloudinary` edge function uses the Admin API.

The Admin `delete_resources` endpoint accepts **up to 100 public IDs per call**.

- Deleting a 5,000-card campaign = `ceil(5000 / 100)` = **50 Admin API calls**.
- Deleting a 50,000-card campaign = **500 Admin API calls** — exactly the hourly cap.

Realistic usage: you delete campaigns occasionally (not continuously), so 500/hour is far more headroom than you'll ever use. Even deleting ten 5,000-card campaigns back-to-back = 500 calls = still fits inside one hour.

## Safety guard we'll add

To make sure we never bump into the cap even in extreme cases, the edge function will:

1. Batch IDs in groups of 100 (Cloudinary's per-call max).
2. After every 400 batches in a single invocation, pause briefly (so we stay well under 500/hour even if you trigger a massive multi-campaign delete).
3. Return `{ deleted, failed, skipped }` so the UI can report any partial completion.

If a deletion ever does get rate-limited, the orphaned images simply age out via your existing **7-day Cloudinary auto-delete rule** — nothing leaks.

## Net answer to your question

- **Sending 5,000 cards/day**: not affected by the 500/hour limit. Uploads are unlimited.
- **Deleting campaigns**: 500 Admin calls/hour = enough to delete 50,000 cards per hour. Far above realistic delete frequency.
- **Worst case fallback**: 7-day auto-delete cleans up anything we miss.

## Plan stays the same as approved

| File | Change |
|---|---|
| `supabase/migrations/<new>.sql` | Drop `excel_data` column |
| `src/components/LoyaltyCardSender.tsx` | Remove `excel_data` from insert |
| `supabase/functions/delete-loyalty-cloudinary/index.ts` | New — signed Cloudinary delete with 100/batch + 400-batch pause guard |
| `src/components/LoyaltyCardHistory.tsx` | Call edge function before DB delete |

Secrets needed: `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`.

Approve to proceed.

