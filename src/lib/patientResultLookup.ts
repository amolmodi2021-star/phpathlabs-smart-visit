/**
 * Resolve a patient_results row for a specific (registration, test, parameter).
 *
 * MUST be scoped by test_id: the same report parameter (e.g. Albumin / PRM0008)
 * can appear under both a profile (LFT) and a standalone test (S.ALBUMIN). Looking
 * up by parameter_id alone can return an older pending row from the sibling test
 * and block Save & Verify from clearing the Results panel.
 */
export function findPatientResultRow(
  rows: any[] | null | undefined,
  registrationId: string,
  testId: string,
  parameterId: string,
): any | undefined {
  if (!rows || !registrationId || !testId || !parameterId) return undefined;
  return rows.find(
    (r: any) =>
      r.registration_id === registrationId &&
      r.test_id === testId &&
      r.parameter_id === parameterId,
  );
}

const PAST_PENDING = new Set([
  "entered",
  "results_entered",
  "verified",
  "approved",
  "dispatched",
]);

export function isResultPastPending(status: string | null | undefined): boolean {
  return !!status && PAST_PENDING.has(status);
}

const STATUS_RANK: Record<string, number> = {
  pending: 0,
  entered: 1,
  results_entered: 1,
  verified: 2,
  approved: 3,
  dispatched: 4,
};

function statusRank(status: string | null | undefined): number {
  return STATUS_RANK[status || "pending"] ?? 0;
}

/**
 * Best result row for Results Entry for (reg, test, param):
 * 1) Exact row on this test_id if past-pending
 * 2) Same parameter past-pending on ANY test for this registration (sibling coverage)
 * 3) Exact row on this test_id (even pending)
 * 4) Any other row for same parameter with a value (orphan interface write)
 */
export function resolveResultForResultsEntry(
  rows: any[] | null | undefined,
  registrationId: string,
  testId: string,
  parameterId: string,
): { row: any | undefined; covered: boolean } {
  if (!rows || !registrationId || !testId || !parameterId) {
    return { row: undefined, covered: false };
  }

  const sameParam = rows.filter(
    (r: any) => r.registration_id === registrationId && r.parameter_id === parameterId,
  );
  const exact = sameParam.find((r: any) => r.test_id === testId);

  if (exact && isResultPastPending(exact.status)) {
    return { row: exact, covered: true };
  }

  const completedElsewhere = sameParam
    .filter((r: any) => isResultPastPending(r.status))
    .sort((a: any, b: any) => statusRank(b.status) - statusRank(a.status));
  if (completedElsewhere.length > 0) {
    return { row: completedElsewhere[0], covered: true };
  }

  if (exact) return { row: exact, covered: false };

  const valued = sameParam.find(
    (r: any) => r.result_value != null && String(r.result_value).trim() !== "",
  );
  if (valued) return { row: valued, covered: false };

  return { row: undefined, covered: false };
}

export type HealOrphanResult = {
  healed: number;
  deletedOrphans: number;
};

/**
 * Move orphan pending interface rows (written under a test_id that is NOT on an
 * accepted tube) onto the accepted-tube test that owns the same parameter.
 * Deletes the orphan after a successful copy/merge.
 *
 * When the target test already has other parameters past Results Entry, the
 * healed value is stamped status=entered / entered_by=Administrator so the
 * whole test leaves Results (e.g. TFT T3/T4 approved, TSH orphaned under PCOD).
 */
export async function healOrphanPatientResults(
  supabase: { from: (table: string) => any },
  registrationId: string,
  acceptedTestIds: Set<string>,
  existingRows: any[],
): Promise<HealOrphanResult> {
  let healed = 0;
  let deletedOrphans = 0;
  if (!registrationId || acceptedTestIds.size === 0) {
    return { healed, deletedOrphans };
  }

  const orphans = existingRows.filter(
    (r: any) =>
      r.registration_id === registrationId &&
      r.test_id &&
      !acceptedTestIds.has(r.test_id) &&
      (!r.status || r.status === "pending"),
  );
  if (orphans.length === 0) return { healed, deletedOrphans };

  const paramIds = Array.from(new Set(orphans.map((r: any) => r.parameter_id).filter(Boolean)));
  if (paramIds.length === 0) return { healed, deletedOrphans };

  const { data: tpRows, error: tpErr } = await supabase
    .from("test_parameters")
    .select("test_id, parameter_id")
    .in("parameter_id", paramIds);
  if (tpErr) throw tpErr;

  const acceptedTargetsByParam: Record<string, string[]> = {};
  for (const tp of tpRows || []) {
    if (!acceptedTestIds.has(tp.test_id)) continue;
    if (!acceptedTargetsByParam[tp.parameter_id]) acceptedTargetsByParam[tp.parameter_id] = [];
    acceptedTargetsByParam[tp.parameter_id].push(tp.test_id);
  }

  const pickTarget = (parameterId: string): string | null => {
    const candidates = acceptedTargetsByParam[parameterId] || [];
    if (candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0];
    const scored = candidates.map((tid) => {
      const count = existingRows.filter(
        (r: any) => r.registration_id === registrationId && r.test_id === tid,
      ).length;
      const past = existingRows.filter(
        (r: any) =>
          r.registration_id === registrationId &&
          r.test_id === tid &&
          isResultPastPending(r.status),
      ).length;
      return { tid, count, past };
    });
    scored.sort((a, b) => b.past - a.past || b.count - a.count);
    return scored[0].tid;
  };

  for (const orphan of orphans) {
    const targetTestId = pickTarget(orphan.parameter_id);
    if (!targetTestId) {
      if (orphan.result_value == null || String(orphan.result_value).trim() === "") {
        const { error } = await supabase.from("patient_results").delete().eq("id", orphan.id);
        if (!error) deletedOrphans++;
      }
      continue;
    }

    const target = existingRows.find(
      (r: any) =>
        r.registration_id === registrationId &&
        r.test_id === targetTestId &&
        r.parameter_id === orphan.parameter_id,
    );

    if (target && isResultPastPending(target.status)) {
      const { error } = await supabase.from("patient_results").delete().eq("id", orphan.id);
      if (!error) deletedOrphans++;
      continue;
    }

    const orphanHasVal = orphan.result_value != null && String(orphan.result_value).trim() !== "";
    const targetHasDownstream = existingRows.some(
      (r: any) =>
        r.registration_id === registrationId &&
        r.test_id === targetTestId &&
        isResultPastPending(r.status),
    );

    const payload: Record<string, any> = {
      result_value: orphan.result_value,
      flag: orphan.flag,
      unit: orphan.unit,
      reference_range: orphan.reference_range,
      normal_range_low: orphan.normal_range_low,
      normal_range_high: orphan.normal_range_high,
      is_from_interface: orphan.is_from_interface ?? true,
      is_calculated: orphan.is_calculated ?? false,
      entered_at: orphan.entered_at || new Date().toISOString(),
      entered_by: orphan.entered_by || "INTERFACE",
      status: "pending",
      updated_at: new Date().toISOString(),
      param_code: orphan.param_code,
      parameter_name: orphan.parameter_name,
      note: orphan.note ?? null,
      test_note: orphan.test_note ?? null,
    };

    if (targetHasDownstream && orphanHasVal) {
      payload.status = "entered";
      payload.entered_by = "Administrator";
    }

    if (target) {
      const targetEmpty = target.result_value == null || String(target.result_value).trim() === "";
      if (!targetEmpty && !orphanHasVal) {
        const { error } = await supabase.from("patient_results").delete().eq("id", orphan.id);
        if (!error) deletedOrphans++;
        continue;
      }
      const { error } = await supabase.from("patient_results").update(payload).eq("id", target.id);
      if (error) continue;
      Object.assign(target, payload, { test_id: targetTestId });
    } else {
      const insertRow = {
        registration_id: registrationId,
        test_id: targetTestId,
        parameter_id: orphan.parameter_id,
        ...payload,
      };
      const { data: inserted, error } = await supabase
        .from("patient_results")
        .insert(insertRow)
        .select("*")
        .maybeSingle();
      if (error) continue;
      if (inserted) existingRows.push(inserted);
      else existingRows.push(insertRow);
    }

    const { error: delErr } = await supabase.from("patient_results").delete().eq("id", orphan.id);
    if (!delErr) {
      deletedOrphans++;
      healed++;
      const idx = existingRows.findIndex((r: any) => r.id === orphan.id);
      if (idx >= 0) existingRows.splice(idx, 1);
    }
  }

  return { healed, deletedOrphans };
}