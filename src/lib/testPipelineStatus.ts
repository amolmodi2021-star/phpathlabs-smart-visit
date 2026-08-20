/**
 * Latest pipeline status per registered test (no audit timestamps).
 * Shared by hover overview + Dispatch list.
 */

export type PipelineTestStatus =
  | "registered"
  | "collect_later"
  | "repeat_collection"
  | "sample_collected"
  | "sample_accepted"
  | "outsourced"
  | "results_entered"
  | "verified"
  | "approved"
  | "dispatched"
  | "cancelled";

export type PipelineTestRow = {
  testId: string;
  testName: string;
  status: PipelineTestStatus;
};

export const PIPELINE_STATUS_LABEL: Record<PipelineTestStatus, string> = {
  registered: "Registered",
  collect_later: "Collect later",
  repeat_collection: "Repeat collection",
  sample_collected: "Collected",
  sample_accepted: "Accepted",
  outsourced: "Outsourced",
  results_entered: "Entered",
  verified: "Verified",
  approved: "Approved",
  dispatched: "Dispatched",
  cancelled: "Cancelled",
};

export const PIPELINE_STATUS_RANK: Record<PipelineTestStatus, number> = {
  cancelled: 100,
  dispatched: 90,
  approved: 80,
  verified: 70,
  results_entered: 60,
  outsourced: 55,
  sample_accepted: 50,
  sample_collected: 40,
  collect_later: 30,
  repeat_collection: 20,
  registered: 10,
};

function asIdArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x) : [];
}

/** Meaningful typed/result progress from patient_results (pending stubs ignored). */
export function bestResultStatus(statuses: string[]): PipelineTestStatus | null {
  const set = new Set(statuses.map((s) => String(s || "")));
  if (set.has("dispatched")) return "dispatched";
  if (set.has("approved")) return "approved";
  if (set.has("verified")) return "verified";
  if (set.has("entered") || set.has("results_entered")) return "results_entered";
  return null;
}

export type SnipProgressInput = {
  outsource_status?: string | null;
  result_mode?: string | null;
  snip_image_urls?: unknown;
  composed_pdf_url?: string | null;
};

/**
 * Snip/outsource progress.
 * - sent / pending → not "Entered" (waiting on lab)
 * - results_entered / results_saved → Entered only when composed PDF / snip image exists OR not snip-mode
 */
export function snipProgressStatus(snip: SnipProgressInput | null | undefined): PipelineTestStatus | null {
  if (!snip) return null;
  const v = String(snip.outsource_status || "");
  if (v === "dispatched") return "dispatched";
  if (v === "approved") return "approved";
  if (v === "verified") return "verified";

  const urls = Array.isArray(snip.snip_image_urls) ? snip.snip_image_urls.filter(Boolean) : [];
  const hasComposedPdf = typeof snip.composed_pdf_url === "string" && snip.composed_pdf_url.length > 0;
  const mode = String(snip.result_mode || "").toLowerCase();
  const isVisualMode = mode === "snip" || mode === "image" || mode === "pdf" || urls.length > 0 || hasComposedPdf;
  const hasVisualArtifact = urls.length > 0 || hasComposedPdf;

  if (v === "results_entered" || v === "results_saved") {
    // Visual-mode without an artifact is still waiting — do not show Entered.
    if (isVisualMode && !hasVisualArtifact) return "outsourced";
    return "results_entered";
  }

  // Transferred / awaiting lab — not entered yet
  if (v === "sent" || v === "pending" || v === "") return "outsourced";
  return null;
}

function tubeStatus(tube: { status?: string | null } | null | undefined): PipelineTestStatus | null {
  if (!tube) return null;
  const st = String(tube.status || "");
  if (st === "accepted") return "sample_accepted";
  if (st === "collected") return "sample_collected";
  if (st === "deferred") return "collect_later";
  return null;
}

export function pickFurthestStatus(...statuses: Array<PipelineTestStatus | null | undefined>): PipelineTestStatus {
  let best: PipelineTestStatus = "registered";
  for (const s of statuses) {
    if (!s) continue;
    if (PIPELINE_STATUS_RANK[s] > PIPELINE_STATUS_RANK[best]) best = s;
  }
  return best;
}

export type DeriveTestStatusInput = {
  isCancelled?: boolean;
  isOutsourcedMaster?: boolean;
  isRepeat?: boolean;
  /** True when test has no report parameters configured (outsourced incomplete setup). */
  hasNoParameters?: boolean;
  tube?: { status?: string | null } | null;
  resultStatuses?: string[];
  snip?: SnipProgressInput | null;
};

/**
 * Single source of truth for latest test stage (hover + Dispatch).
 */
export function deriveTestPipelineStatus(input: DeriveTestStatusInput): PipelineTestStatus {
  if (input.isCancelled) return "cancelled";

  const fromResults = bestResultStatus(input.resultStatuses || []);
  const fromSnip = snipProgressStatus(input.snip);
  const fromTube = tubeStatus(input.tube);

  let status = pickFurthestStatus(fromResults, fromSnip, fromTube, "registered");

  const snipWaiting =
    (!!input.snip && ["pending", "sent", ""].includes(String(input.snip.outsource_status || ""))) ||
    fromSnip === "outsourced";

  const isOutsourcedWork =
    !!input.isOutsourcedMaster || !!input.snip || (!!input.hasNoParameters && !!input.isOutsourcedMaster);

  // Outsourced and no real results/snip payload yet → Outsourced (not Entered).
  const hasRealResults =
    !!fromResults ||
    (fromSnip != null && PIPELINE_STATUS_RANK[fromSnip] >= PIPELINE_STATUS_RANK.results_entered);

  if ((isOutsourcedWork || snipWaiting) && !hasRealResults) {
    // Still show Collect later / Repeat when those apply and nothing further.
    if (fromTube === "collect_later") {
      status = "collect_later";
    } else if (
      input.isRepeat &&
      PIPELINE_STATUS_RANK[status] < PIPELINE_STATUS_RANK.sample_collected
    ) {
      status = "repeat_collection";
    } else {
      status = pickFurthestStatus(status, "outsourced");
    }
  }

  // Active repeat, not yet re-entered
  if (
    input.isRepeat &&
    !fromResults &&
    !(fromSnip && PIPELINE_STATUS_RANK[fromSnip] >= PIPELINE_STATUS_RANK.results_entered) &&
    PIPELINE_STATUS_RANK[status] < PIPELINE_STATUS_RANK.sample_collected
  ) {
    status = fromTube === "collect_later" ? "collect_later" : "repeat_collection";
  }

  return status;
}

export type PipelineOverviewInput = {
  registration: {
    tests?: any[] | null;
    cancelled_tests?: any[] | null;
    repeat_tests?: any[] | null;
    bill_cancelled?: boolean | null;
  };
  tubes: Array<{ test_ids?: string[] | null; status?: string | null }>;
  resultRows: Array<{ test_id: string; status?: string | null }>;
  snips: Array<{
    test_id: string;
    outsource_status?: string | null;
    result_mode?: string | null;
    snip_image_urls?: unknown;
    composed_pdf_url?: string | null;
  }>;
  testsMap: Record<string, { test_name?: string | null; is_outsourced?: boolean | null }>;
  leafTests: Array<{ test_id: string; test_name?: string }>;
  /** Optional: test_id → whether it has configured non-subheader parameters */
  hasParamsByTestId?: Record<string, boolean>;
};

export function buildPipelineOverview(input: PipelineOverviewInput): PipelineTestRow[] {
  const billCancelled = !!input.registration.bill_cancelled;
  const cancelledIds = new Set(
    (Array.isArray(input.registration.cancelled_tests) ? input.registration.cancelled_tests : [])
      .map((t: any) => (typeof t === "string" ? t : t?.test_id || t?.id))
      .filter(Boolean),
  );
  const repeatIds = new Set(
    (Array.isArray(input.registration.repeat_tests) ? input.registration.repeat_tests : [])
      .map((t: any) => (typeof t === "string" ? t : t?.test_id))
      .filter(Boolean),
  );

  const resultsByTest = new Map<string, string[]>();
  for (const r of input.resultRows) {
    if (!r?.test_id) continue;
    const list = resultsByTest.get(r.test_id) || [];
    list.push(String(r.status || ""));
    resultsByTest.set(r.test_id, list);
  }
  const snipByTest = new Map<string, PipelineOverviewInput["snips"][number]>();
  for (const s of input.snips) {
    if (!s?.test_id) continue;
    snipByTest.set(s.test_id, s);
  }

  const rows: PipelineTestRow[] = [];
  for (const t of input.leafTests) {
    const testId = t.test_id;
    const testName = t.test_name || input.testsMap[testId]?.test_name || "Unknown";
    const tube = input.tubes.find((tb) => asIdArray(tb.test_ids).includes(testId)) || null;
    const snip = snipByTest.get(testId) || null;
    const isOutsourcedMaster = !!input.testsMap[testId]?.is_outsourced;
    const hasParams = input.hasParamsByTestId ? !!input.hasParamsByTestId[testId] : true;

    const status = deriveTestPipelineStatus({
      isCancelled: billCancelled || cancelledIds.has(testId),
      isOutsourcedMaster,
      isRepeat: repeatIds.has(testId),
      hasNoParameters: isOutsourcedMaster && !hasParams,
      tube,
      resultStatuses: resultsByTest.get(testId) || [],
      snip,
    });

    rows.push({ testId, testName, status });
  }

  rows.sort((a, b) => {
    if (PIPELINE_STATUS_RANK[b.status] !== PIPELINE_STATUS_RANK[a.status]) {
      return PIPELINE_STATUS_RANK[b.status] - PIPELINE_STATUS_RANK[a.status];
    }
    return a.testName.localeCompare(b.testName);
  });
  return rows;
}

export function summarizePipeline(rows: PipelineTestRow[]): Record<PipelineTestStatus, number> {
  const counts = {} as Record<PipelineTestStatus, number>;
  for (const k of Object.keys(PIPELINE_STATUS_LABEL) as PipelineTestStatus[]) counts[k] = 0;
  for (const r of rows) counts[r.status] += 1;
  return counts;
}