

## Constraint
Refunds are only paid out via **Cash** or **NEFT** — never GPay/Paytm/Credit Card. Patient may have originally paid via any mode (e.g. GPay), but the refund itself goes through Cash or NEFT.

## Impact on cross-day cancellation plan
The earlier plan said: "Refund row mode amounts = negative of what patient had paid." That's wrong for this business rule. The refund row must let the user **choose Cash or NEFT** as the refund mode, regardless of how the patient originally paid.

## Updated cross-day cancellation flow (`EditRegistrationDialog.tsx`)

When `created_at` is **not today** and user cancels the bill:

1. **Prompt for refund mode** in the cancellation confirmation dialog:
   - Radio: ⦿ Cash  ⦿ NEFT (default Cash)
   - Show: "Refund ₹X will be recorded in today's Daily Report as a [Cash/NEFT] outflow."
2. Skip `syncRegistrationPaymentRow` — yesterday's audit row stays frozen.
3. Update `patient_registrations`: `bill_cancelled=true`, `final_amount=0`, `paid_amount=0`, `refund_amount=<paid>`, `refund_mode='Cash'|'NEFT'`, `refund_date=now()`.
4. Log TWO `payment_transactions` rows dated today:
   - **Refund row** — `transaction_type='refund'`, `direction='out'`, mode amounts: ONLY the chosen mode (Cash or NEFT) populated as negative; other modes = 0. `refund_amount=+paid` (positive audit value). Remarks: `Refund of ₹X via [Cash/NEFT] for cancelled invoice <X> (registered DD-MM-YYYY, originally paid via <original_modes>)`.
   - **Bill cancellation marker row** — `transaction_type='bill_cancellation'`, `direction='out'`, all mode amounts = 0, `gross_amount`/`discount_amount`/`final_amount` = negative of original (audit visibility, no cash impact). Remarks: `Bill cancelled — original invoice <X> dated DD-MM-YYYY, final ₹X`.

## Same-day cancellation
Unchanged for now — but for consistency, also restrict the refund-mode selector to Cash/NEFT only. Same-day flow continues to overwrite the registration row to zeros + log a bill_cancellation row (net zero for the day, no separate refund row needed since the original payment row is being zeroed out).

Wait — same-day still has a problem: if patient paid GPay originally and refund is Cash, simply zeroing the registration row hides the cash outflow. Better to apply the **same two-row pattern for ALL cancellations** (same-day or cross-day):
- Always freeze the registration row (don't zero its modes).
- Always log refund row (Cash/NEFT only) + bill_cancellation marker.
- This unifies behavior and keeps the cash drawer accurate regardless of mode mismatch.

**Recommendation:** unify — always use the freeze + refund + marker pattern, regardless of cancellation date. Cleaner, audit-correct, and matches real cash-drawer movement.

## Files
- `src/components/lims/EditRegistrationDialog.tsx` — replace cancellation handler: add Cash/NEFT refund-mode picker; freeze registration audit row (no zeroing of mode columns or paid_amount); log refund row (chosen mode only, negative) + bill_cancellation marker row dated today
- `src/lib/paymentTransactions.ts` — no changes needed; `logPaymentTransaction` already handles `direction='out'` sign-flip
- One-time SQL: identify any past cancellations where the registration row was zeroed and verify totals are still consistent (likely none beyond invoice 2604170001 which is already corrected)

## Memory to save
**Bill cancellation rule:** Cancellations never mutate the original registration audit row. Two rows are always logged on the cancellation date: a refund row (Cash or NEFT only — the only allowed refund modes) and a bill_cancellation marker row (mode amounts = 0, negative bill snapshot for audit visibility).

## What stays the same
- Schema, sync flag, due_collection, discount_applied flows
- Daily Report sort order (latest invoice on top, oldest transaction first within invoice)
- Refund/bill_cancellation rows already render correctly in Daily Report

