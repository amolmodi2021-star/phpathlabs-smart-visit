/**
 * Patient-scoped outsourced overrides for unit / reference range / flag.
 * Stored only on patient_results (+ approved_reports snapshot) — never on
 * report_test_parameters master rows.
 *
 * Flag rules:
 * - Default: always auto-flag from the current value vs range (H/L/N).
 * - Session edit (editedFlag !== undefined) wins immediately.
 * - After reload: if the value is unchanged and the saved flag differs from
 *   what auto would produce, treat saved flag as a manual override and keep it.
 * - Empty/null saved flag never blocks auto-flagging.
 */

export function resolveOutsourcedFlag(opts: {
  isOutsourced: boolean;
  /** Present when the user changed the flag this session (incl. cleared ""). */
  editedFlag: string | undefined;
  savedFlag: string | null | undefined;
  autoFlag: string;
  /** Current on-screen result (includes in-progress edits). */
  currentValue?: string | null;
  /** Last persisted result_value (baseline for detecting value edits). */
  savedValue?: string | null;
}): string {
  if (!opts.isOutsourced) return opts.autoFlag || "";
  if (opts.editedFlag !== undefined) return opts.editedFlag;

  const cur = String(opts.currentValue ?? "").trim();
  const savedVal = String(opts.savedValue ?? "").trim();
  const valueChanged = cur !== savedVal;

  // New entry or value edited → always recompute from range.
  if (valueChanged || !savedVal) {
    return opts.autoFlag || "";
  }

  const savedFlag = opts.savedFlag;
  // Never treat blank/null DB flag as a lock — that was blocking auto H/L.
  if (savedFlag == null || String(savedFlag) === "") {
    return opts.autoFlag || "";
  }

  const auto = opts.autoFlag || "";
  // Same value as saved: keep manual override only when it differs from auto.
  if (String(savedFlag) !== auto) {
    return String(savedFlag);
  }
  return auto;
}

export function resolveOutsourcedUnit(opts: {
  isOutsourced: boolean;
  editedUnit: string | undefined;
  savedUnit: string | null | undefined;
  masterUnit: string | null | undefined;
}): string {
  if (!opts.isOutsourced) return opts.masterUnit || "";
  if (opts.editedUnit !== undefined) return opts.editedUnit;
  if (opts.savedUnit != null) return opts.savedUnit;
  return opts.masterUnit || "";
}

/**
 * Prefer pasted/saved patient text as-is (advisory ranges, multi-line, etc.).
 * Master descriptive DisplayText is only a fallback when no patient row exists.
 */
export function resolveOutsourcedRefRange(opts: {
  isOutsourced: boolean;
  editedRef: string | undefined;
  savedRef: string | null | undefined;
  masterRef: string;
  rangeType?: string;
  normalRangeText?: string | null;
}): string {
  if (opts.isOutsourced) {
    if (opts.editedRef !== undefined) return opts.editedRef;
    if (opts.savedRef != null) return opts.savedRef;
    if (opts.rangeType === "descriptive") return opts.normalRangeText || opts.masterRef || "";
    return opts.masterRef || "";
  }
  if (opts.rangeType === "descriptive") return opts.normalRangeText || "";
  return opts.masterRef || "";
}

/** Load-time: use patient_results row when present (even empty string). */
export function loadOutsourcedUnit(
  isOutsourced: boolean,
  existing: { unit?: string | null } | null | undefined,
  masterUnit: string,
): string {
  if (isOutsourced && existing) return existing.unit ?? "";
  return masterUnit || "";
}

export function loadOutsourcedRefRange(
  isOutsourced: boolean,
  existing: { reference_range?: string | null } | null | undefined,
  masterRef: string,
  rangeType?: string,
  normalRangeText?: string,
): string {
  if (isOutsourced && existing) return existing.reference_range ?? "";
  if (rangeType === "descriptive") return normalRangeText || "";
  return masterRef || "";
}
