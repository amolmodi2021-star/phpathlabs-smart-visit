
## Diagnosis

**Invoice 2604160005**: registration was edited (Apr 17 04:02) AFTER initial registration (Apr 16 20:33), changing payment split from `Cash 1850` → `Cash 1800 + GPay 50`. The current `payment_transactions` row still shows the original `Cash 1850 / GPay 0` because the sync code shipped **after** this edit was made. There's only ONE transaction row — no double-counting, just stale split.

User confirmed: late due-collections should stay on the collection day (current behavior correct). So no code change is needed for the `DuePayments` flow.

## Two-part fix

### 1. One-time data fix for invoice 2604160005
Update its `payment_transactions` row in-place to match the current registration:
- `cash_amount` → 1800
- `gpay_amount` → 50
- append remark: `"Manual sync to match edited payment split on dd-MM-yyyy"`

### 2. Ensure the sync helper covers all in-place edit paths
Audit confirmed:
- `EditRegistrationDialog.handleSaveDetails` → calls sync ✓
- `EditRegistrationDialog.processOverpaymentRefund` → calls sync ✓
- `EditRegistrationDialog.processCancelTests` → calls sync ✓
- `EditRegistrationDialog.processCancelBill` → calls sync ✓
- `DuePayments.handleCollect` → does NOT sync (correct per user choice — separate row on collection day)
- `BadDebts` → does not touch payments ✓
- `CompletedHomeVisits` / `EditAndRegisterHomeVisitDialog` → CREATE registrations; logging happens via initial registration insert flow

**Tighten one edge case** in `EditRegistrationDialog.handleSaveDetails`: today the sync only fires when `splitChanged` OR `discountChanged`. If the user edits ONLY a non-financial field (name, address, etc.) the sync correctly skips — that's fine. But if `reg.payments` is empty (e.g., legacy 100% due) and user enters a split that matches paid_amount, `splitChanged` will be true → sync fires ✓. No change needed here.

### 3. (Defensive) Add `change_reason` always for robustness
No behavioural change — already done.

## Files
- **Migration**: one `UPDATE payment_transactions SET cash_amount=1800, gpay_amount=50, remarks=...WHERE registration_id='164050e4-915e-4d6d-ab0a-027dca7d4624' AND transaction_type='registration_payment'`.
- No code changes required for the existing flows.

## Verification after fix
- Refresh Daily Report → invoice 2604160005 row should show Cash ₹1800, GPay ₹50, Total ₹1850.
- Future edits via Edit Registration dialog will sync automatically (already in place).
- Future late due-collections will continue to log a separate row on the collection day, leaving the original row untouched (per user preference).
