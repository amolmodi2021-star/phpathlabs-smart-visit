
Good catch. You're right — once Preview has resolved the eligible records, the send loop should just send them. No second filter pass is needed.

## Current behavior
- **Preview** runs filter queries → produces a final `previewResults` array of records per filter (already deduped, blacklist-checked, quota-capped).
- **Send** then iterates `previewResults` and sends each record. It does NOT re-run eligibility filters.

So filtering is **not** repeated at send time. What I called "filter branch" in the prior plan is just the per-message-type code path (ABC vs Abnormal vs Promotion) that knows how to build the right payload — it's not a re-filtering step.

## What actually stopped your campaign
Not re-filtering. Almost certainly one of:
1. A throw inside the abnormal-card image generation or a `.single()` lookup for one record → bubbled to the outer catch → killed the loop before reaching the next record/filter.
2. Browser tab backgrounded → `setTimeout` delay throttled to ~1/min → loop appeared frozen.

## Revised fix (no filter changes at all)
- **Per-record try/catch** inside each message-type branch: if one record fails, log it and `continue` to the next pre-claimed record. Same audience, same order, same quota — just resilient to a single bad record.
- **Per-branch try/catch** around the message-type dispatch: if the abnormal branch throws before its loop even starts, log it and move to the next filter's pre-claimed records instead of aborting the whole campaign.
- **Outer catch** writes a `campaign_aborted` row to `drip_campaign_log` so we can see exactly what killed it next time.
- **"Filter X of Y" phase label** updated between branches so progress is visible.
- **Tab-backgrounded warning toast** via `visibilitychange` listener.

## Confirmation
- Eligible records claimed by Preview = exactly what gets sent.
- No re-querying of `crm_contacts`, `crm_abnormal_tests`, blacklist, or dedup at send time.
- Quota math, priority order, Test Mode cap — all untouched.

## File
- EDIT `src/components/marketing/AutomatedMarketing.tsx` — wrap per-record and per-branch in isolated try/catch, add phase label + visibility warning, add diagnostic logging.
