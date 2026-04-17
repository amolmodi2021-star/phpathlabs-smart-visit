

## Root cause
`isCrossDay` compares `format(new Date(reg.created_at), "dd-MM-yyyy")` vs today. But `created_at` is a UTC timestamp and `format(new Date(...))` uses browser local TZ, which can disagree with the **invoice number's YYMMDD prefix** (the authoritative bill-date used everywhere in the UI).

For invoice `2604160004`: prefix says 16-04-2026, but `created_at` (2026-04-16 20:07 UTC) when read in some local TZs evaluates to a different day than the prefix. Result: same-day → wrong `Refund` label instead of `Old Bill Refund`.

## Fix
Replace `created_at`-based cross-day detection with **invoice-number prefix** comparison. The YYMMDD prefix is atomic, user-visible, and already the column shown as "Invoice Date".

Helper (inline at each site, or a tiny shared util):
```ts
const invDateStr = (inv?: string | null) => {
  if (!inv || inv.length < 6 || !/^\d{6}/.test(inv)) return format(new Date(), "dd-MM-yyyy");
  return `${inv.slice(4,6)}-${inv.slice(2,4)}-20${inv.slice(0,2)}`;
};
const isCrossDay = invDateStr(reg.invoice_number) !== format(new Date(), "dd-MM-yyyy");
```

## Files to edit
- **`src/components/lims/EditRegistrationDialog.tsx`** — 3 sites (lines ~345-347, ~531-533, ~594-596). Replace `reg.created_at`/`regDateStr` logic with invoice-number-prefix check.
- **`src/components/lims/DuePayments.tsx`** — 1 site (lines ~136-138). Same replacement using `selected.invoice_number`.

## Backfill historical row
The existing mislabeled row for `2604160004` (id `7eb30218-...`, type `refund`, ₹10) needs relabeling to `old_bill_refund`. Will run a targeted SQL update comparing invoice-number prefix vs `transaction_date` IST date for all rows.

## What stays
No DB schema changes. No UI changes. Only the cross-day detection source flips from `created_at` → invoice-number prefix.

