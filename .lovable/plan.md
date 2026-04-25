## Problem

`registered_by` is intermittently `NULL` (47 rows) or shows `"Administrator"` (35 rows) across recent invoices. Investigation:

1. **Three insert paths** capture the user, but each does it slightly differently:
   - `PatientRegistration.tsx` — `getCurrentUser()?.display_name || null` (no `username` fallback → if `display_name` is missing/empty in localStorage the value is `null`)
   - `EditAndRegisterHomeVisitDialog.tsx` — uses fallback chain
   - `CompletedHomeVisits.tsx` — uses fallback chain
2. **`"Administrator"` problem** — that's the literal `display_name` of the shared `PHPATHLABS` super-user account in `app_users`. Anyone signed in with that shared account gets stamped as "Administrator". Real staff accounts (AMAN, KOMAL, SHUBHAM, RAHUL, MANISH) work correctly.
3. **`NULL` problem** — happens when `getCurrentUser()` returns `null` (stale/cleared localStorage, opened in a new tab without auth, or a code path where the user object is not yet rehydrated). `PatientRegistration.tsx` is most exposed because it has no `username` fallback.
4. **Dispatch "Registered By" empty** — Dispatch reads from `reg.registered_by` directly, so any historical `NULL` row shows blank.

## Fix

### 1. Centralized helper for the stamp
Use the existing `getCurrentUserName()` helper (in `src/lib/auth.ts`) everywhere instead of inline `getCurrentUser()?.display_name` chains. It already returns `display_name || username || null` and is the single source of truth.

### 2. Update all 3 registration insert sites
- `src/components/lims/PatientRegistration.tsx` (line 397) — replace inline expression with `getCurrentUserName()`.
- `src/components/lims/EditAndRegisterHomeVisitDialog.tsx` (line 322) — switch to `getCurrentUserName()`.
- `src/components/lims/CompletedHomeVisits.tsx` (line 169) — switch to `getCurrentUserName()`.

### 3. Hard guard — never insert without a name
Before each insert, if `getCurrentUserName()` returns falsy:
- show a toast `"Please sign in again before saving the registration"`,
- abort the save (do NOT insert with `null`).

This eliminates new `NULL` rows going forward.

### 4. Dispatch — show fallback for missing data
In `src/components/lims/Dispatch.tsx` at the audit-trail render (line 569), display `test.registeredBy || "—"` so historical NULL rows render a dash instead of blank space, matching how the other audit roles display.

### 5. About `"Administrator"` (informational, no code change)
The "Administrator" label is being captured correctly — it is the `display_name` of the `PHPATHLABS` shared account. If you want a real person's name on those invoices instead, each staff member must sign in with their own dedicated user (AMAN / KOMAL / SHUBHAM / RAHUL / MANISH already exist) rather than the shared admin account. No code change can determine the human behind a shared login.

## Out of scope
- No backfill of historical `NULL` / `Administrator` rows (data is already lost for those).
- No DB schema/RLS changes.

## Files to edit
- `src/lib/auth.ts` — already has `getCurrentUserName()`, no change needed.
- `src/components/lims/PatientRegistration.tsx`
- `src/components/lims/EditAndRegisterHomeVisitDialog.tsx`
- `src/components/lims/CompletedHomeVisits.tsx`
- `src/components/lims/Dispatch.tsx`
