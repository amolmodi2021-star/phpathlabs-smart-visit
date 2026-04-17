

## Change
Add cross-day labels for refund and due-collection rows, mirroring the existing "Old Bill Cancelled" pattern.

## Mapping
| Same-day type | Cross-day type | Cross-day label |
|---|---|---|
| `refund` | `old_bill_refund` | "Old Bill Refund" |
| `due_collection` | `old_due_recovered` | "Old Due Recovered" |
| `bill_cancellation` | `old_bill_cancellation` | "Old Bill Cancelled" (already done) |

"Cross-day" = the original registration date (`patient_registrations.created_at` / `reg.created_at`) is before today, regardless of when the action is taken.

## Files

1. **`src/lib/paymentTransactions.ts`** — widen `transaction_type` union to include `"old_bill_refund"` and `"old_due_recovered"`.

2. **`src/components/lims/DailyReport.tsx`** — extend `TRANSACTION_LABELS`:
   ```ts
   old_bill_refund: "Old Bill Refund",
   old_due_recovered: "Old Due Recovered",
   ```
   Auto-updates table badge, Type filter dropdown, and Excel "Type" column.

3. **`src/components/lims/EditRegistrationDialog.tsx`** — in `processCancelBill`, for the refund row use `transaction_type: isCrossDay ? "old_bill_refund" : "refund"` (same `isCrossDay` flag already computed for the marker row).

4. **Due collection logging site** — locate where `transaction_type: "due_collection"` is logged (likely `PaymentDetailsDialog.tsx` or similar). Compute `isCrossDay` by comparing the registration's `created_at` date (dd-MM-yyyy local) with today. If cross-day, log as `"old_due_recovered"` instead.

## What stays the same
- Same-day refunds and due collections keep current labels.
- Schema, RLS, sort order, freeze rule, Cash/NEFT-only refund constraint.
- Existing rows in DB unchanged (historical entries keep their original labels).

