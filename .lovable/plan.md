
## Reconciliation: today's drip campaign vs. your downloaded preview

I cannot read the .xlsx contents directly in plan mode (file-system writes are disabled), but I can compare the **totals** the preview produced against what actually got attempted in the database. If you tell me the per-filter row counts shown at the top of the file, I can match them line-by-line. From DB-side evidence today:

### Abnormal PNG (the one you flagged)
| Metric | Count |
|---|---|
| Attempted (drip_campaign_log) | **686** |
| Sent OK to provider | 582 |
| Failed (`wa_api_error`) | 104 |
| In `message_send_log` | 686 |
| Delivered by WhatsApp | 284 |
| Read | 225 |
| Still "sent" awaiting delivery callback | 67 |
| Marked failed | 110 |
| Window | 13:43 → 14:34 (~50 min, no gaps) |

So 686 attempts ran end-to-end. Nothing stopped at 500. If your preview Abnormal sheet has **≤686 rows**, every row was attempted. If it has **>686 rows**, the extra rows were never claimed for sending — that would be a real gap I need to find.

### ABC Cards
| Metric | Count |
|---|---|
| Attempted today | **2001** |
| Sent OK | 1917 |
| Failed (`wa_api_error` 84, `card_generation_error` 2) | 86 |
| Delivered | 869 + many in read state |
| Window | 04:12 → 13:43 |

### Why some sends still show "failed"
- `wa_api_error` (84 ABC + 104 Abnormal) = AOC provider rejected the request (rate limit / template / number issue).
- `card_generation_error` (2 ABC) = PNG render crashed for that contact.
None of these aborted the campaign — the loop kept going.

## What I'll do once you approve
1. **Read the uploaded preview file** (`drip_preview_2026-04-19.xlsx`) for real and extract every mobile + filter name.
2. **Cross-check each preview row** against `message_send_log` (today, matching `message_type` + last-10-digit mobile).
3. **Generate `/mnt/documents/drip_reconciliation_2026-04-19.xlsx`** with sheets:
   - `Summary` — preview count vs attempted vs sent vs failed vs delivered vs read, per filter.
   - `Abnormal_Missing` — preview rows with **no** attempt row in the DB (the true "not sent from our end" list).
   - `ABC_Missing` — same for ABC.
   - `Failed_With_Reason` — every failed attempt with provider reason and retry payload presence, ready for the Retry tab.
4. **Auto-retry plan** for `wa_api_error` rows: enqueue them into the existing Retry queue (uses the snapshot we already store in `retry_payload`), so the 110 abnormal failures and 84 ABC failures get a second pass without manual work.

## Files (to be edited only after the reconciliation report confirms gaps)
- READ-ONLY: `/tmp/preview.xlsx` (decoded from your upload), `message_send_log`, `drip_campaign_log`.
- WRITE: `/mnt/documents/drip_reconciliation_2026-04-19.xlsx` (artifact).
- If gaps are found beyond the 110 wa_api_error: EDIT `src/components/marketing/AutomatedMarketing.tsx` to add the auto-retry-on-`wa_api_error` step into the live send loop.

## Expected outcome
You will get a downloadable spreadsheet that lists, per filter, exactly which numbers from your downloaded preview were not delivered from our end and why, plus a one-click path to retry the recoverable failures.
