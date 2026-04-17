
## Goal
Make Refund rows in Daily Payment Register represent ONLY the money-out delta — no duplicated gross/discount/final/paid/due, and the refund amount as a **negative** in the actual payment mode column (Cash/GPay/NEFT/etc). Daily mode totals will then naturally net to the real cash-drawer count.

## Problem (from screenshot of invoice 2604160005)
Current Refund row shows:
- Gross ₹50, Discount ₹10, Final ₹40, Paid ₹40 → these are the registration snapshot, not refund-specific. They inflate the Totals row → bookkeeping confusion.
- Cash ₹10 (positive) → adds to "Cash today" total instead of subtracting → end-of-day cash count won't match.

## Fix

### A. `logPaymentTransaction` calls for refunds (`EditRegistrationDialog.tsx`)
Two call sites: `processOverpaymentRefund` (~line 348) and `processCancelTests` refund (~line 530). Change both so the refund row:
- Sets `gross_amount = 0`, `discount_amount = 0`, `final_amount = 0`, `paid_amount = 0`, `due_amount = 0`
- Sets the mode amount to **negative** refund value (e.g. cash_amount = -10)
- Keeps `refund_amount` (positive) as the audit value
- Keeps `total_amount` as negative refund (so Total Out summary still works)

### B. `splitPaymentModes` helper (`paymentTransactions.ts`)
No change needed for normal "in" use. To support negative for refunds, the simplest path: add an optional `direction` parameter to `logPaymentTransaction` that, when `"out"`, negates the per-mode values before insert. This keeps callers ergonomic — they still pass positive amounts.

Implementation in `logPaymentTransaction`:
```ts
const sign = params.direction === "out" ? -1 : 1;
const row = {
  ...
  cash_amount: modes.cash * sign,
  gpay_amount: modes.gpay * sign,
  ...
  total_amount: (params.total_amount ?? 0) * sign,
  refund_amount: params.refund_amount ?? 0,  // stays positive (audit)
  ...
};
```

This auto-applies to BOTH refund call sites without further edits, AND auto-applies to bill-cancellation rows (which are also `direction: "out"`).

### C. `bill_cancellation` row (`processCancelBill`)
Same logic flows through — the cancelled bill's paid amount becomes negative in the original mode columns, so Daily totals net to zero across the registration row + cancellation row.

### D. `DailyReport.tsx` display
- Cell rendering: change "show only if > 0" to "show if != 0" so negative mode amounts appear (in red). Update lines 267–272 to render negatives like `-₹10` in destructive color.
- Totals row: already does plain SUM → negative values will correctly subtract. No formula change.
- Summary mode cards (Cash/GPay/...): already SUM — will reflect net automatically.
- "Total Out (Refunds)" card (line 192): currently sums positive total_amount where direction = "out". Since we'll store negative `total_amount` for out, change to `Math.abs(total_amount)` to keep card display positive while individual rows show negatives.

### E. Filter logic for `modeFilter` (line 64–67)
Currently `Number(t[key] || 0) <= 0` → would hide negative refund rows when filtering by Cash. Change to `Number(t[key] || 0) === 0` (i.e. only hide rows with zero in that mode), so refunds appear in their mode filter.

### F. Existing data
The stale Refund row visible in the screenshot (invoice 2604160005, ₹10 cash refund) needs a one-time UPDATE to match the new schema:
- gross/discount/final/paid/due → 0
- cash_amount → -10
- total_amount → -10

## Files
- `src/lib/paymentTransactions.ts` — apply `sign` based on `direction` in `logPaymentTransaction`
- `src/components/lims/EditRegistrationDialog.tsx` — clear gross/discount/final/paid/due fields for refund logging calls (two sites)
- `src/components/lims/DailyReport.tsx` — render non-zero negative mode cells in red; fix mode filter; abs() the Total Out card
- One-time SQL UPDATE to fix existing refund + bill_cancellation rows in `payment_transactions` (no schema change)

## What stays the same
- Schema unchanged
- Audit trail intact — refund row still tagged `transaction_type: "refund"` with full remarks
- Discount-applied / due-collection / registration_payment behavior unchanged
- Net Collection card already correct (in − out)
