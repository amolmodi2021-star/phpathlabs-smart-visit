import { useRealtimeSync } from "@/hooks/useRealtimeSync";
import { MODULE_KEYS, type LimsModule } from "@/lib/limsPropagation";

type RealtimeTable =
  | "patient_registrations"
  | "sample_tubes"
  | "patient_results"
  | "outsourced_test_snips"
  | "approved_reports"
  | "lims_result_notify"
  | "whatsapp_console_outbox";

/**
 * Tables that drive each LIMS queue. Changes (including other users' actions
 * and bill cancellation) invalidate that module's React Query keys.
 *
 * keepPreviousData + tubesReady/listLoading guards in the screens prevent the
 * empty-flash that previously happened when tube lists refetch mid-render.
 */
const MODULE_TABLES: Record<LimsModule, RealtimeTable[]> = {
  sample_collection: ["sample_tubes", "patient_registrations"],
  sample_acceptance: ["sample_tubes", "patient_registrations"],
  results: [
    "sample_tubes",
    "patient_results",
    "patient_registrations",
    "outsourced_test_snips",
    "lims_result_notify",
  ],
  verification: [
    "sample_tubes",
    "patient_results",
    "patient_registrations",
    "outsourced_test_snips",
    "lims_result_notify",
  ],
  doctor_approval: [
    "sample_tubes",
    "patient_results",
    "patient_registrations",
    "outsourced_test_snips",
  ],
  dispatch: [
    "sample_tubes",
    "patient_results",
    "patient_registrations",
    "outsourced_test_snips",
    "approved_reports",
    "whatsapp_console_outbox",
  ],
  modified_approval: ["approved_reports", "patient_results", "outsourced_test_snips"],
  registered_patients: ["patient_registrations", "sample_tubes"],
  completed_hv: ["patient_registrations"],
  billing: ["patient_registrations"],
  due: ["patient_registrations"],
  bad_debt: ["patient_registrations"],
};

/** Live sync for one LIMS workflow module (active tab only — Tabs unmount others). */
export function useLimsPipelineRealtime(module: LimsModule, debounceMs = 1200) {
  useRealtimeSync(MODULE_TABLES[module], MODULE_KEYS[module], debounceMs);
}
