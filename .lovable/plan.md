

## Diagnosis

The source code IS already correct — all three refund-logging sites in `EditRegistrationDialog.tsx` (cancel-bill, test-cancel-refund, overpayment-refund) and the due-collection site in `DuePayments.tsx` use an `isCrossDay` check based on `reg.created_at`.

I queried the DB for invoice `2604150005` (registered 15-04-2026, screenshot row dated 17-04-2026):

| Time (UTC) | Type stored | Should be |
|---|---|---|
| 04:48:08 | `due_collection` | `old_due_recovered` |
| 04:49:07 | `refund` | `old_bill_refund` |
| 04:49:07 | `registration_payment` | (correct — sync row) |

So the rows in the DB **were inserted with the old code** — most likely because the preview build hadn't hot-reloaded the previous fix at the time you ran the action. The code change is present in source, but the runtime that wrote those rows didn't have it yet.

## Fix

**Step 1 — Verify current build is using new code.**
Re-run a refund or due collection on any cross-day bill (registered before today). The new row should now show "Old Bill Refund" / "Old Due Recovered" in the Daily Report.

**Step 2 — Backfill the 3 mislabeled historical rows.**
Run a one-time SQL update to relabel any existing `refund` / `due_collection` / `bill_cancellation` rows where `transaction_date::date > registration.created_at::date`. This will fix the screenshot row and any others created before the fix landed.

Migration logic:
```sql
-- Refund → old_bill_refund when cross-day
UPDATE payment_transactions pt
SET transaction_type = 'old_bill_refund'
FROM patient_registrations pr
WHERE pt.registration_id = pr.id
  AND pt.transaction_type = 'refund'
  AND (pt.transaction_date AT TIME ZONE 'Asia/Kolkata')::date
    > (pr.created_at AT TIME ZONE 'Asia/Kolkata')::date;

-- Due collection → old_due_recovered when cross-day
UPDATE payment_transactions pt
SET transaction_type = 'old_due_recovered'
FROM patient_registrations pr
WHERE pt.registration_id = pr.id
  AND pt.transaction_type = 'due_collection'
  AND (pt.transaction_date AT TIME ZONE 'Asia/Kolkata')::date
    > (pr.created_at AT TIME ZONE 'Asia/Kolkata')::date;

-- Bill cancellation → old_bill_cancellation when cross-day
UPDATE payment_transactions pt
SET transaction_type = 'old_bill_cancellation'
FROM patient_registrations pr
WHERE pt.registration_id = pr.id
  AND pt.transaction_type = 'bill_cancellation'
  AND (pt.transaction_date AT TIME ZONE 'Asia/Kolkata')::date
    > (pr.created_at AT TIME ZONE 'Asia/Kolkata')::date;
```

Uses Asia/Kolkata so dd-MM-yyyy comparison matches the app's local-day rule. No new code, no schema change.

## What stays the same
- All source code (already correct)
- Same-day rows (filter excludes them)
- Future logging — already handled correctly

