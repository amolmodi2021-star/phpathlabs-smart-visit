import { supabase } from "@/integrations/supabase/client";
import { getCurrentUserName } from "@/lib/auth";
import { recalculateRegistrationStatus } from "@/lib/limsStatus";

export type RepeatTestEntry = {
  test_id: string;
  test_name: string;
  requested_at: string;
  requested_by?: string | null;
};

function asIdArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x) : [];
}
function asNameArray(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => (x == null ? "" : String(x))) : [];
}

function tubePhysicalKey(tube: {
  tube_type?: string | null;
  tube_color?: string | null;
  sample_type?: string | null;
}): string {
  return [
    String(tube.tube_type || "").trim().toUpperCase(),
    String(tube.tube_color || "").trim().toUpperCase(),
    String(tube.sample_type || "").trim().toUpperCase(),
  ].join("||");
}

function nextRepeatSuffix(existing: string[], base: string | null | undefined): string {
  const root = `${(base || "").trim()}R`;
  if (!existing.includes(root)) return root;
  let i = 2;
  while (existing.includes(`${root}${i}`)) i += 1;
  return `${root}${i}`;
}

/**
 * Merge pending tubes that only carry active-repeat tests and share the same
 * physical tube (type/color/sample). Example: CBC then ESR both sent for repeat
 * from one EDTA tube → one pending EDTA tube with both tests, not two.
 */
async function consolidatePendingRepeatTubes(
  registrationId: string,
  activeRepeatIds: Set<string>,
): Promise<void> {
  if (activeRepeatIds.size === 0) return;

  const { data: tubes, error } = await supabase
    .from("sample_tubes" as any)
    .select("id, tube_type, tube_color, sample_type, suffix, test_ids, test_names, status, created_at")
    .eq("registration_id", registrationId)
    .eq("status", "pending");
  if (error) throw error;

  const candidates = ((tubes || []) as any[]).filter((t) => {
    const ids = asIdArray(t.test_ids);
    return ids.length > 0 && ids.every((id) => activeRepeatIds.has(id));
  });
  if (candidates.length < 2) return;

  const groups = new Map<string, any[]>();
  for (const t of candidates) {
    const key = tubePhysicalKey(t);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(t);
  }

  for (const group of groups.values()) {
    if (group.length < 2) continue;
    // Prefer the oldest tube / shortest suffix as the survivor
    group.sort((a, b) => {
      const sa = String(a.suffix || "").length - String(b.suffix || "").length;
      if (sa !== 0) return sa;
      return String(a.created_at || "").localeCompare(String(b.created_at || ""));
    });
    const keep = group[0];
    const drop = group.slice(1);
    const mergedIds: string[] = [];
    const mergedNames: string[] = [];
    for (const t of group) {
      const ids = asIdArray(t.test_ids);
      const names = asNameArray(t.test_names);
      ids.forEach((id, i) => {
        if (!mergedIds.includes(id)) {
          mergedIds.push(id);
          mergedNames.push(names[i] || "");
        }
      });
    }

    const { error: updErr } = await supabase
      .from("sample_tubes" as any)
      .update({
        test_ids: mergedIds,
        test_names: mergedNames,
        status: "pending",
        collected_at: null,
        collected_by: null,
        accepted_at: null,
        accepted_by: null,
      } as any)
      .eq("id", keep.id);
    if (updErr) throw updErr;

    const dropIds = drop.map((t) => t.id);
    if (dropIds.length) {
      const { error: delErr } = await supabase.from("sample_tubes" as any).delete().in("id", dropIds);
      if (delErr) throw delErr;
    }
  }
}

/**
 * Mark only the given test(s) for repeat collection.
 * - Results/snips for those tests are deleted.
 * - Tubes that contain ONLY those tests are reset to pending.
 * - Shared tubes keep sibling tests accepted; repeat tests go to a pending tube.
 * - Multiple repeat tests that share the same physical tube are merged into ONE pending tube.
 * - Registration.repeat_tests lists only the affected tests; status becomes repeat_collection.
 */
export async function applyRepeatCollectionForTests(
  registrationId: string,
  tests: Array<{ test_id: string; test_name: string }>,
  opts?: { remarks?: string | null },
): Promise<void> {
  const unique = new Map<string, string>();
  for (const t of tests) {
    if (t?.test_id) unique.set(t.test_id, t.test_name || "");
  }
  if (unique.size === 0) return;
  const repeatIds = new Set(unique.keys());
  const requestedBy = getCurrentUserName();
  const now = new Date().toISOString();

  const { data: regEarly, error: regEarlyErr } = await supabase
    .from("patient_registrations")
    .select("repeat_tests, remarks")
    .eq("id", registrationId)
    .maybeSingle();
  if (regEarlyErr) throw regEarlyErr;

  const priorRepeatIds = new Set(
    (Array.isArray((regEarly as any)?.repeat_tests) ? (regEarly as any).repeat_tests : [])
      .map((x: any) => x?.test_id)
      .filter(Boolean),
  );
  const mergeableRepeatIds = new Set<string>([...priorRepeatIds, ...repeatIds]);

  for (const testId of repeatIds) {
    const { error: delResErr } = await supabase
      .from("patient_results")
      .delete()
      .eq("registration_id", registrationId)
      .eq("test_id", testId);
    if (delResErr) throw delResErr;
    const { error: delSnipErr } = await supabase
      .from("outsourced_test_snips")
      .delete()
      .eq("registration_id", registrationId)
      .eq("test_id", testId);
    if (delSnipErr) throw delSnipErr;
  }

  const { data: tubes, error: tubesErr } = await supabase
    .from("sample_tubes" as any)
    .select("id, sample_uid, tube_type, tube_color, sample_type, suffix, test_ids, test_names, status")
    .eq("registration_id", registrationId);
  if (tubesErr) throw tubesErr;

  const tubeRows = (tubes || []) as any[];
  const existingSuffixes = tubeRows.map((t) => String(t.suffix || "").trim());

  // Pending tubes that already hold only-repeat work, keyed by physical tube
  const pendingRepeatByKey = new Map<string, any>();
  for (const t of tubeRows) {
    if (t.status !== "pending") continue;
    const ids = asIdArray(t.test_ids);
    if (!ids.length || !ids.every((id) => mergeableRepeatIds.has(id))) continue;
    pendingRepeatByKey.set(tubePhysicalKey(t), t);
  }

  for (const tube of tubeRows) {
    const ids = asIdArray(tube.test_ids);
    const names = asNameArray(tube.test_names);
    const hitIds = ids.filter((id) => repeatIds.has(id));
    if (hitIds.length === 0) continue;

    const remainIds = ids.filter((id) => !repeatIds.has(id));
    const remainNames = ids
      .map((id, i) => ({ id, name: names[i] || "" }))
      .filter((x) => !repeatIds.has(x.id))
      .map((x) => x.name);
    const hitNames = hitIds.map((id) => unique.get(id) || names[ids.indexOf(id)] || "");
    const key = tubePhysicalKey(tube);

    if (remainIds.length === 0) {
      // Whole tube is only for repeat test(s) — reset in place (may merge later)
      const { error } = await supabase
        .from("sample_tubes" as any)
        .update({
          status: "pending",
          collected_at: null,
          collected_by: null,
          accepted_at: null,
          accepted_by: null,
        } as any)
        .eq("id", tube.id);
      if (error) throw error;
      pendingRepeatByKey.set(key, { ...tube, status: "pending", test_ids: ids, test_names: names });
      continue;
    }

    // Shared tube: keep siblings on the original tube
    const { error: keepErr } = await supabase
      .from("sample_tubes" as any)
      .update({ test_ids: remainIds, test_names: remainNames } as any)
      .eq("id", tube.id);
    if (keepErr) throw keepErr;

    // Prefer merging into an existing pending tube of the same physical type
    const existingPending = pendingRepeatByKey.get(key);
    if (existingPending && existingPending.id !== tube.id) {
      const exIds = asIdArray(existingPending.test_ids);
      const exNames = asNameArray(existingPending.test_names);
      const mergedIds = [...exIds];
      const mergedNames = [...exNames];
      hitIds.forEach((id, i) => {
        if (!mergedIds.includes(id)) {
          mergedIds.push(id);
          mergedNames.push(hitNames[i] || "");
        }
      });
      const { error: mergeErr } = await supabase
        .from("sample_tubes" as any)
        .update({
          test_ids: mergedIds,
          test_names: mergedNames,
          status: "pending",
          collected_at: null,
          collected_by: null,
          accepted_at: null,
          accepted_by: null,
        } as any)
        .eq("id", existingPending.id);
      if (mergeErr) throw mergeErr;
      pendingRepeatByKey.set(key, { ...existingPending, test_ids: mergedIds, test_names: mergedNames });
      continue;
    }

    const { data: uidRes, error: uidErr } = await supabase.rpc("generate_sample_uid");
    if (uidErr) throw uidErr;
    const suffix = nextRepeatSuffix(existingSuffixes, tube.suffix);
    existingSuffixes.push(suffix);

    const { data: inserted, error: insErr } = await supabase
      .from("sample_tubes" as any)
      .insert({
        sample_uid: uidRes,
        registration_id: registrationId,
        tube_type: tube.tube_type,
        tube_color: tube.tube_color,
        sample_type: tube.sample_type,
        suffix,
        test_ids: hitIds,
        test_names: hitNames,
        status: "pending",
      } as any)
      .select("id, tube_type, tube_color, sample_type, suffix, test_ids, test_names, status")
      .single();
    if (insErr) throw insErr;
    pendingRepeatByKey.set(key, inserted);
  }

  const reg = regEarly;
  const existing = Array.isArray((reg as any)?.repeat_tests) ? ([...(reg as any).repeat_tests] as RepeatTestEntry[]) : [];
  for (const [test_id, test_name] of unique) {
    const idx = existing.findIndex((x) => x?.test_id === test_id);
    const entry: RepeatTestEntry = {
      test_id,
      test_name,
      requested_at: now,
      requested_by: requestedBy,
    };
    if (idx >= 0) existing[idx] = entry;
    else existing.push(entry);
  }

  const activeRepeatIds = new Set(existing.map((x) => x.test_id).filter(Boolean));
  await consolidatePendingRepeatTubes(registrationId, activeRepeatIds);

  const patch: Record<string, any> = {
    status: "repeat_collection",
    repeat_tests: existing,
  };
  if (opts?.remarks) {
    const prev = String((reg as any)?.remarks || "").trim();
    patch.remarks = prev ? `${prev}\n${opts.remarks}` : opts.remarks;
  }

  const { error: regErr } = await supabase
    .from("patient_registrations")
    .update(patch as any)
    .eq("id", registrationId);
  if (regErr) throw regErr;

  await recalculateRegistrationStatus(registrationId);
}
