

# Performance Optimization Plan for 1 Lakh+ Patients

## Current State

After reviewing your codebase and database, here's what I found:

**Already good:**
- `patient_results` has indexes on `registration_id`, `parameter_id`, `status`
- `sample_tubes` has indexes on `registration_id`, `status`
- `approved_reports` has indexes on `registration_id`, `invoice_number`, `umr_number`
- Server-side pagination exists in RegisteredPatients (page of 20)
- Debounced search (400ms) is used throughout

**Problems that will hurt at scale:**

1. **Missing critical indexes** on `patient_registrations` — no index on `created_at`, `status`, `mobile_number`, `patient_name`, `umr_number`, or `bill_cancelled`. Every query filtering/sorting by these columns will do full table scans.

2. **No pagination in Dispatch, SampleCollection, DoctorApproval, ResultsEntry** — these fetch ALL matching registrations with `select("*")` and no `LIMIT`. At 1 lakh records, these queries will return thousands of rows and crash the browser.

3. **Cascading unbounded queries** — Dispatch fetches all registrations, then fetches ALL `patient_results`, `sample_tubes`, and `outsourced_test_snips` for those IDs using `.in()`. With hundreds of registrations, the `.in()` clause becomes massive.

4. **SampleCollection fetches ALL pending/collected tubes** with no date filter or limit — this will grow unbounded.

5. **`select("*")`** everywhere — fetching all columns when only a few are needed wastes bandwidth.

---

## Plan

### Step 1: Add Database Indexes (Migration)

Add indexes on the most-queried columns:

```sql
-- patient_registrations: the most queried table
CREATE INDEX idx_pr_created_at ON patient_registrations (created_at DESC);
CREATE INDEX idx_pr_status ON patient_registrations (status);
CREATE INDEX idx_pr_bill_cancelled ON patient_registrations (bill_cancelled);
CREATE INDEX idx_pr_mobile_number ON patient_registrations (mobile_number);
CREATE INDEX idx_pr_umr_number ON patient_registrations (umr_number);
CREATE INDEX idx_pr_patient_name ON patient_registrations USING gin (patient_name gin_trgm_ops);

-- Composite index for Dispatch's most common query pattern
CREATE INDEX idx_pr_cancelled_created ON patient_registrations (bill_cancelled, created_at DESC);

-- patient_results: composite for common lookups
CREATE INDEX idx_pr_reg_status ON patient_results (registration_id, status);

-- outsourced_test_snips: registration lookup
CREATE INDEX idx_ots_registration ON outsourced_test_snips (registration_id);

-- patient_master
CREATE INDEX idx_pm_mobile ON patient_master (mobile_number);
CREATE INDEX idx_pm_umr ON patient_master (umr_id);
```

### Step 2: Add Pagination to Dispatch

- Add `LIMIT 50` + cursor/offset pagination to Dispatch queries
- Only fetch results/tubes/snips for the visible page of registrations (not all)
- Show page count and prev/next buttons

### Step 3: Add Pagination to SampleCollection

- Add a date filter (default last 7 days) similar to Dispatch
- Add `LIMIT` to the sample_tubes query
- Paginate the registration list

### Step 4: Add Pagination to DoctorApproval & ResultsEntry

- Same pattern: limit registrations fetched, paginate the list
- Only load detailed results when a patient is expanded/selected

### Step 5: Optimize Column Selection

- Replace `select("*")` with specific columns in list views (e.g., `select("id, invoice_number, patient_name, mobile_number, status, created_at, is_stat, umr_number, tests, bill_cancelled")`)
- Keep `select("*")` only when editing/viewing full details

### Step 6: Add Pagination to RegisteredPatients Export

- The "Export All" function uses an RPC that returns every row with no limit — at 1 lakh rows this will timeout
- Add date range filter to the export dialog so users export in batches

---

## Technical Details

**Files to modify:**
- `src/components/lims/Dispatch.tsx` — add pagination, column selection
- `src/components/lims/SampleCollection.tsx` — add date filter + pagination
- `src/components/lims/DoctorApproval.tsx` — add pagination
- `src/components/lims/ResultsEntry.tsx` — add pagination
- `src/components/lims/RegisteredPatients.tsx` — optimize export
- Database migration for indexes

**Estimated scope:** 6 files modified, 1 migration

