## Goal

Refine the Phlebo Dashboard payout logic so it correctly tracks home‑visit charges across cancellations and refunds, and add a drill‑down dropdown that shows exactly which patients are contributing to each phlebotomist's "On Hold" bucket.

## Refined payout rules

The dashboard reads `patient_registrations` joined to its `home_visit_id`. For each Registered home visit linked to a registration:

| Situation in `patient_registrations` | Bucket |
|---|---|
| `bill_cancelled = true` (whole bill cancelled) | **Deducted** — subtract `estimates.home_visit_charges` (the original amount the phlebo "earned") |
| `home_visit_charges = 0` AND original HVC > 0 (HVC was refunded later) | **Deducted** — subtract the original HVC |
| `bill_cancelled = false`, current `home_visit_charges > 0`, `due_amount = 0` | **Earned** — add current `home_visit_charges` |
| `bill_cancelled = false`, current `home_visit_charges > 0`, `due_amount > 0` | **On Hold** — add current `home_visit_charges` |
| `bill_cancelled = false`, current `home_visit_charges > 0`, all tests cancelled but HVC kept | **Earned** — same rule as above; HVC > 0 means phlebo gets paid |

Key insight: the LIMS already zeros `patient_registrations.home_visit_charges` when the user clicks "refund home visit". So the live value of that column is the source of truth for "does the phlebo still earn this". Comparing it to the estimate's original HVC tells us whether a refund happened.

For cancelled bills (`bill_cancelled = true`), we always deduct because the entire transaction is reversed regardless of refund flag state.

`Net Payable = Earned − Deducted` (Hold remains informational until either the due is collected → Earned, or the bill/HVC is refunded → Deducted).

## Changes

### 1. `src/pages/PhleboDashboard.tsx` — extend data fetch + bucket logic

- Keep the existing query for Registered home_visits (already done in prior change) and for the parent `estimates` (to read the original `home_visit_charges`).
- Add a query for `patient_registrations` filtered by `home_visit_id IN (…visitIds)` selecting `id, home_visit_id, home_visit_charges, due_amount, bill_cancelled, refund_amount, patient_name, mobile_number, invoice_number, tests, created_at`.
- Build per‑phlebotomist, per‑month buckets using the table above. The "original HVC" comes from the linked estimate; the "current HVC" comes from the registration row.
- Bucket the visit into the month corresponding to `home_visits.visit_date` (already used today).

### 2. New dashboard section: **Home Visit Payout Summary** (per phlebotomist)

Replace/augment the existing summary card with a per‑phlebo card that shows, for the current and previous month:

- Earned: ₹X
- On Hold: ₹Y
- Deducted: −₹Z
- **Net Payable: ₹(Earned − Deducted)** (bold)

### 3. Drill-down dropdown for "On Hold"

When the user clicks the **On Hold** value (or a small caret next to it) for a given phlebotomist + month, expand an inline panel showing every patient contributing to that hold, with full visit details:

- Patient name (+ title), UMR, mobile
- Invoice number
- Visit date (dd-MM-yyyy) + visit time
- Address
- Tests list (test names, comma-separated, with count badge)
- Home Visit Charges (held amount)
- Final amount, Paid, **Due** (highlighted)
- Status badge

Implementation details:
- Use a `<Collapsible>` (or local state map of `expandedKey → boolean`, where key is `${phleboId}-${currentOrPrevious}`) so multiple sections can stay open independently.
- Render each row as a compact card (mobile-friendly) inside the collapsed panel.
- Visit details (`visit_date`, `visit_time`, `address`) come from the already-fetched `home_visits` rows; tests come from the registration's `tests` JSONB; due/HVC come from `patient_registrations`.
- Optionally also offer a small "Deducted" drill-down using the same UI pattern (cheap to add and useful for audit) — included by default unless the user objects.
- The "Earned" value stays as a plain number (no drill-down needed; the existing "Home Visit Charges (Registered)" section already lists totals).

### 4. Performance / data-flow

- All extra fetches are scoped by the visit IDs already loaded for the current/previous-month window, so payload stays small.
- All bucketing happens client-side in a single `useMemo`, returning two structures:
  - `summary[phleboId][month] = { earned, hold, deducted }`
  - `holdDetails[phleboId][month] = Array<{visit, registration, estimate}>` (and the same for `deductedDetails`)
- React Query keys reuse the existing visit-window keys so a refresh propagates automatically.

## Out of scope / non-changes

- No DB schema or migration changes — all logic is derived live from `home_visits`, `estimates`, and `patient_registrations`.
- No change to how cancellations/refunds are recorded in LIMS; we only consume the resulting state.
- Incentive section is unchanged (separate from HVC payout).
