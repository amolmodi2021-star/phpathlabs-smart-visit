
## Goal
Eliminate UTC drift entirely. The invoice prefix `YYMMDD` and the displayed `Registered Date & Time` must both reflect IST (Asia/Kolkata) so they always agree.

## Root cause recap
- `generate_invoice_number()` uses `to_char(CURRENT_DATE, 'YYMMDD')`. `CURRENT_DATE` follows the database session timezone (UTC by default on Supabase), so bills made between 00:00–05:30 IST get the previous day's prefix.
- `RegisteredPatients.tsx` renders `created_at` in the browser's local zone (IST for our users) using 24-hour `HH:mm`.

## Fix — IST everywhere

### 1. DB migration — invoice prefix in IST
Update `generate_invoice_number()` to derive the date from IST:
```sql
today text := to_char((now() AT TIME ZONE 'Asia/Kolkata')::date, 'YYMMDD');
```
Apply the same fix to `generate_sample_uid()` (sample tube IDs use the same `S[YY][MM][DD]` convention and have the identical bug):
```sql
today text := to_char((now() AT TIME ZONE 'Asia/Kolkata')::date, 'YYMMDD');
```
No data backfill — historical rows keep their existing prefixes.

### 2. UI — display in IST 12-hour format
`src/components/lims/RegisteredPatients.tsx`:
- Cell render (line ~237): `format(new Date(r.created_at), "dd-MM-yyyy hh:mm a")`
- Excel export (line ~141): same format string

`date-fns` `format()` already renders in the browser's local zone (IST for our users). The `hh:mm a` token gives the project-standard 12-hour AM/PM display. This matches the global Date & Time Format Standard already enforced project-wide.

### 3. Verify no other UTC sources
Quick sweep of other generators that use `CURRENT_DATE` / `now()` for date keys to confirm nothing else silently uses UTC for IST-facing identifiers. If any are found in the same migration scope, convert them to `(now() AT TIME ZONE 'Asia/Kolkata')::date` as well (notably `invoice_counter` / `sample_tube_counter` `date_key` writes — already handled because they read the local `today` variable inside the same function).

## What stays the same
- No schema changes; only function bodies updated.
- No change to existing rows.
- All other modules (Daily Report, audit trail, etc.) already render via `date-fns format()` which uses the browser local zone (IST).

## Files
- New migration: update `generate_invoice_number()` and `generate_sample_uid()` to use `Asia/Kolkata`.
- `src/components/lims/RegisteredPatients.tsx` — 2 line edits to switch to `dd-MM-yyyy hh:mm a`.
