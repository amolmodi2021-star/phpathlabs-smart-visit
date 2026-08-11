/**
 * Lean column lists for patient_results queue fetches.
 *
 * Purpose: cut Supabase egress without changing pipeline semantics.
 * Always include every field the target screen reads or writes through.
 * Do NOT use these for report PDF / approved_reports snapshots.
 */

/** Results Entry (+ orphan heal): pending/entered coverage, notes, interface flags */
export const PATIENT_RESULTS_SELECT_RESULTS =
  "id, registration_id, test_id, parameter_id, param_code, parameter_name, result_value, unit, reference_range, normal_range_low, normal_range_high, flag, status, is_calculated, is_from_interface, entered_at, entered_by, note, test_note";

/** Result Verification: entered rows + audit for verify upserts */
export const PATIENT_RESULTS_SELECT_VERIFICATION =
  "id, registration_id, test_id, parameter_id, param_code, parameter_name, result_value, unit, reference_range, normal_range_low, normal_range_high, flag, status, is_calculated, is_from_interface, entered_at, entered_by, note, test_note";

/** Doctor Approval: verified rows + entered/verified audit for approve upserts */
export const PATIENT_RESULTS_SELECT_DOCTOR =
  "id, registration_id, test_id, parameter_id, param_code, parameter_name, result_value, unit, reference_range, normal_range_low, normal_range_high, flag, status, is_calculated, is_from_interface, entered_at, entered_by, verified_at, verified_by, note, test_note";

/**
 * Dispatch: status + audit timestamps only.
 * Does not need result values / ranges (report uses approved_reports).
 */
export const PATIENT_RESULTS_SELECT_DISPATCH =
  "registration_id, test_id, status, entered_at, entered_by, verified_at, verified_by, approved_at, approved_by, dispatched_at, dispatched_by";

/** Modified Approval: editable approved rows */
export const PATIENT_RESULTS_SELECT_MODIFIED =
  "id, registration_id, test_id, parameter_id, param_code, parameter_name, result_value, unit, reference_range, normal_range_low, normal_range_high, flag, status, is_calculated, is_from_interface, entered_at, entered_by, verified_at, verified_by, approved_at, approved_by, note, test_note";