
## Goal
Make `payment_transactions` (Daily Report source) the single source of truth — every later edit to a registration must keep it in sync.

## Current gaps
1. **Discount edited later** → `EditRegistrationDialog.handleSaveDetails` recalculates totals but only logs a NEW `discount_applied` row. The original `registration_payment` row still has the OLD `final_amount`/`discount_amount` → Daily Report numbers drift.
2. **Refund processed later** (`processOverpaymentRefund`) → splits payments and inserts a refund row, but the original `registration_payment` row keeps stale `paid_amount` if total paid changed.
3. **Bill cancellation** → already inserts `bill_cancellation` row, but original `registration_payment` row still counts as "in" for the day → double-effect.
4. **Cancelled tests** (partial cancel inside edit) → reduces `final_amount`/`net_amount` on registration but original transaction row not updated.
5. **Due collection edited / undone** → no flow exists to retro-update.

## Fix: extend `updateRegistrationPaymentSplit` → `syncRegistrationPaymentRow`

Rename and broaden the helper in `src/lib/paymentTransactions.ts` so it always rewrites the original `registration_payment` row with the **latest authoritative numbers** from the registration after ANY edit:

Updated columns on the original row:
- `cash/gpay/paytm/credit_card/neft_amount` (from current `payments` split)
- `total_amount` = current `paid_amount`
- `gross_amount`, `discount_amount`, `final_amount`, `paid_amount`, `due_amount` (from current registration)
- Append a remark describing what changed (split / discount / refund / cancel / tests)

Behaviour:
- If original `registration_payment` row exists → UPDATE in place.
- If missing (legacy) → INSERT one with current numbers.
- Never throws.

## Call sites in `EditRegistrationDialog.tsx`

Replace the existing single call inside `handleSaveDetails` with one final call **after** the registration update succeeds — passing latest gross/discount/final/paid/due/payments. This single call covers:
- payment mode split changes
- discount changes (global or per-test)
- test cancellations (which lower final_amount)
- any combination

In `processOverpaymentRefund` → also call `syncRegistrationPaymentRow` after refund + payments rewrite (refund row itself is still inserted separately as `direction:"out"`).

In `cancelEntireBill` (if exists in this dialog or elsewhere) → after marking `bill_cancelled=true`, call helper to zero out the original `registration_payment` row's amounts (or set `paid_amount=0, final_amount=0`) so Daily Report nets correctly. Bill-cancellation audit row stays as the negative entry. (Will confirm exact location while implementing.)

## What stays the same
- Separate audit rows for `discount_applied`, `refund`, `bill_cancellation`, `due_collection` — kept for audit history.
- `payment_transactions` schema — no migration.
- `DailyReport.tsx` UI — no change.
- Initial registration logging in `PatientRegistration.tsx` — no change.

## Why update-in-place not insert-adjustment
Daily totals SUM all rows for the day. If we left the stale row and added a delta row, simple "Cash today" sums would double-count or net wrong. Updating the original row keeps daily aggregates exact while audit trail (discount/refund/cancel rows) records the change history.

## Files
- `src/lib/paymentTransactions.ts` — rename/extend helper to `syncRegistrationPaymentRow`, accept full registration snapshot (gross, discount, final, paid, due, payments).
- `src/components/lims/EditRegistrationDialog.tsx` — call after every successful save (`handleSaveDetails`, `processOverpaymentRefund`, bill-cancellation path).

## No DB / edge function / schema changes
