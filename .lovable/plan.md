## Problem

In **Results Entry**, **Result Verification**, and **Doctor Approval** the page footer shows large totals (e.g. "Page 1 of 4 (194 total)") and an "All caught up" empty state on the same page. Clicking **Next** then reveals real pending patients on later pages.

### Root cause

Each module:
1. Pulls **50 registrations** from `patient_registrations` filtered by a *broad* status list (e.g. Verification includes `verified`, `approved`, `dispatched` rows).
2. After fetching, filters down in JavaScript to only those with parameters/snips actually pending at this stage (`status === "entered"` for verification, `verified` for approval, etc.).
3. The pagination count uses the **broad** list (step 1), but the visible cards use the **narrow** filtered list (step 2). So a page can legitimately render 0 entries while the footer shows hundreds of "pending" rows that aren't actually pending.

This also explains why search results show "0 pending" yet older invoices appear after several Next clicks.

## Fix

Pagination must count and slice **only registrations that have at least one pending row at the current stage**. Compute the candidate `registration_id` set from the downstream tables first, then fetch the page from `patient_registrations` restricted to that set.

### Per-module candidate definitions

| Module | Candidate `registration_id`s = registrations with at least one of … |
|---|---|
| Results Entry | An `accepted` row in `sample_tubes` whose `test_id` has **no** `patient_results` row with a non-empty `result_value` or status in (`entered`, `results_entered`, `verified`, `approved`, `dispatched`), AND no `outsourced_test_snips` row with `outsource_status` past `pending`/`sent`. |
| Result Verification | A `patient_results` row with `status = 'entered'`, OR an `outsourced_test_snips` row with `outsource_status IN ('results_entered', 'entered')`. |
| Doctor Approval | A `patient_results` row with `status = 'verified'`, OR an `outsourced_test_snips` row with `outsource_status = 'verified'`. |

### Implementation

For each of `ResultsEntry.tsx`, `ResultVerification.tsx`, `DoctorApproval.tsx`:

1. **New "candidate ids" query** (runs whenever search/filters change, **not** when page changes):
   - Pull distinct `registration_id`s from the downstream table(s) using `fetchAllByIds`-style chunked pagination so the 1000-row Supabase cap doesn't truncate the candidate list.
   - For Results Entry: pull all accepted-tube `(registration_id, test_id)` pairs and all existing result/snip `(registration_id, test_id)` rows, then compute the set of regs that still have an unentered accepted test (mirrors `recalculateRegistrationStatus` logic).
2. **Apply search filter** (`patient_name / mobile / invoice / umr`) by intersecting the candidate id set with a separate id-only query against `patient_registrations`.
3. **Total count** = size of the resulting id set (replaces the current `count: "exact", head: true` query).
4. **Page query** = `patient_registrations.select(...).in("id", pageIds)` where `pageIds` is the slice for the current page after sorting by `is_stat desc, invoice_number desc`. Sort the id list in JS using a lightweight `(id, is_stat, invoice_number)` projection fetched once per filter change.
5. Reset `page` to 0 whenever the candidate id set changes (search edit, realtime invalidation).
6. Keep the existing `filteredEntries` JS filter as a safety net, but the empty state ("No results pending …") will now only appear when the **actual** total is 0.

### Realtime / propagation

`propagateRegistrationChange` already invalidates the `*_regs_count` and `*_regs_v2` keys for each module. The new candidate-id query will reuse the same query keys (`results_accepted_count` / `verification_regs_count` / `doctor_approval_count` and the corresponding `*_regs` keys) so existing invalidation in `src/lib/limsPropagation.ts` keeps working with no changes.

### Files to edit

- `src/components/lims/ResultsEntry.tsx` — replace count+page queries (lines ~190–226).
- `src/components/lims/ResultVerification.tsx` — replace count+page queries (lines ~126–160).
- `src/components/lims/DoctorApproval.tsx` — replace count+page queries (lines ~160–187).

No DB migration, no schema changes, no edge function changes.

### Result for the user

- "Page 1 of N (X total)" will reflect only registrations that genuinely have pending work at that stage.
- Page 1 will always show the first 50 truly-pending patients; "No results pending …" will only appear when there is nothing left to do.
- Same behavior across Results Entry, Result Verification, and Doctor Approval.
