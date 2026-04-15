

# Show Home Visit Charge Refund on Invoice

## Problem
When home visit charges are refunded, the invoice's refund section only mentions cancelled tests. It should also mention the refunded home visit charges, similar to how cancelled tests are listed.

## Approach
Derive the HVC refund amount by comparing `refund_amount` against the sum of cancelled test refund amounts. The difference (if any) is the HVC refund.

## Change in `src/components/lims/InvoicePreview.tsx`

1. **Calculate HVC refund amount** — Sum cancelled test prices (from `cancelledTests` array), then: `hvcRefund = refund_amount - cancelledTestRefundTotal`. If positive, HVC was refunded.

2. **Display in refund section** (after cancelled tests line, ~line 186) — Add a line:
   ```
   Home Visit Charges Refunded: ₹{hvcRefund}
   ```
   Styled the same as the cancelled tests line (fontSize 11, color #888).

3. **Update HVC display line** — The existing "Home Visit Charges" line (line 148) already only shows when `home_visit_charges > 0`, so after refund (set to 0) it correctly hides. No change needed there.

### Single file change
- `src/components/lims/InvoicePreview.tsx`

