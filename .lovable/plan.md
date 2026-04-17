
## Root cause — confirmed via DB query

For invoice **2604170001**:
- T3 stored with `approved_by = "Administrator"` (and qualification/designation/signature URL all null because Administrator has no `pathologist_signatures` row)
- T4, TSH stored with `approved_by = "Dr. DEVANG PATEL"`
- CBC stored with `approved_by = "Dr. HEMANG JADAWALA"`

**Why "Administrator" appears**: In `DoctorApproval.tsx` (lines 290, 326, 397, 416), the code uses `getCurrentUserName()` — the display_name of whoever is logged in. When T3 was clicked-Approve, the active session was the **Administrator** account (no signature mapping), so that name was burned into both `patient_results.approved_by` (audit trail) and `approved_reports.test_results[].approved_by` (signature snapshot).

**Why both signatures don't show**: `LimsReportView` (lines 668-720) already correctly renders **all unique approvers per page side-by-side**. That logic is fine — but it can only show what's stored. With "Administrator" stored, it tries `signatureMap["administrator"]` → not found → fallback to first available signature (Dr. DEVANG). Hence only one signature appears.

So this is fundamentally a **data integrity bug at approval time** — anyone, including Administrator users without a doctor signature, can stamp their name as the approver.

---

## Fix plan (3 parts)

### Part 1 — Data patch for the existing T3 record
- `UPDATE patient_results SET approved_by='Dr. HEMANG JADAWALA' WHERE registration_id IN (SELECT id FROM patient_registrations WHERE invoice_number='2604170001') AND test_id = T3_id;`
- `UPDATE approved_reports`: in the `test_results` JSONB array, replace `approved_by`, `approved_by_qualification`, `approved_by_designation`, `approved_by_signature_url` for rows where `test_id = T3_id` with Dr. HEMANG's snapshot pulled from `pathologist_signatures`.
- Audit trail in Dispatch will then show "Approved by Dr. HEMANG JADAWALA" and the report page containing T3/T4/TSH will render **both** Dr. HEMANG + Dr. DEVANG signatures (logic already supports it).

### Part 2 — New "Approve as doctor" capability for non-pathologist users
**Schema (migration):**
- Add `app_users.can_approve_as_doctor BOOLEAN DEFAULT false` — a per-user toggle Admin can grant.

**User Management UI (`src/pages/UserManagement.tsx`):**
- Add a checkbox "Allow approving on behalf of doctors" in the user add/edit dialog.
- Stored on `app_users.can_approve_as_doctor`.

### Part 3 — Approval flow gate in Doctor Approval
In `DoctorApproval.tsx`, change `approveTest` and `approveAllForPatient` so they check the current user's mapping:

1. **Pathologist user** (has `pathologist_signatures.mapped_user_id = current.id`) → unchanged: approve directly using their own signature.
2. **Non-pathologist user**:
   - **Without `can_approve_as_doctor`** → show toast warning **"You don't have permission to approve. Ask Admin to grant approval rights or sign in as a pathologist."** Block the approval.
   - **With `can_approve_as_doctor`** (e.g. Administrator) → open a new `SelectApproverDialog`:
     - Shows confirmation message: "You are not a registered pathologist. Select which doctor's signature to use for this approval."
     - Lists active doctors (rows from `pathologist_signatures` whose `mapped_user_id` belongs to an `app_users.is_active = true`).
     - User picks a doctor → on confirm, the approval proceeds with the **selected doctor's** name + qualification + designation + signature URL stamped into both `patient_results.approved_by` and `approved_reports.test_results[].approved_by_*`.
     - The audit trail will reflect the chosen doctor (matches the user's expectation that audit shows the actual signing pathologist, not "Administrator").
   - Optional but recommended: also append actor info as a separate `approved_on_behalf_by` column later. **Out of scope** for this fix — keep audit single-field for now per user request.

### New file
- `src/components/lims/SelectApproverDialog.tsx` — modal listing active pathologists with radio selection + Confirm button.

### Files touched
- `src/pages/UserManagement.tsx` — add toggle in user dialog (~10 lines).
- `src/components/lims/DoctorApproval.tsx` — gate approval flow, fetch selected doctor's signature, swap stamped fields (~40 lines split between `approveTest` and `approveAllForPatient`).
- `src/components/lims/SelectApproverDialog.tsx` — new file (~80 lines).
- Migration: add `app_users.can_approve_as_doctor` column.
- Data patch: 1 migration to fix existing T3 record on invoice 2604170001.

## Behavior matrix after fix

| Logged-in user | Has pathologist mapping? | `can_approve_as_doctor` | On clicking Approve |
|---|---|---|---|
| Dr. HEMANG | Yes | n/a | Approves with own signature (unchanged) |
| Dr. DEVANG | Yes | n/a | Approves with own signature (unchanged) |
| Administrator | No | true (granted by admin) | Dialog opens → pick doctor → approval stamped with chosen doctor |
| Receptionist | No | false (default) | Blocked with toast: "You don't have permission to approve" |

## Multi-signature on same page
Already implemented at `LimsReportView.tsx:711-720` — renders all unique approvers found in the page's `testBlocks` side-by-side. No changes needed; will start working correctly once T3 carries the right `approved_by` value.

## Out of scope
- No change to `LimsReportView` rendering (already correct).
- No change to entry/verification audit fields — only the approval step gets the gate.
- No bulk historical re-attribution — only T3 on 2604170001 (the user-flagged record). Other historical "Administrator"-approved records can be patched on request.
