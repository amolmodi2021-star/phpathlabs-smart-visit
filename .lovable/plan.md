## Problem

When a patient's demographic details (name, title, gender, DOB, mobile, email, address, doctor) are edited from the Registered Section, the change only updates the current registration row. Other modules — Dispatch, the printed report, CRM, Patient Master, LIMS analyzer queue — keep showing the old values. Worse, **previous visits of the same patient (same UMR)** keep their old details too, so historical records are inconsistent.

The user also needs the edit dialog to remain usable **after doctor approval**, since patients sometimes ask for spelling corrections once the report is already signed off.

## Fix

### A. Fan-out to ALL records of the same UMR

When the dialog saves, after updating the current `patient_registrations` row, also update every other table that holds a copy of patient demographics — **for every record sharing the same UMR**, not just the current invoice. UMR is the patient identity key.

| Table | Match key | Fields synced |
|---|---|---|
| `patient_registrations` (all visits of this UMR) | `umr_number` | name, title, gender, dob, mobile, email, address, doctor |
| `approved_reports` (all approved reports of this UMR) | `umr_number` | name, title, gender, dob, mobile, email, address, doctor |
| `lims_test_orders` | `sample_id` IN (all invoice numbers of this UMR) | patient_name |
| `crm_contacts` | `umr_number` | name, mobile, doctor |
| `patient_master` | `umr_id` = umr_number | name, gender, mobile, email, date_of_birth |
| `loyalty_cards` | `umr` = umr_number | patient_name |
| `estimates` | `umr_number` | name, title, gender, dob, email, doctor |

**Audit-trail tables intentionally NOT touched** (immutable historical record of what was sent at that moment): `message_send_log`, `drip_campaign_log`, `abnormal_history`, `payment_transactions`, `pickup_point_invoice_items`.

### B. Allow edits after doctor approval

Currently the Edit button hides / disables the dialog once the registration moves into approved/dispatched status. Remove that gate for the **demographics-only fields** (name, title, gender, DOB, mobile, email, address, doctor). Discount/test edits stay locked after approval as today — only demographics are unlocked, since that's the only after-approval correction patients request.

The edit will continue to update the immutable `approved_reports` snapshot for this patient, so when the report PDF is reprinted it shows the corrected demographics. Clinical content (results, ranges, signatures) remains untouched.

### C. Refresh all module caches after a save

The dialog currently invalidates only `["patient_registrations"]`. Each LIMS module uses its own React Query key (e.g. `dispatch_regs`, `sample_collection_regs`, `results_entry_regs`, `verification_regs`, `doctor_approval_regs`, `registered_patients`, `due_payments`, `bad_debts`, `crm_contacts`, `patient_master`, `lims_report_view`). Add a single `invalidatePatientCaches(qc)` helper that fans out to all of them so the UI updates instantly across every open tab — including the user's mobile phone via the existing realtime subscription.

## Technical Notes

- **Single transaction-style block**: After the existing `supabase.from("patient_registrations").update(...)` succeeds, run a `Promise.all([...])` block doing the seven cross-table updates above. Wrap the cross-table block in `try/catch` and surface a non-fatal toast if any sub-update fails — the primary update has already succeeded so the user isn't blocked.
- **UMR fan-out scope**: All updates filter on `eq("umr_number", umr)` (or the table-specific column name). If `umr_number` is missing on the current registration, fall back to updating only the current `id` (defensive — avoids accidentally touching unrelated rows).
- **Edit dialog gating change**: Locate the status guards in `EditRegistrationDialog.tsx` / `RegisteredPatients.tsx` that disable the Edit button after approval. Keep the guard for tests/discount panels; expose the demographics tab regardless of `status`. The Save button remains active whenever any demographics field is dirty.
- **Realtime fan-out already wired**: `useRealtimeSync('patient_registrations', [...])` is in most modules. Just confirm each module's subscription includes its own derived query key in the invalidation list so the user's mobile phone sees the change within ~400 ms.
- **No schema migration**. Pure client + cache fix.

## One-time Backfill for Invoice 2604250025

For the specific invoice the user already corrected (`ALKA JANI` → `ALKA JAIN`, UMR `UMR0000049`), do the same UMR-keyed fan-out as a one-time data fix so existing CRM/patient_master/lims_test_orders rows immediately reflect `ALKA JAIN`. No `approved_reports` row exists for this invoice yet, so that table needs no backfill for this UMR.

## Out of Scope

- Editing demographics from places other than the Registered Section edit dialog (e.g. directly inside CRM) — separate feature.
- Re-sending past WhatsApp messages with the corrected name.
- Touching clinical content of `approved_reports` (results, reference ranges, pathologist signatures).
