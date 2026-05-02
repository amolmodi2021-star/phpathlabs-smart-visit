## Problem (confirmed via DB inspection)

Two registrations are stuck with `status = 'approved'` even though real work is still pending:

- **2605020012 (RUCHI KUMAR)** — URINE ALB./CREAT RATIO is on an accepted tube but has **zero** `patient_results` rows and **zero** outsourced snip rows. The test was effectively skipped.
- **2605020013 (LISHA JAIN)** — LH, FSH, PROLACTIN are on an accepted tube. They have outsourced snip rows but in `outsource_status = 'pending'` (snip not entered yet). Only TFT was approved.

Because Dispatch is the **only** queue that does not filter on `status` (it shows everything in the date range), these registrations appear there but are invisible to Results Entry, Verification, Doctor Approval, Sample Acceptance, etc.

### Root causes

1. **DoctorApproval bypasses `recalculateRegistrationStatus`.** Lines 530 and 608 of `src/components/lims/DoctorApproval.tsx` directly write `status = 'approved'` whenever the *currently-loaded* `patient_results` rows are all approved — without checking whether every accepted-tube test actually has a result/snip row. If a test on an accepted tube was never entered (or the tube list expanded after entry started), it silently gets left behind.

2. **`limsStatus.ts` guard treats a `pending` outsourced snip as "tracked".** The `trackedTestIds` set adds *any* snip regardless of its status, so a snip that was created at acceptance time but never has results entered is wrongly considered "in progress" and the guard does not downgrade `approved → partially_approved`.

## Fix plan

### 1. Tighten the recalc guard in `src/lib/limsStatus.ts`
- When building `trackedTestIds`, only count an `outsourced_test_snips` row if its `outsource_status` is in `['entered','results_entered','verified','approved','dispatched']` (same set already used for `downstream`). A `pending` or `sent` snip means work is still pending and must NOT shield the test from being flagged as untracked.
- Same principle for `patient_results`: only count rows with non-empty `result_value` OR `status` past pending. (A row left at `pending` with no value still means entry is not done.)

### 2. Stop bypassing recalc in Doctor Approval
In `src/components/lims/DoctorApproval.tsx`:
- Remove the two direct `update({ status: 'approved' })` writes (around lines 530 and 608) and the line 342 dispatch direct write equivalent in approval flows.
- Rely on `propagateRegistrationChange` (already called downstream) to run `recalculateRegistrationStatus`, which will correctly produce `partially_approved` when an accepted-tube test still has no real results.

### 3. Self-healing fallback so a "lost" registration always resurfaces
Even with #1 and #2 fixed, historical rows (like the two reported) need to reappear. Add a small safety net:

- Extend the `ResultsEntry` query (and Verification, Doctor Approval) status filter to also include the terminal statuses (`approved`, `dispatched`, `partially_dispatched`) **but** only when filtering down by tube/result presence. Concretely:
  - In `ResultsEntry.tsx`, additionally fetch registrations whose `status IN ('approved','dispatched','partially_approved','partially_dispatched')` AND that have at least one accepted-tube test with no `patient_results`/no terminal snip. This is done client-side after the existing fetch by also pulling registrations where ANY accepted tube test is untracked. To keep cost low, scope it to the same date range already in use.
- Document this as a "lost-record rescue" pass.

### 4. One-off correction migration for the two known records
A read-only migration that recomputes status for any registration whose stored `status` is terminal (`approved`/`dispatched`) but where at least one accepted-tube test_id has neither a non-pending `patient_results` row nor a non-pending `outsourced_test_snips` row. Set those to `partially_approved` (so they re-enter Results Entry, Verification, Doctor Approval queues). This fixes 2605020012 and 2605020013 immediately and any other historic stragglers.

### 5. Future prevention
Add an inline check in `recalculateRegistrationStatus` that, when it computes a terminal status (`approved`/`dispatched`) but `hasUntrackedAcceptedTest` is true, logs a `console.warn` with the registration id. This makes any future regression visible during QA without breaking flows.

## Files to change

- `src/lib/limsStatus.ts` — tighten guard (snip status filter; result_value/status filter).
- `src/components/lims/DoctorApproval.tsx` — remove the two direct status writes; let propagation recalc.
- `src/components/lims/ResultsEntry.tsx` — add lost-record rescue fetch.
- New migration — one-off recompute for terminal-status rows with untracked accepted-tube tests.

## Out of scope

- No schema changes. No RLS changes. No UI redesign. This is purely a status-recalculation correctness fix plus a rescue net.
