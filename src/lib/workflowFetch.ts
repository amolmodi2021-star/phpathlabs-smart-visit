/**
 * Data loading for Bench Workflow tab + LIMS badge count.
 */
import { fetchAllByIds } from "@/lib/fetchAllRows";
import { PATIENT_RESULTS_SELECT_RESULTS } from "@/lib/patientResultsSelect";
import {
  fetchResultsEntryCandidateIds,
  fetchFilteredSortedIds,
} from "@/lib/limsPendingCandidates";
import {
  buildWorkflowWorksheet,
  addDaysToDayString,
  localDayString,
  type WorkflowWorksheet,
} from "@/lib/workflowWorksheet";

export const WORKFLOW_REG_SELECT =
  "id, invoice_number, patient_name, title, gender, dob, age_text, status, bill_cancelled, cancelled_tests, repeat_tests, created_at";

export const WORKFLOW_TUBE_SELECT =
  "id, registration_id, status, accepted_at, suffix, sample_type, test_ids";

export const WORKFLOW_TEST_SELECT =
  "id, test_name, instrument_name, sample_type, is_outsourced, outsourced_caption";

export const WORKFLOW_PARAM_SELECT =
  "test_id, parameter_id, display_order, is_subheader, subheader_text, report_test_parameters(id, param_code, parameter_name, unit, is_calculated, calculation_formula, send_for_interface)";

export const WORKFLOW_SNIP_SELECT =
  "registration_id, test_id, outsourced_parameter_ids, outsource_status, outsourced_lab_name, sent_at, result_mode, snip_image_urls";

export const WORKFLOW_CANDIDATE_CAP = 400;

export type WorkflowBundle = {
  registrations: any[];
  tubes: any[];
  patientResults: any[];
  testsMap: Record<string, any>;
  testParamsMap: Record<string, any[]>;
  snips: any[];
};

export async function fetchWorkflowBundle(regIds: string[]): Promise<WorkflowBundle> {
  if (!regIds.length) {
    return {
      registrations: [],
      tubes: [],
      patientResults: [],
      testsMap: {},
      testParamsMap: {},
      snips: [],
    };
  }

  const [registrations, tubes, patientResults, snips] = await Promise.all([
    fetchAllByIds<any>("patient_registrations", WORKFLOW_REG_SELECT, "id", regIds),
    fetchAllByIds<any>("sample_tubes", WORKFLOW_TUBE_SELECT, "registration_id", regIds, {
      eq: { status: "accepted" },
    }),
    fetchAllByIds<any>(
      "patient_results",
      PATIENT_RESULTS_SELECT_RESULTS,
      "registration_id",
      regIds,
    ),
    fetchAllByIds<any>("outsourced_test_snips", WORKFLOW_SNIP_SELECT, "registration_id", regIds),
  ]);

  const testIdSet = new Set<string>();
  for (const tube of tubes) {
    for (const id of Array.isArray(tube.test_ids) ? tube.test_ids : []) {
      if (id) testIdSet.add(String(id));
    }
  }
  for (const s of snips) {
    if (s.test_id) testIdSet.add(String(s.test_id));
  }
  const testIds = [...testIdSet];

  const testsRows =
    testIds.length > 0
      ? await fetchAllByIds<any>("tests", WORKFLOW_TEST_SELECT, "id", testIds)
      : [];
  const testsMap: Record<string, any> = {};
  for (const t of testsRows) testsMap[t.id] = t;

  const testParamsMap: Record<string, any[]> = {};
  if (testIds.length > 0) {
    const tpRows = await fetchAllByIds<any>(
      "test_parameters",
      WORKFLOW_PARAM_SELECT,
      "test_id",
      testIds,
    );
    for (const tp of tpRows) {
      if (!testParamsMap[tp.test_id]) testParamsMap[tp.test_id] = [];
      testParamsMap[tp.test_id].push(tp);
    }
    for (const id of Object.keys(testParamsMap)) {
      testParamsMap[id].sort(
        (a, b) => (a.display_order ?? 9999) - (b.display_order ?? 9999),
      );
    }
  }

  return { registrations, tubes, patientResults, testsMap, testParamsMap, snips };
}

export type WorkflowPendingCountOpts = {
  acceptedFromDay?: string | null;
  acceptedToDay?: string | null;
  search?: string;
  includeRepeat?: boolean;
};

/** Lightweight pending-param count for the LIMS Workflow tab badge. */
export async function fetchWorkflowPendingCount(
  opts: WorkflowPendingCountOpts = {},
): Promise<number> {
  const from = opts.acceptedFromDay ?? addDaysToDayString(localDayString(), -1);
  const to = opts.acceptedToDay ?? localDayString();
  const candidates = await fetchResultsEntryCandidateIds();
  let ids = await fetchFilteredSortedIds(candidates, opts.search || "");
  if (ids.length > WORKFLOW_CANDIDATE_CAP) {
    ids = ids.slice(0, WORKFLOW_CANDIDATE_CAP);
  }
  const bundle = await fetchWorkflowBundle(ids);
  const sheet = buildWorkflowWorksheet({
    ...bundle,
    acceptedFromDay: from,
    acceptedToDay: to,
    includeRepeat: opts.includeRepeat ?? false,
  });
  return sheet.totalPendingParams;
}

export async function fetchWorkflowWorksheetForIds(
  regIds: string[],
  opts: {
    acceptedFromDay?: string | null;
    acceptedToDay?: string | null;
    includeRepeat?: boolean;
  } = {},
): Promise<{
  sheet: WorkflowWorksheet;
  bundle: WorkflowBundle;
  capped: boolean;
  totalCandidates: number;
}> {
  const totalCandidates = regIds.length;
  const capped = regIds.length > WORKFLOW_CANDIDATE_CAP;
  const ids = capped ? regIds.slice(0, WORKFLOW_CANDIDATE_CAP) : regIds;
  const bundle = await fetchWorkflowBundle(ids);
  const sheet = buildWorkflowWorksheet({
    ...bundle,
    acceptedFromDay: opts.acceptedFromDay,
    acceptedToDay: opts.acceptedToDay,
    includeRepeat: opts.includeRepeat ?? false,
  });
  return { sheet, bundle, capped, totalCandidates };
}
