

## Problem (root cause)
Retry shows messages but the WhatsApp API never receives anything because:

1. **Drip-originated failures have `retry_payload = NULL`** — `AutomatedMarketing` calls `logMessageSend(..., "failed")` which only inserts the row; it never snapshots the payload. (Confirmed: all 202 failed ABC rows + 2 Abnormal History rows in the DB have `retry_payload IS NULL`.)
2. **`MarketingRetry` Marketing path** returns `false` immediately when `retry_payload?.apiUrl` is missing — no API call happens.
3. **`MarketingRetry` ABC path** rebuilds from a hard-coded `"ABC Card"` template that may not exist; for drip-ABC failures this silently fails.
4. **Abnormal History** is hard-coded to "skip" — but drip-originated Abnormal History rows actually went through the WhatsApp proxy and should be retryable.
5. **`retry_count` is set to 1 BEFORE the send attempt** (line 204) — so even if nothing reaches WhatsApp, the row vanishes from the queue forever, masking the bug.

## Fix

### 1. Snapshot payload on every drip failure — `src/components/marketing/AutomatedMarketing.tsx`
Wherever the drip catches a WhatsApp API error (the three send paths: ABC, Abnormal History, Promotion at ~lines 970-1080 and the loyalty card path at ~lines 990-1000), immediately after `logMessageSend(..., "failed", ...)` call, **also update that just-inserted row** with:
- `failed_at = now()`
- `retry_payload = { kind: "drip-abc" | "drip-abnormal" | "drip-promotion" | "drip-loyalty", apiBaseUrl, apiKey, authHeaderName, authHeaderPrefix, payload }`

The cleanest path: extend `logMessageSend` (in `src/lib/messageLog.ts`) with optional `failedAt` + `retryPayload` parameters and pass them in. Inspect the file first to confirm signature.

### 2. Backfill button (one-time helper) — optional
Add a small "Rebuild from CRM" path in `MarketingRetry.tsx` for legacy rows that have `retry_payload IS NULL`. The existing ABC rebuild logic stays as a fallback when payload is missing, but corrected:
- Drop the hard-coded `"ABC Card"` template lookup. Instead, find the most recent `marketing_templates` row referenced by drip filters, OR read the active drip campaign config (`drip_loyalty_*` settings) — same source of truth the drip engine uses. Pick the right template based on `message_type`.

### 3. Fix Retry orchestration — `src/components/marketing/MarketingRetry.tsx`
- **Move `retry_count = 1` to AFTER the send attempt** so failed retries can be diagnosed (or keep at 0 on hard error so user can retry again).
- **Generic dispatcher**: if `retry_payload?.kind` exists, use it to call `whatsapp-proxy` directly with the snapshotted payload — this works for all three drip types (ABC, Abnormal History, Promotion) and for legacy `Marketing` rows once they're written with the same shape.
- **Legacy Marketing rows** (with `apiUrl` field): keep current path via `send-marketing-message`.
- **Remove the "Abnormal History → skip"** branch. Only skip if `retry_payload IS NULL` AND we can't rebuild it.
- Show clearer toast counts: "Retried N — X succeeded, Y still failed, Z skipped (no payload)".

### 4. Self-check before "Retry All"
At start of `retryAll`, count rows with `retry_payload IS NULL`. If >0, show a warning in the AlertDialog: "K of N rows are missing retry payloads (legacy failures) and will be skipped. New failures going forward will be fully retryable."

## Out of scope
- Retroactively rebuilding payloads for the existing 202 legacy failures (no source data captured at the time). They will remain skipped with a clear toast.
- Changes to `MarketingSender.tsx` (already snapshots `retry_payload` correctly).
- Edge function changes to `whatsapp-proxy` / `send-marketing-message`.

## Expected outcome
- Any **future** failure from Marketing tab, Drip tab, or any send path is logged with a complete `retry_payload` snapshot.
- Clicking **Retry All** re-invokes the WhatsApp proxy with the exact original payload — messages actually reach WhatsApp and AOC dashboard shows them.
- `retry_count` increments only after a real attempt (success or hard fail), so failed retries are visible (not silently hidden).
- Legacy rows with no payload are clearly reported as "skipped" instead of pretending they were tried.

