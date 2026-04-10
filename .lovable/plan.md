

# Dispatch Section — Audit Trail with Timestamps

## Problem
Currently, the right panel in Dispatch only shows a single status badge per test. The user wants a full vertical audit trail for each test showing: Sample Collected, Results Done, Verified, and Dispatched — each with date/time when available.

## Data Gap
The `patient_results` table lacks dedicated timestamp columns for each lifecycle step. Currently only `created_at` and `updated_at` exist. The `sample_tubes` table has `collected_at` and `accepted_at`.

## Plan

### Step 1 — Database Migration
Add timestamp columns to `patient_results`:
- `entered_at` (timestamptz, nullable) — set when results are saved
- `verified_at` (timestamptz, nullable) — set when status changes to "verified"  
- `approved_at` (timestamptz, nullable) — set when status changes to "approved"
- `dispatched_at` (timestamptz, nullable) — set when status changes to "dispatched"

### Step 2 — Update Result Entry, Verification, Approval, Dispatch code
Wherever status transitions happen (ResultsEntry, ResultVerification, DoctorApproval, Dispatch), also set the corresponding timestamp column. For example:
- ResultsEntry: set `entered_at = now()` when saving results
- ResultVerification: set `verified_at = now()` when verifying
- DoctorApproval: set `approved_at = now()` when approving
- Dispatch: set `dispatched_at = now()` when dispatching

### Step 3 — Update Dispatch Right Panel UI
Replace the current single-line test card with a vertical audit trail per test:

```text
┌─────────────────────────────────────────────────────┐
│ CBC (Complete Blood Count)              [Dispatch]  │
│                                                     │
│  ● Sample Collected    10-04-2026, 08:30 AM         │
│  ● Results Done        10-04-2026, 10:15 AM         │
│  ● Verified            10-04-2026, 11:00 AM         │
│  ○ Dispatched          —                            │
└─────────────────────────────────────────────────────┘
```

- Filled circle (●) + green text for completed steps with timestamp
- Empty circle (○) + muted text for pending steps
- All labels and timestamps vertically aligned using a consistent grid layout
- Fetch `sample_tubes` data (already partially available) to get `collected_at`
- Use the new columns on `patient_results` for the remaining timestamps

### Step 4 — Fetch additional data in Dispatch query
Extend the existing `allResults` query to include the new timestamp fields (`entered_at`, `verified_at`, `approved_at`, `dispatched_at`). Also fetch `sample_tubes` with `collected_at` for each registration to populate the collection step.

### Files Modified
- `src/components/lims/Dispatch.tsx` — UI redesign + fetch tubes data
- `src/components/lims/ResultsEntry.tsx` — set `entered_at`
- `src/components/lims/ResultVerification.tsx` — set `verified_at`
- `src/components/lims/DoctorApproval.tsx` — set `approved_at`
- Database migration for new columns

