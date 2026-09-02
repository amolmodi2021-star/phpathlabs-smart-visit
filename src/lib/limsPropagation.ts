/**
 * Centralised cross-module propagation for the LIMS workflow.
 *
 * Every workflow action (Save & Verify, Verify, Approve, Send Back, Dispatch,
 * Sample Accept, etc.) calls `propagateRegistrationChange` exactly once after
 * its DB writes. This guarantees:
 *
 *   1. Status is recalculated AND awaited before refetch (so destination tabs
 *      that filter on `patient_registrations.status` see the latest state).
 *   2. The CORRECT React Query keys are invalidated for every destination
 *      module — no more `["doctor_approval"]` typos that match nothing.
 *   3. The active tab gets a forced refetch, inactive tabs only invalidate
 *      (cheap under multi-user load).
 *   4. The SyncingOverlay receives a signal so users see a "Syncing…" banner
 *      until the row actually appears in the destination queue.
 */
import type { QueryClient } from "@tanstack/react-query";
import { recalculateRegistrationStatus } from "./limsStatus";
import { signalSync, type SyncTarget } from "./limsSyncSignal";
import { markPropagated, markInvalidated } from "./limsRealtimeDedupe";

export type LimsModule =
  | "results"
  | "cbc"
  | "dr_cbc"
  | "verification"
  | "doctor_approval"
  | "dispatch"
  | "sample_collection"
  | "sample_acceptance"
  | "completed_hv"
  | "billing"
  | "due"
  | "bad_debt"
  | "modified_approval"
  | "registered_patients";

/** Single source of truth: which React-Query keys belong to each module. */
export const MODULE_KEYS: Record<LimsModule, string[]> = {
  cbc: ["cbc_candidate_ids", "cbc_regs", "cbc_review", "cbc_results"],
  dr_cbc: ["cbc_dr_candidate_ids", "cbc_dr_regs", "cbc_dr_review", "cbc_dr_results"],
  results: [
    "results_accepted_regs",
    "results_accepted_count",
    "results_accepted_tubes",
    "results_reg_detail",
    "results_machine_filtered_ids",
    "results_tests_instrument_map",
    "patient_results_existing",
    "outsourced_manual_results",
    "results_outsourced_snips",
    "outsourced_snips",
    "outsourced_accepted_regs",
    "outsourced_pending_ids",
    "workflow_badge_count",
    "workflow_candidate_ids",
    "workflow_worksheet",
  ],
  verification: [
    "verification_regs_v2",
    "verification_regs_count",
    "verification_reg_detail",
    "verification_results_v2",
    "verification_outsourced_v2",
    "verification_tubes",
  ],
  doctor_approval: [
    "doctor_approval_regs",
    "doctor_approval_count",
    "doctor_approval_reg_detail",
    "doctor_approval_results",
    "doctor_approval_snips",
    "doctor_approval_tubes",
    "doctor_approval_history",
  ],
  dispatch: [
    "dispatch_filtered_ids",
    "dispatch_regs",
    "dispatch_regs_count",
    "dispatch_all_results",
    "dispatch_all_snips",
    "dispatch_all_tubes",
    "dispatch_held_reports",
    "dispatch_failed_wa_outbox",
  ],
  sample_collection: [
    "sample_collection_regs",
    "sample_tubes_collection",
    "sample_collection_page_tubes",
    "sample_collection_search",
  ],
  sample_acceptance: [
    "sample_acceptance_regs",
    "sample_tubes_acceptance",
    "sample_tubes_acceptance_pending",
    "sample_tubes_acceptance_accepted",
    "sample_acceptance_detail_tubes",
    "workflow_badge_count",
    "workflow_candidate_ids",
    "workflow_worksheet",
  ],
  completed_hv: ["completed_home_visits"],
  billing: ["billing_regs", "pickup_invoices", "eligible_regs"],
  due: ["due_payments_regs"],
  bad_debt: ["bad_debts_regs"],
  modified_approval: [
    "modified_approval_reports",
    "modified_approval_report_detail",
    "modified_approval_results",
    "modified_approval_snips",
  ],
  registered_patients: [
    "patient_registrations",
    "patient_registrations_count",
  ],
};

/** Modules that have a SyncingOverlay wired up. */
const SYNC_TARGETS: ReadonlySet<LimsModule> = new Set<LimsModule>([
  "results",
  "verification",
  "doctor_approval",
  "dispatch",
  "sample_collection",
  "sample_acceptance",
  "completed_hv",
]);

interface PropagateOpts {
  /** Skip status recalc when the caller has already updated status manually. */
  skipRecalc?: boolean;
  /** Extra (legacy / cross-cutting) query keys to invalidate. */
  extraKeys?: string[];
}

/**
 * Call after any workflow action that may move a registration between modules.
 * - `regId`     — the affected registration id (or array, for bulk actions).
 * - `destinations` — every module whose queue may be affected (source AND
 *   destination — both need a refetch so the row leaves the source list and
 *   appears in the destination list).
 */
export async function propagateRegistrationChange(
  qc: QueryClient,
  regId: string | string[],
  destinations: LimsModule[],
  opts: PropagateOpts = {},
): Promise<void> {
  const ids = Array.isArray(regId) ? regId : [regId];

  // 1. AWAIT status recalculation so the DB row is committed before any refetch.
  if (!opts.skipRecalc) {
    await Promise.all(ids.map((id) => recalculateRegistrationStatus(id).catch((e) => {
      // Don't block the UI on a failed recalc — log and continue with invalidation.
      // eslint-disable-next-line no-console
      console.error("[propagation] recalculateRegistrationStatus failed", id, e);
    })));
  }

  // 2. Build the union set of keys to invalidate.
  const keys = new Set<string>();
  destinations.forEach((m) => MODULE_KEYS[m]?.forEach((k) => keys.add(k)));
  (opts.extraKeys || []).forEach((k) => keys.add(k));

  // 2a. Mark these ids as just-propagated so the realtime echo for the actor's
  //     own write is suppressed (no duplicate refetch on this client).
  ids.forEach(markPropagated);

  // 3. Invalidate inactive caches (cheap), force-refetch active ones (visible tab).
  await Promise.all(
    Array.from(keys).map((k) => {
      markInvalidated(k); // dedupe window: realtime won't re-invalidate within 750 ms
      return qc.invalidateQueries({
        queryKey: [k],
        // Only the active observers refetch immediately; inactive queries are
        // flagged stale and refetch on next mount. Keeps multi-user fan-out cheap.
        refetchType: "active",
      });
    }),
  );

  // 4. Tell the SyncingOverlay in each destination tab that this regId is
  //    expected to appear. Overlay auto-dismisses when it observes the id in
  //    visibleIds (or after TTL).
  destinations.forEach((m) => {
    if (!SYNC_TARGETS.has(m)) return;
    signalSync(m as SyncTarget, ids, 15000);
  });
}
