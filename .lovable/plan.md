# Add Refresh Button to All LIMS Stages

## Problem
When one user saves changes, other users don't see the updates until they manually refresh the browser. We need a one-click refresh control on every workflow stage so users can pull the latest data on demand without reloading the whole page (and losing filters/search/scroll position).

## Solution
Add a small **Refresh** button (icon + label, top-right of each section's header / filter row) to every LIMS stage listed below. Clicking it will:

1. Invalidate and refetch all React Query caches used by that page (so we get fresh data instantly without losing the user's filters, search text, pagination, or scroll position).
2. Show a brief spinning icon while the refetch is in progress.
3. Show a small toast ("Refreshed") on completion.

This is faster and more user-friendly than `window.location.reload()` while achieving the same goal — guaranteed fresh data on demand.

## Stages to update

| # | Component | File |
|---|---|---|
| 1 | Sample Collection | `src/components/lims/SampleCollection.tsx` |
| 2 | Sample Acceptance | `src/components/lims/SampleAcceptance.tsx` |
| 3 | Results Entry | `src/components/lims/ResultsEntry.tsx` |
| 4 | Result Verification | `src/components/lims/ResultVerification.tsx` |
| 5 | Doctor Approval | `src/components/lims/DoctorApproval.tsx` |
| 6 | Dispatch | `src/components/lims/Dispatch.tsx` |
| 7 | Due Payments | `src/components/lims/DuePayments.tsx` |
| 8 | Bad Debts | `src/components/lims/BadDebts.tsx` |
| 9 | Billing (Generate + Dashboard) | `src/components/lims/BillingGenerate.tsx`, `src/components/lims/BillingDashboard.tsx` |
| 10 | Daily Report | `src/components/lims/DailyReport.tsx` |
| 11 | Completed Home Visits | `src/components/lims/CompletedHomeVisits.tsx` |

## UI design

A consistent button placed at the top-right of each stage's header / filter bar:

```text
[ ⟳ Refresh ]
```

- Variant: `outline`, size `sm`
- Icon: `RefreshCw` from `lucide-react` (spins via `animate-spin` while refetching)
- Tooltip: "Reload latest data from server"

## Technical details

Create a small reusable component `src/components/lims/RefreshButton.tsx`:

```tsx
type Props = { queryKeys: string[]; label?: string };
```

It uses `useQueryClient()` to invalidate every key in `queryKeys` with `refetchType: "active"`, tracks an `isRefreshing` state, and renders the spinning icon + toast.

For each stage, pass the page-specific query keys (e.g. for Sample Collection: `["sample_tubes_collection", "sample_collection_regs", "patient_registrations", "pickup_points_lookup"]`). Keys are already known from the existing `useQuery`/`invalidateQueries` calls in each file.

No DB, edge function, or schema changes are required.

## Out of scope

- Auto-refresh / realtime subscriptions (the user explicitly asked for a manual button only).
- Changes to non-LIMS pages (CRM, Marketing, etc.).
