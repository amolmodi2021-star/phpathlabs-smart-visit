## Goal

Rename **Clear All Data** on Registered Patients to **Reset** — a true factory reset that wipes ALL patient/transactional LIMS data and snipped images, while preserving Home Visits, Estimates, all configuration, and the bidirectional interface code mappings.

## Scope

### Database tables — WIPED
- `patient_registrations` (bills, statuses, payments, refunds, cancellations)
- `patient_results` (results entry, verification, doctor approval state)
- `approved_reports` (immutable report snapshots)
- `outsourced_test_snips` (outsourced section data + URLs)
- `sample_tubes` (Sample Acceptance / Unique Sample IDs)
- `payment_transactions` (Daily Report, Due Payments, Bad Debts ledger)
- `patient_master` (UMR registry)
- `pickup_point_invoices`, `pickup_point_invoice_items`, `pickup_point_invoice_payments`
- `lims_test_orders`, `lims_unmapped_results`, `lims_interface_logs` (interface transactional queues only)
- `report_share_links`, `report_link_sessions`, `report_link_events`

### Storage buckets — CONTENTS WIPED
- `outsourced-snips` (all snipped images for outsourced tests)
- `report-uploads` (any patient-uploaded report snips)
- `prescriptions` (scanned patient prescriptions)

Buckets themselves kept; objects deleted by listing in pages of 1000 and calling `.remove(paths)` in batches of 100.

### Counters — RESET
- `invoice_counter` — emptied (next bill: YYMMDD0001)
- `sample_tube_counter` — emptied (next tube: S{YYMMDD}00001)
- `umr_counter.last_sequence` → 0 (next patient: UMR0000001)

### PRESERVED (NOT touched)
- **Home Visits**: `home_visits`, `phlebotomists`, `phlebotomist_leaves`
- **Estimates**: `estimates`, `estimate_tests`
- **Bidirectional interface mappings**: `lims_code_mapping`, `lims_no_map_required`
- **Configuration**: `tests`, `test_parameters`, `parameter_normal_ranges`, `report_test_parameters`, `test_sample_tubes`, `report_departments`, `billing_profiles`, `billing_profile_tests`, `profile_parameters`, `combos`, `combo_tests`, `combo_profiles`, `health_checkups`, `health_checkup_tests`, `health_checkup_profiles`, `channels`, `channel_prices`, `pickup_points`, `pickup_point_prices`, `standard_price_lists`, `standard_price_list_items`, `master_lookup`
- **Templates / branding**: `report_templates`, `report_layout_settings`, `report_profiles`, `pathologist_signatures`, `loyalty_card_templates`, `abnormal_card_templates`, `marketing_templates`, `message_templates`
- **Storage kept intact**: `signatures`, `letterheads`, `loyalty-cards`, `invoice-assets`, `chat-attachments`
- **App**: `app_users`, `app_roles`, `app_user_login_history`, `app_settings`, `webhook_messages`

## Implementation

### Edit `src/components/lims/RegisteredPatients.tsx`

- Rename button label `Clear All Data` → `Reset`, busy state `Clearing...` → `Resetting...`. Keep existing `clear_data` permission gate and `ExportPasswordDialog` master-password flow.
- Add a `window.confirm()` before opening the password dialog:
  > "FACTORY RESET — Permanently deletes ALL patient records, results, payments, reports, and snipped images. Resets UMR / invoice / sample tube counters. Home Visits, Estimates, configuration, and bidirectional interface mappings will be preserved. Cannot be undone."
- Replace the current `onSuccess` handler with:
  1. Delete from every table in the WIPED list (children before parents) using `.neq("id", "00000000-0000-0000-0000-000000000000")`.
  2. For each bucket in `["outsourced-snips", "report-uploads", "prescriptions"]`: paginate `.list("", { limit: 1000, offset })`, recurse into folders, batch `.remove(paths)` 100 at a time.
  3. Reset the three counters (empty `invoice_counter`/`sample_tube_counter`, set `umr_counter.last_sequence = 0`).
  4. `qc.invalidateQueries()` so all LIMS tabs refresh.
  5. Single try/catch with success/failure toast.

### Memory

Create `mem://features/lims/factory-reset` documenting exact wiped/preserved scope (explicitly noting `lims_code_mapping` and `lims_no_map_required` are preserved). Add a one-line reference to `mem://index.md`.

## Notes

- Completed Home Visits tab is rendered from `patient_registrations` joined with `home_visits` — wiping registrations clears the tab without touching `home_visits`.
- Daily Report / Due Payments / Bad Debts read from `payment_transactions` + `patient_registrations`, both wiped.
- No schema changes — pure data + storage deletion. No migration required.
