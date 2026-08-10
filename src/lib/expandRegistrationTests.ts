/**
 * Reconciles a registration's stored `tests` selection with the leaf test IDs
 * actually attached to its sample tubes (or any other authoritative leaf set).
 *
 * Why this exists:
 *   `patient_registrations.tests` stores the *original billing selection* — it
 *   may contain Profile (PRL) or Health Check-up (HLT) container rows whose
 *   `test_id` references `billing_profiles.id` or `health_checkups.id`, NOT a
 *   leaf `tests.id`. The technical-stage modules (Results Entry, Verification,
 *   Doctor Approval, Dispatch) need leaf test IDs to look up parameters and
 *   match against tubes / patient_results.
 *
 * The leaf set passed in (`leafTestIds`) is the ground truth — typically the
 * union of `sample_tubes.test_ids` for that registration, which the registration
 * step already expanded via the same logic in `buildSampleTubeGroups`.
 *
 * Behaviour:
 *   - Keeps every row from `regTests` whose `test_id` IS in the leaf set
 *     (these are real leaf tests that were billed individually).
 *   - Drops any row whose `test_id` is NOT in the leaf set (those are
 *     PRL/HLT container rows that have no parameters).
 *   - Adds synthetic rows for every leaf id present in `leafTestIds` but not
 *     yet in the kept rows — these are the leaf tests that came from expanded
 *     containers.
 */
export interface ExpandedTestRow {
  test_id: string;
  test_name: string;
  // Allow callers to pass through extra fields without losing them
  [key: string]: any;
}

export function expandRegistrationTests(
  regTests: any[],
  leafTestIds: Set<string>,
  testsMap: Record<string, { test_name?: string } | any> = {},
): ExpandedTestRow[] {
  const safeRegTests = Array.isArray(regTests) ? regTests : [];
  // While tubes are still loading, callers may pass an empty leaf set. Returning
  // [] would wipe Results / Verification / Dispatch patient lists. Fall back to
  // the registration's billed rows until the authoritative leaf set arrives.
  if (!leafTestIds || leafTestIds.size === 0) {
    return safeRegTests
      .filter((t: any) => t && t.test_id)
      .map((t: any) => ({
        ...t,
        test_id: t.test_id,
        test_name: t.test_name || testsMap[t.test_id]?.test_name || "",
      }));
  }
  const direct = safeRegTests.filter((t: any) => t && leafTestIds.has(t.test_id));
  const directIds = new Set(direct.map((t: any) => t.test_id));
  const extras: ExpandedTestRow[] = [];
  leafTestIds.forEach((id) => {
    if (directIds.has(id)) return;
    extras.push({
      test_id: id,
      test_name: testsMap[id]?.test_name || "",
    });
  });
  return [...direct, ...extras];
}
