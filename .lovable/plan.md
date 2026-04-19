

## Goal
On **Retry All**, regenerate the actual ABC card / Abnormal History card from the live CRM data and the active drip configuration, then send via `whatsapp-proxy` — so retries work even when the original `retry_payload` is missing (legacy rows) or contains a stale loyalty card image URL that storage cleanup has purged.

## Why this matters
- Legacy failed rows (e.g. `7874559630`) have `retry_payload = NULL` → currently shown as "No payload" and skipped.
- Even rows WITH a snapshotted payload reference an `imageUrl` from `loyalty-cards`/`outsourced-snips` storage that the daily cleanup cron deletes → retry succeeds at API level but WhatsApp rejects the broken image link.
- Source of truth for cards is already in CRM (`crm_contacts`, `crm_abnormal_tests`) + drip config (`app_settings`, `loyalty_card_templates`, `abnormal_card_templates`, `marketing_templates`). We rebuild from there.

## Approach

### 1. Extract shared card-rendering helpers — `src/lib/dripCardSenders.ts` (NEW)
Move 3 self-contained helpers out of `AutomatedMarketing.tsx` into a reusable module (no UI/state dependencies):
- `sendABCCard({ contact, cfg, abcTmpl, cardTemplates }) → { ok, retryPayload }`
- `sendAbnormalCard({ contact, cfg, abnTmpl, abnormalTemplates }) → { ok, retryPayload }`
- `sendPromotion({ contact, cfg, template }) → { ok, retryPayload }`

Each helper: looks up the active template, regenerates the card via existing `generateAndUploadCard` / `generateAbnormalCardForDrip` (also moved), calls `whatsapp-proxy`, returns success flag + a fresh retry payload.

`AutomatedMarketing.tsx` is refactored to use these helpers (no behaviour change in drip path, including CRM-update-only-on-success and message-log writes).

### 2. Rewrite `MarketingRetry.tsx` retry orchestration
For each failed row, branch on `message_type`:
- `"ABC"` → look up CRM contact by `primary_key` (or by `mobile_number`); call `sendABCCard`. Skip if contact not found.
- `"Abnormal History"` → look up CRM contact + `crm_abnormal_tests` rows; call `sendAbnormalCard`. Skip if no abnormal history.
- `"Promotion"` → reuse the snapshotted `retry_payload` if present (no card to regenerate), else skip.
- `"Marketing"` (legacy bulk send tab) → keep the existing `send-marketing-message` path.

`retry_payload` stops being a hard requirement for ABC / Abnormal History retries. It's only required for `Promotion` and legacy `Marketing`.

### 3. Update the "Retryable" column + AlertDialog warning
- Recompute the "skipped count" based on new rules: row is non-retryable only if (a) type is Promotion/Marketing AND no payload, or (b) ABC/Abnormal History but the CRM lookup will fail (we approximate by checking row has `mobile_number` or `primary_key` — actual contact lookup happens at retry time).
- Update the badge: ABC/Abnormal rows always show "Yes (regenerate)".
- Reword AlertDialog: "ABC and Abnormal History rows will be regenerated from CRM. Promotion/Marketing rows without payload (K of N) will be skipped."

### 4. Increment + status semantics (unchanged from previous round)
- Increment `retry_count` only after the attempt finishes.
- On success → `delivery_status='sent'`, clear `failed_at`.
- On hard failure → keep `failed`, increment count; row stays in queue until `retry_count >= maxRetries`.
- On skip (no contact found / no abnormal history) → set `retry_count = maxRetries` to remove from queue, log toast as "skipped".

### 5. Toast clarity
`Retried N — X succeeded, Y still failed, Z skipped (no CRM data / no payload)`

## Out of scope
- Changes to drip preview/eligibility logic.
- Changes to `whatsapp-proxy` / `send-marketing-message` edge functions.
- Backfilling old `retry_payload` rows (no longer needed — regeneration replaces them).

## Files
- NEW: `src/lib/dripCardSenders.ts` — shared ABC/Abnormal/Promotion senders.
- EDIT: `src/components/marketing/AutomatedMarketing.tsx` — switch to new helpers (behaviour-preserving refactor of three branches in `handleSend`).
- EDIT: `src/components/marketing/MarketingRetry.tsx` — new dispatcher branching by `message_type`, regenerate cards on retry, updated badges/dialog/toast.

## Expected outcome
- Click **Retry All** with `7874559630` in queue → CRM is queried, ABC card freshly rendered and uploaded, fresh image URL sent to WhatsApp proxy → message reaches the patient.
- Future failures of any kind retry the same way — no dependency on stale snapshot URLs or storage retention.
- Promotion/legacy Marketing rows without payload still cleanly reported as "skipped".

