

## Revert same-day labels
Restore the original same-day labels; only the "Old ..." labels for cross-day rows stay.

## File
**`src/components/lims/DailyReport.tsx`** — `TRANSACTION_LABELS`:

| Key | Revert to |
|---|---|
| `registration_payment` | "Registration" |
| `due_collection` | "Due Collection" |
| `refund` | "Refund" |
| `bill_cancellation` | "Bill Cancellation" |

Kept as-is: `discount_applied` → "Discount Applied", `old_due_recovered` → "Old Due Recovered", `old_bill_refund` → "Old Bill Refund", `old_bill_cancellation` → "Old Bill Cancelled".

No DB or logic changes. Only display strings revert.

