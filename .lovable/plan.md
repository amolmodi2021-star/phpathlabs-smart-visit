

# Ensure Report Signature Immutability

## Current State
- `approved_by` (doctor's display name) is stored per-test inside the `test_results` JSONB snapshot — this is immutable and correct.
- However, qualification, designation, and signature image are **fetched live** from `pathologist_signatures` at report view time.
- If a doctor's signature, qualification, or designation is later changed or deleted, **old reports would show the new/missing data** instead of what was valid at approval time.

## Solution: Snapshot Signature Details at Approval Time

Store the full signature details (name, qualification, designation, signature image URL) inside the `approved_reports` snapshot alongside `approved_by`, so reports are **100% self-contained** and never affected by future changes.

### Changes

#### 1. `DoctorApproval.tsx` — Snapshot signature details per test
- When approving, look up the current user's mapped signature from `pathologist_signatures` (by `mapped_user_id` matching the logged-in user).
- Store in each test result entry:
  - `approved_by` (display name) — already done
  - `approved_by_qualification` (string)
  - `approved_by_designation` (string)
  - `approved_by_signature_url` (full public URL of signature image)

#### 2. `LimsReportView.tsx` — Prefer snapshot data, fall back to live lookup
- When resolving signatures for each page, first check if the test results contain `approved_by_qualification`, `approved_by_designation`, `approved_by_signature_url`.
- If present, use those (immutable snapshot).
- If absent (older reports before this change), fall back to the current live lookup from `pathologist_signatures` — maintaining backward compatibility.

### Files to modify
- **`src/components/lims/DoctorApproval.tsx`** — Fetch and embed signature details at approval time
- **`src/pages/LimsReportView.tsx`** — Prefer embedded signature data, fall back to live lookup

### No database migration needed
All data is stored in existing JSONB columns.

### Result
- Reports approved after this change will **always** show the exact signature, qualification, and designation from the moment of approval — even if the doctor's details are later updated or the signature record is deleted.
- Old reports continue to work via the existing live lookup.

