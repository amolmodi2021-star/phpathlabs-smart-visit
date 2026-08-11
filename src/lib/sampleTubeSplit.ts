import { supabase } from "@/integrations/supabase/client";

export type SampleTubeLike = {
  id: string;
  registration_id: string;
  sample_uid?: string | null;
  tube_type?: string | null;
  tube_color?: string | null;
  sample_type?: string | null;
  suffix?: string | null;
  test_ids?: string[] | null;
  test_names?: string[] | null;
  status?: string | null;
};

function asIdArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x) : [];
}
function asNameArray(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => (x == null ? "" : String(x))) : [];
}

/**
 * Allocate a unique "later visit" suffix for a split tube.
 * Pattern: base + "L", then "L2", "L3"... (distinct from repeat "R" suffixes).
 * Never returns empty string â€” split barcodes must stay unique per registration.
 */
export function nextLaterSuffix(existing: string[], base: string | null | undefined): string {
  const used = new Set(existing.map((s) => String(s || "").trim()));
  const root = `${(base || "").trim()}L`;
  if (!used.has(root)) return root;
  let i = 2;
  while (used.has(`${root}${i}`)) i += 1;
  return `${root}${i}`;
}

export type SplitTubeResult = {
  collectTube: SampleTubeLike;
  deferredTube: SampleTubeLike | null;
  /** True when a new deferred tube row was inserted */
  split: boolean;
};

/**
 * Split one pending/deferred tube into:
 *  - original row: only collect-now tests (suffix unchanged â€” stable if already printed)
 *  - new deferred row: later tests + unique L/L2 suffix (same physical tube type)
 *
 * If all tests are collect-now â†’ no-op (returns tube as-is).
 * If none are collect-now â†’ marks whole tube deferred (no new row).
 */
export async function splitSampleTubeForPartialCollection(args: {
  tube: SampleTubeLike;
  collectNowTestIds: string[];
  existingSuffixes?: string[];
}): Promise<SplitTubeResult> {
  const tube = args.tube;
  const allIds = asIdArray(tube.test_ids);
  const allNames = asNameArray(tube.test_names);
  const nowSet = new Set(args.collectNowTestIds.filter((id) => allIds.includes(id)));
  const nowIds = allIds.filter((id) => nowSet.has(id));
  const laterIds = allIds.filter((id) => !nowSet.has(id));
  const nowNames = nowIds.map((id) => allNames[allIds.indexOf(id)] || "");
  const laterNames = laterIds.map((id) => allNames[allIds.indexOf(id)] || "");

  if (laterIds.length === 0) {
    return { collectTube: tube, deferredTube: null, split: false };
  }

  // All tests deferred â€” flip whole tube, keep barcode
  if (nowIds.length === 0) {
    if (tube.status === "deferred") {
      return { collectTube: tube, deferredTube: tube, split: false };
    }
    const { data, error } = await supabase
      .from("sample_tubes" as any)
      .update({ status: "deferred", collected_at: null, collected_by: null })
      .eq("id", tube.id)
      .in("status", ["pending", "deferred"])
      .select("*")
      .maybeSingle();
    if (error) throw error;
    const deferred = (data as any) || { ...tube, status: "deferred" };
    return { collectTube: deferred, deferredTube: deferred, split: false };
  }

  // Partial split: shrink original, insert deferred clone with new suffix
  let suffixes = args.existingSuffixes;
  if (!suffixes) {
    const { data: sibs, error: sibErr } = await supabase
      .from("sample_tubes" as any)
      .select("suffix")
      .eq("registration_id", tube.registration_id);
    if (sibErr) throw sibErr;
    suffixes = (sibs || []).map((r: any) => String(r.suffix || "").trim());
  }
  const newSuffix = nextLaterSuffix(suffixes, tube.suffix);

  const { error: updErr } = await supabase
    .from("sample_tubes" as any)
    .update({
      test_ids: nowIds,
      test_names: nowNames,
    })
    .eq("id", tube.id)
    .in("status", ["pending", "deferred"]);
  if (updErr) throw updErr;

  const { data: uidRes, error: uidErr } = await supabase.rpc("generate_sample_uid");
  if (uidErr) throw uidErr;

  const insertRow = {
    sample_uid: uidRes,
    registration_id: tube.registration_id,
    tube_type: tube.tube_type,
    tube_color: tube.tube_color,
    sample_type: tube.sample_type,
    suffix: newSuffix,
    test_ids: laterIds,
    test_names: laterNames,
    status: "deferred",
    collected_at: null,
    collected_by: null,
  };

  const { data: inserted, error: insErr } = await supabase
    .from("sample_tubes" as any)
    .insert(insertRow)
    .select("*")
    .maybeSingle();
  if (insErr) throw insErr;

  const collectTube: SampleTubeLike = {
    ...tube,
    test_ids: nowIds,
    test_names: nowNames,
  };
  const deferredTube = (inserted as any) || { ...insertRow, id: "unknown" };

  return { collectTube, deferredTube, split: true };
}

/**
 * Apply collect-now vs later test selection across many tubes for one registration.
 * Returns tube rows that should be printed & collected on this visit.
 */
/**
 * Apply collect-now vs later test selection across many tubes for one registration.
 * Returns tube rows that should be printed & collected on this visit.
 */
export async function prepareTubesForCollectionVisit(args: {
  registrationId: string;
  tubes: SampleTubeLike[];
  /** tubeId → test ids to collect now; missing key = all tests on that tube */
  collectNowByTubeId: Record<string, string[]>;
  /** tube ids included in this visit action */
  selectedTubeIds: string[];
}): Promise<{ toCollect: SampleTubeLike[]; deferredCreated: number; fullyDeferred: number }> {
  const { data: sibs, error: sibErr } = await supabase
    .from("sample_tubes" as any)
    .select("suffix")
    .eq("registration_id", args.registrationId);
  if (sibErr) throw sibErr;
  const existingSuffixes = (sibs || []).map((r: any) => String(r.suffix || "").trim());

  const toCollect: SampleTubeLike[] = [];
  let deferredCreated = 0;
  let fullyDeferred = 0;

  for (const tube of args.tubes) {
    if (!args.selectedTubeIds.includes(tube.id)) continue;
    if (tube.status !== "pending" && tube.status !== "deferred") continue;

    const allIds = asIdArray(tube.test_ids);
    const nowIds = args.collectNowByTubeId[tube.id] ?? allIds;
    const result = await splitSampleTubeForPartialCollection({
      tube,
      collectNowTestIds: nowIds,
      existingSuffixes,
    });

    if (result.split && result.deferredTube?.suffix != null) {
      existingSuffixes.push(String(result.deferredTube.suffix).trim());
      deferredCreated += 1;
    }

    const remainingNow = asIdArray(result.collectTube.test_ids);
    if (remainingNow.length === 0 || (nowIds.length === 0)) {
      fullyDeferred += 1;
      continue;
    }

    // Collectable remnant (pending or deferred — collectMutation accepts both)
    toCollect.push(result.collectTube);
  }

  return { toCollect, deferredCreated, fullyDeferred };
}