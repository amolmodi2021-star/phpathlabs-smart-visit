/**
 * Latest pipeline status per registered test (no audit timestamps).
 * Same precedence as Dispatch, plus deferred / repeat.
 */

export type PipelineTestStatus =
  | "registered"
  | "collect_later"
  | "repeat_collection"
  | "sample_collected"
  | "sample_accepted"
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
  results_entered: "Entered",
  verified: "Verified",
  approved: "Approved",
  dispatched: "Dispatched",
  cancelled: "Cancelled",
};

const RANK: Record<PipelineTestStatus, number> = {
  cancelled: 100,
  dispatched: 90,
  approved: 80,
  verified: 70,
  results_entered: 60,
  sample_accepted: 50,
  sample_collected: 40,
  collect_later: 30,
  repeat_collection: 20,
  registered: 10,
};

function asIdArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x) : [];
}

function bestResultStatus(statuses: string[]): PipelineTestStatus | null {
  const set = new Set(statuses.map((s) => String(s || "")));
  if (set.has("dispatched")) return "dispatched";
  if (set.has("approved")) return "approved";
  if (set.has("verified")) return "verified";
  if (set.has("entered") || set.has("results_entered")) return "results_entered";
  return null;
}

function snipStatus(s: string | null | undefined): PipelineTestStatus | null {
  const v = String(s || "");
  if (v === "dispatched") return "dispatched";
  if (v === "approved") return "approved";
  if (v === "verified") return "verified";
  if (v === "results_entered" || v === "results_saved" || v === "sent") return "results_entered";
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

/** Prefer the furthest-along status. */
export function pickFurthestStatus(...statuses: Array<PipelineTestStatus | null | undefined>): PipelineTestStatus {
  let best: PipelineTestStatus = "registered";
  for (const s of statuses) {
    if (!s) continue;
    if (RANK[s] > RANK[best]) best = s;
  }
  return best;
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
  snips: Array<{ test_id: string; outsource_status?: string | null }>;
  testsMap: Record<string, { test_name?: string | null }>;
  /** Expanded leaf tests (profiles already flattened). */
  leafTests: Array<{ test_id: string; test_name?: string }>;
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
  const snipByTest = new Map<string, string>();
  for (const s of input.snips) {
    if (!s?.test_id) continue;
    snipByTest.set(s.test_id, String(s.outsource_status || ""));
  }

  const rows: PipelineTestRow[] = [];
  for (const t of input.leafTests) {
    const testId = t.test_id;
    const testName =
      t.test_name ||
      input.testsMap[testId]?.test_name ||
      "Unknown";

    if (billCancelled || cancelledIds.has(testId)) {
      rows.push({ testId, testName, status: "cancelled" });
      continue;
    }

    const tube = input.tubes.find((tb) => asIdArray(tb.test_ids).includes(testId)) || null;
    const fromResults = bestResultStatus(resultsByTest.get(testId) || []);
    const fromSnip = snipStatus(snipByTest.get(testId));
    const fromTube = tubeStatus(tube);

    let status = pickFurthestStatus(fromResults, fromSnip, fromTube, "registered");

    // Active repeat, not yet re-entered: label as Repeat (unless Collect later).
    if (
      repeatIds.has(testId) &&
      !fromResults &&
      !fromSnip &&
      RANK[status] < RANK.sample_collected
    ) {
      status = fromTube === "collect_later" ? "collect_later" : "repeat_collection";
    }

    rows.push({ testId, testName, status });
  }

  rows.sort((a, b) => {
    if (RANK[b.status] !== RANK[a.status]) return RANK[b.status] - RANK[a.status];
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