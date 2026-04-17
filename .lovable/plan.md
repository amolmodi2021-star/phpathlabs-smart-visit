

## Change
When a bill cancellation marker is logged for a bill registered on a **previous day**, label it as "Old Bill Cancelled" instead of "Bill Cancellation". Same-day cancellations keep the existing "Bill Cancellation" label.

## Approach
Two clean ways — picking the simpler one that needs no schema/enum change:

**Use the existing `transaction_type` enum value but override the display label via the `remarks` already containing the original date — and add a new label key.**

Actually cleaner: introduce a new `transaction_type` value `old_bill_cancellation` used only when the registration date < today. The Daily Report's `TRANSACTION_LABELS` map already drives the badge text and Excel "Type" column.

### Files
1. **`src/components/lims/EditRegistrationDialog.tsx`** — in `processCancelBill`, compute `isCrossDay = regDateStr !== todayStr`. When logging the marker row, set `transaction_type: isCrossDay ? "old_bill_cancellation" : "bill_cancellation"`. Refund row stays as `refund`.

2. **`src/components/lims/DailyReport.tsx`** — extend `TRANSACTION_LABELS`:
   ```ts
   bill_cancellation: "Bill Cancellation",
   old_bill_cancellation: "Old Bill Cancelled",
   ```
   This automatically updates: table badge, Excel export "Type" column, and the Type filter dropdown.

3. **`src/lib/paymentTransactions.ts`** — if `transaction_type` is a TypeScript union, widen it to include `"old_bill_cancellation"`. No DB enum change needed since `transaction_type` is stored as text (verified via existing free-form labels map).

### What stays the same
- Schema, RLS, refund logic, freeze rule, Cash/NEFT-only refund mode
- Same-day cancellations still log `bill_cancellation`
- Refund row label, sort order, totals, summary cards
- Existing rows in DB are unchanged (historical "Bill Cancellation" entries stay as-is)

