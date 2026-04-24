
# Send Abnormal Cards — bulk Excel sender (zero-persistence)

## Scope confirmation

- New tab in `/loyalty-cards` to upload an Excel of abnormal test results, group by `${UMR}|${MOBILE}` primary key, generate one PNG per primary key, send via WhatsApp.
- **Nothing is persisted**: no DB rows, no `loyalty_card_jobs`, no `loyalty_cards`, no `message_send_log`, no `crm_contacts.last_sent_*` updates, no Excel data stored.
- Cloudinary upload is still required (WhatsApp template `header.image.link` needs a public URL). Existing 7-day Cloudinary auto-delete cleans those images automatically — same as the current loyalty card path.

## Excel format

| Column | Required |
|---|---|
| UMR | Yes |
| Mobile | Yes (10-digit; normalized) |
| Test Name | Yes |
| Test Date | Yes (dd-mm-yyyy) |
| Result | Yes |
| Ref Range | Yes |

Sample file: `public/samples/Sample_Abnormal_Bulk_Send.xlsx`.

## Grouping logic

1. Parse Excel client-side (`parseExcelFile`).
2. Normalize each row's mobile to 10 digits; skip rows where mobile or UMR is missing/invalid.
3. Build groups keyed by `${UMR}|${normalizedMobile}` — same UMR with different mobiles produces separate groups (separate cards).
4. Within each group, sort tests **descending by `test_date`** (latest on top) using existing `sortAbnormalTestsByDateDesc` from `src/lib/abnormalTests.ts`.
5. One card per primary key → one WhatsApp send to that mobile only.

## Card rendering

Reuse the existing abnormal-card canvas renderer logic from `src/components/crm/CRMAbnormalTests.tsx` (`generateAbnormalCard`) by extracting it into a shared helper:

- New file: `src/lib/abnormalCardRenderer.ts`
- Exports `renderAbnormalCardCanvas({ patientName, mobile, umr, tests, template, expiryDate })` returning a `Blob` (compressed JPEG).
- `CRMAbnormalTests.tsx` is refactored to call this helper (no behavior change there).
- Uses the selected `abnormal_card_templates` row for layout (same template picker as today).

## Sending flow

For each group:
1. Render card → JPEG blob (in-browser, never saved locally).
2. Upload blob to Cloudinary via `uploadJpegToCloudinaryWithRetry` → public URL.
3. Build WhatsApp template payload (`header.image.link = url`, body variables populated from group data using template's variable mapping — mirrors `LoyaltyCardSender`'s send path).
4. Call `whatsapp-proxy` edge function.
5. Discard blob and URL from memory. **No DB write of any kind.**
6. Pace sends with the global `wa_global_delayMs` from `app_settings` (read-only).

UI shows progress: `current / total` + per-row status (✓ sent / ✗ failed) in an in-memory list that is cleared on tab change or refresh.

## Files touched

| File | Change |
|---|---|
| `src/lib/abnormalCardRenderer.ts` | **New** — shared canvas renderer extracted from CRMAbnormalTests |
| `src/components/crm/CRMAbnormalTests.tsx` | Refactor to call shared renderer (no functional change) |
| `src/components/AbnormalBulkSender.tsx` | **New** — Excel upload, grouping, preview, send loop |
| `src/pages/LoyaltyCards.tsx` | Add 4th tab `Abnormal Cards` |
| `public/samples/Sample_Abnormal_Bulk_Send.xlsx` | **New** — column header template |

## What does NOT change

- No DB migration.
- No new edge function.
- No changes to `message_send_log`, `crm_contacts`, `crm_abnormal_tests`, or any other table.
- No new secrets.
- Password gate on the page stays as-is.

## What you'll see after deploy

- New `Abnormal Cards` tab on the Loyalty Cards page.
- Upload Excel → preview groupings (e.g., "324 unique patients from 1,200 rows").
- Click Send → progress bar runs, one WhatsApp per primary key.
- After completion: zero database footprint. Cloudinary images age out via existing 7-day rule.
- Refresh the tab → in-memory log clears (nothing was saved).
