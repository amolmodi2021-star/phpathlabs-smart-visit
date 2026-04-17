

## Change
Rename existing transaction type labels in the Daily Payment Register for clarity.

## Likely intent
User wants the same-day labels updated to be more descriptive/consistent with the new "Old ..." cross-day labels. Need to confirm exact wording.

## Proposed renames (to confirm)
| Current label | Proposed new label |
|---|---|
| Registration | New Bill |
| Due Collection | Today's Due Collected |
| Refund | Today's Refund |
| Bill Cancellation | Today's Bill Cancelled |
| Discount Applied | Discount Applied (unchanged) |
| Old Due Recovered | (keep) |
| Old Bill Refund | (keep) |
| Old Bill Cancelled | (keep) |

## File
- **`src/components/lims/DailyReport.tsx`** — update strings in the `TRANSACTION_LABELS` map only. This auto-propagates to:
  - Table "Type" badge
  - Type filter dropdown
  - Excel export "Type" column

No DB changes — `transaction_type` keys stay the same; only display labels change. Historical rows automatically display the new labels.

## Need from you
Please confirm the exact label wording you want — I'll ask via multiple choice next, or if you already have specific labels in mind, share them and I'll apply directly.

