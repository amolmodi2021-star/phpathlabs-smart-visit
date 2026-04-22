

# Preflight RPC rollout — mobile filtering logic preserved exactly

## One-line summary

Port the existing JS preflight to a Postgres RPC (byte-for-byte identical filter logic), ship behind a shadow-comparison toggle so you can verify both produce the same mobile lists, then flip the cutover flag.

## Mobile filtering — guaranteed unchanged

The RPC is a literal port of `runDrip`'s preflight chain. Same rules, same order, same skip reasons:

1. Source pull (`crm_contacts` for ABC, `crm_abnormal_tests` for Abnormal History, filter `mobile_data` for Promotion/Marketing-template)
2. Filter `criteria` JSON evaluated identically (record_tag, last_visit window, gender, age, area, doctor, lab)
3. Mobile validity (10-digit, non-zero)
4. Blacklist exclusion when `exclude_blacklist=true`
5. Per-filter sent dedupe within `cycle_lock_days`
6. Cross-filter mobile-cycle dedupe per `message_type` within `mobile_cycle_days`
7. `min_gap_hours` recent-send guard via `message_send_log`
8. Per-type data validation (ABC needs UMR+last_visit+name, Abnormal needs matching test row, Promotion needs resolvable variables)
9. Same sort (oldest `last_sent_date` first → `created_at`), same `daily_send_limit` cap

## Phase 1 — Build RPC + shadow comparison (no behavior change)

- New migration: function `get_drip_pending(filter_ids uuid[])` returning `{filter_id, eligible_count, sent_count, pending_count, pending_mobiles[]}`.
- New indexes: `crm_contacts(last_sent_date DESC NULLS LAST) WHERE last_sent_date IS NOT NULL` and `drip_campaign_log(filter_id, mobile_number, status, created_at)`.
- Hidden `?debug=preflight` query param in `AutomatedMarketing.tsx` runs **both** JS and RPC paths, displays `filter_name | js_count | rpc_count | only_in_js[] | only_in_rpc[]`.
- JS path remains the source of truth — RPC results are display-only until you confirm.

**You verify** by appending `?debug=preflight`, clicking Refresh Pending across all 5 active filters, screenshotting matching counts and empty diff arrays.

## Phase 2 — Flip cutover (one constant)

- Add `USE_RPC_PREFLIGHT = true` constant in `AutomatedMarketing.tsx`.
- `pendingCounts` query → single `supabase.rpc('get_drip_pending', ...)` call (~1 KB).
- `runDrip` preflight → use RPC's `pending_mobiles[]`, then fetch only those contact rows via `.in('primary_key', pendingPks)` (~50 KB instead of ~12 MB).
- Old JS code stays in place behind `if (!USE_RPC_PREFLIGHT)` for instant revert.

## Phase 3 — Unrelated count optimizations (no filter logic touched)

Switch `count: "exact"` → `count: "estimated"` on dashboard label queries:
- `src/components/crm/CRMSentHistory.tsx`
- `src/pages/AbnormalHistory.tsx`
- `src/pages/EstimateDashboard.tsx`
- `src/components/marketing/MarketingHistory.tsx`
- `src/components/lims/ModifiedApproval.tsx`
- `src/components/lims/CompletedHomeVisits.tsx`
- `src/components/PaymentDetailsDialog.tsx` — drop count entirely

Status-filtered counts in Dispatch/RegisteredPatients/ResultsEntry/ResultVerification stay `exact` (estimates wrong for filtered subsets).

## What stays untouched

- `evaluateFilterCriteria` JS — kept as reference implementation.
- All filter UI, criteria fields, cycle/blacklist/gap settings.
- Trial mode, Pause/Stop, worker pool, retry tab.
- Send pipeline (whatsapp-proxy, Cloudinary, message_send_log).

## Files changing

| File | Phase | Change |
|---|---|---|
| New migration | 1 | `get_drip_pending(uuid[])` RPC + 2 indexes |
| `src/components/marketing/AutomatedMarketing.tsx` | 1+2 | Shadow panel, then RPC cutover behind `USE_RPC_PREFLIGHT` |
| 6× dashboard files | 3 | `count: "estimated"` |
| `src/components/PaymentDetailsDialog.tsx` | 3 | Remove count query |

## Verification

1. **Shadow mode**: `?debug=preflight` → all 5 filters show identical JS vs RPC counts and empty diffs. You screenshot and confirm.
2. **Cutover**: First post-flip campaign — DevTools shows ~1 KB RPC + ~50 KB targeted contact pull (was ~25 MB). Send count and skip reasons match exactly.
3. **Rollback**: Flip `USE_RPC_PREFLIGHT = false` if any drift appears in production.

## Expected outcome

- Mobile filtering: **identical** — verified before cutover.
- Send/Refresh click: ~25 MB → ~50 KB.
- Network share of Cloud usage: 81% → ~40–50%.
- Heavy-send daily cost: further ~50–60% drop.

