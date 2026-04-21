

# Patient Report Portal — Final (with Short URL)

Same as previously approved plan. Only the **URL/token strategy** changes per your feedback.

## URL strategy (new)

**Format:** `https://phpathlabs.lovable.app/r/<invoice><4-char-suffix>`

Example: invoice `2511230042` → token `2511230042A7K9` → URL:
```
https://phpathlabs.lovable.app/r/2511230042A7K9
```

- **Invoice number** (10 chars) prefix → recognizable, ties link to a real bill.
- **4-char random suffix** (alphanumeric, uppercase, no confusing chars like 0/O/1/I) → makes the token unguessable. ~1.7M combinations per invoice → brute-force impractical, especially with 3-attempt DOB lockout.
- **Total URL length:** ~50 chars. Fits cleanly on one line in WhatsApp.

**Collision handling:** if suffix collides with an existing active token for the same invoice (extremely rare), regenerate.

**WhatsApp message preview:**
```
Dear RAJESH KUMAR, your reports for Invoice 2511230042 are ready.
View status & download:
https://phpathlabs.lovable.app/r/2511230042A7K9
(Link valid for 7 days)
```

## Everything else (unchanged from prior approval)

- Public route `/r/:token` — verification (DOB or last-4-mobile, 3 attempts → 15-min lockout).
- Workflow timeline per test (5 dots: Collected → Accepted → Entered → Verified → Approved).
- Result values hidden until doctor approval.
- Download PDF button per approved test + full-report download.
- **Download blocked if `due_amount > 0`** → amber "Payment pending ₹X" banner.
- PDFs generated client-side, never uploaded to storage.
- Auto-refresh every 60 s; dwell-time heartbeat every 10 s.
- 7-day link expiry.
- IP stored as SHA-256 hash. `noindex, nofollow` on portal page.

## Database (3 new tables — same as before)

```text
report_share_links
  id · token (unique, ~14 chars) · registration_id
  created_at · expires_at · created_by

report_link_events
  id · token · event_type
  ('opened'|'verified'|'verification_failed'|'download_attempted'
   |'downloaded'|'blocked_due_pending')
  occurred_at · ip_hash · user_agent · session_id

report_link_sessions
  id · session_id (unique) · token
  started_at · last_heartbeat_at · total_dwell_seconds
```

RLS: public INSERT on events/sessions; public SELECT on `report_share_links` by token; internal reads for analytics.

## Files

**New**
- `src/pages/PatientReportPortal.tsx`
- `src/pages/ReportAnalytics.tsx`
- `src/components/report/TestStatusTimeline.tsx`
- `src/lib/reportShareLinks.ts` — includes `generateToken(invoiceNumber)` → invoice + 4-char suffix from safe alphabet (`ABCDEFGHJKLMNPQRSTUVWXYZ23456789`).

**Modified**
- `src/components/lims/Dispatch.tsx` — `dispatchViaWhatsApp` builds short token, inserts row, sends short URL.
- `src/App.tsx` — register `/r/:token` (public, no AppLayout) and `/report-analytics` (internal).
- `src/components/AppLayout.tsx` — sidebar entry "Report Analytics" under LIMS.
- `src/lib/auth.ts` — RBAC entry for `/report-analytics`.

## Report Analytics page (unchanged)

- KPIs: Links sent (7d/30d), Open rate, Avg dwell, PDF downloads, Blocked-by-due count.
- Table: Patient · Invoice · Sent · Opens · Last opened · Dwell · Downloads · Due Amount.
- Drill-down dialog: full event timeline per token.

## Verification after deploy

1. Dispatch → WhatsApp on a paid approved patient → URL is `…/r/<invoice>XXXX` (~14-char token).
2. Open link → DOB verification → status timeline visible → download works (no upload to storage).
3. Patient with `due_amount > 0` → download buttons hidden, amber banner shown.
4. Wrong DOB 3× → 15-min lockout.
5. Try a guessed token (`…/r/2511230042ZZZZ`) → "Invalid or expired link".
6. Force-expire token → "This link has expired. Contact lab."
7. Report Analytics shows opens, dwell, downloads, blocked-by-due counter.

