
# Per-Test Approver Signatures on Reports

## Problem
Currently, `approved_by` is stored once per registration in the `approved_reports` table. The report shows a single signature on every page. If Dr. Hemang approves some tests and Dr. Patel approves others, only the last approver's signature appears everywhere.

## Solution
Store `approved_by` inside each test result entry in the `test_results` JSONB. On the report, each page resolves signatures from the approvers of the tests on that page.

## Changes

### 1. DoctorApproval.tsx — Store `approved_by` per test result
When building the `test_results` snapshot entries, add `approved_by: getCurrentUser()?.display_name || "Doctor"` to each individual test result object (alongside `test_id`, `parameter_id`, etc.). This way each test knows who approved it.

### 2. LimsReportView.tsx — Per-page signature resolution
- Remove the single `signatureData` state. Instead, store all signatures + their resolved image URLs in a map.
- Fetch all `pathologist_signatures` and all `app_users` for mapped entries. Build a lookup: `display_name → signature data`.
- For each page, collect unique `approved_by` values from the test blocks on that page.
- Render one `ReportSignatureBlock` per unique approver on that page, displayed side by side (flex row).

### 3. ReportSignatureBlock.tsx — Support multiple signatures
Update the component to optionally render multiple signatures side by side, or the parent will simply render multiple instances in a flex row.

### 4. PageContent type — Track approvers per page
Add `approvers` field to the `PageContent` type so each page knows which doctors' signatures to show.

## Technical Flow
```text
Approval:
  test_results[i].approved_by = "Dr. Hemang"   ← per-test

Report View:
  Page has blocks [Test A (approved_by: Dr. Hemang), Test B (approved_by: Dr. Patel)]
  → Show both Dr. Hemang's and Dr. Patel's signatures on that page

  Page has blocks [Test C (approved_by: Dr. Hemang)]
  → Show only Dr. Hemang's signature
```

## Files to modify
- **`src/components/lims/DoctorApproval.tsx`** — Add `approved_by` to each test result snapshot entry
- **`src/pages/LimsReportView.tsx`** — Replace single signature with per-page multi-signature resolution
- **`src/components/report/ReportSignatureBlock.tsx`** — Minor layout adjustment for multiple signatures

No database migration needed — `approved_by` is stored inside existing JSONB `test_results` column.
