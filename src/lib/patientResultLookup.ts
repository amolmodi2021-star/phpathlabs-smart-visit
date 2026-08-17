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
export type RestoreApprovedResult = {
  restored: number;
};

/**
 * If approved_reports still lists a parameter but patient_results lost that row
 * (e.g. a Results save wiped it), recreate the approved row from the snapshot
 * so Results Entry does not keep inventing empty pending fields.
 */
export async function restoreMissingApprovedFromReports(
  supabase: { from: (table: string) => any },
  registrationIds: string[],
  existingRows: any[],
): Promise<RestoreApprovedResult> {
  let restored = 0;
  if (!registrationIds.length) return { restored };

  const { data: reports, error } = await supabase
    .from("approved_reports")
    .select("registration_id, test_results")
    .in("registration_id", registrationIds);
  if (error || !reports?.length) return { restored };

  for (const report of reports) {
    const regId = report.registration_id;
    const snapshot = Array.isArray(report.test_results) ? report.test_results : [];
    for (const s of snapshot) {
      const testId = s?.test_id;
      const parameterId = s?.parameter_id;
      if (!testId || !parameterId) continue;

      const live = existingRows.find(
        (r) =>
          r.registration_id === regId &&
          r.test_id === testId &&
          r.parameter_id === parameterId,
      );
      if (live && isResultPastPending(live.status)) continue;
      if (live && !isResultPastPending(live.status)) {
        const { error: delErr } = await supabase.from("patient_results").delete().eq("id", live.id);
        if (delErr) continue;
        const idx = existingRows.findIndex((r) => r.id === live.id);
        if (idx >= 0) existingRows.splice(idx, 1);
      }

      const nowIso = new Date().toISOString();
      const insertRow = {
        registration_id: regId,
        test_id: testId,
        parameter_id: parameterId,
        param_code: s.param_code ?? null,
        parameter_name: s.parameter_name ?? null,
        result_value: s.result_value ?? null,
        unit: s.unit ?? null,
        reference_range: s.reference_range ?? null,
        normal_range_low: s.normal_range_low ?? null,
        normal_range_high: s.normal_range_high ?? null,
        flag: s.flag ?? null,
        status: "approved",
        is_calculated: !!s.is_calculated,
        is_from_interface: false,
        approved_at: nowIso,
        approved_by: s.approved_by ?? null,
        entered_at: nowIso,
        entered_by: "Administrator",
        note: s.note ?? null,
        test_note: s.test_note ?? null,
        updated_at: nowIso,
      };
      const { data: inserted, error: insErr } = await supabase
        .from("patient_results")
        .insert(insertRow)
        .select("*")
        .maybeSingle();
      if (insErr) continue;
      if (inserted) existingRows.push(inserted);
      else existingRows.push(insertRow);
      restored++;
    }
  }

  return { restored };
}

export type HealApprovedSnapshotResult = {
  added: number;
  reportsArr: any[];
};

/**
 * View Report / PDF reads approved_reports.test_results. If Doctor Approval
 * races or a later save drops a test, live patient_results can still be
 * approved/dispatched while the snapshot omits them (CBC on 2608170010).
 * Merge any missing live rows into the in-memory report (and persist).
 */
export async function healApprovedReportSnapshotFromLive(
  supabase: { from: (table: string) => any },
  registrationId: string,
  reportsArr: any[],
  testNameById: Record<string, string> = {},
): Promise<HealApprovedSnapshotResult> {
  if (!registrationId || !reportsArr.length) {
    return { added: 0, reportsArr };
  }

  const { data: liveRows, error } = await supabase
    .from("patient_results")
    .select(
      "test_id, parameter_id, param_code, parameter_name, result_value, unit, reference_range, normal_range_low, normal_range_high, flag, is_calculated, note, test_note, approved_by, approved_at",
    )
    .eq("registration_id", registrationId)
    .in("status", ["approved", "dispatched"]);
  if (error || !liveRows?.length) return { added: 0, reportsArr };

  const primary = reportsArr[0];
  const existing = Array.isArray(primary?.test_results) ? [...primary.test_results] : [];
  const existingKeys = new Set(
    existing
      .filter((r: any) => r?.test_id && r?.parameter_id)
      .map((r: any) => `${r.test_id}||${r.parameter_id}`),
  );

  // Reuse signature metadata from an existing snapshot row for the same approver.
  const metaByApprover = new Map<string, any>();
  for (const r of existing) {
    const by = String(r?.approved_by || "").trim();
    if (!by || metaByApprover.has(by)) continue;
    if (r?.approved_by_signature_url || r?.approved_by_qualification || r?.approved_by_designation) {
      metaByApprover.set(by, {
        approved_by_qualification: r.approved_by_qualification || null,
        approved_by_designation: r.approved_by_designation || null,
        approved_by_signature_url: r.approved_by_signature_url || null,
      });
    }
  }

  const missing: any[] = [];
  for (const row of liveRows as any[]) {
    if (!row.test_id || !row.parameter_id) continue;
    const key = `${row.test_id}||${row.parameter_id}`;
    if (existingKeys.has(key)) continue;
    const by = String(row.approved_by || "").trim();
    const meta = metaByApprover.get(by) || {};
    missing.push({
      test_id: row.test_id,
      test_name: testNameById[row.test_id] || "",
      parameter_id: row.parameter_id,
      param_code: row.param_code || null,
      parameter_name: row.parameter_name || null,
      result_value: row.result_value ?? null,
      unit: row.unit ?? null,
      reference_range: row.reference_range ?? null,
      normal_range_low: row.normal_range_low ?? null,
      normal_range_high: row.normal_range_high ?? null,
      flag: row.flag ?? null,
      is_calculated: !!row.is_calculated,
      is_outsourced: false,
      outsource_lab_name: null,
      approved_by: row.approved_by || primary?.approved_by || null,
      approved_by_qualification: meta.approved_by_qualification || null,
      approved_by_designation: meta.approved_by_designation || null,
      approved_by_signature_url: meta.approved_by_signature_url || null,
      note: row.note || null,
      test_note: row.test_note || null,
    });
    existingKeys.add(key);
  }

  if (missing.length === 0) return { added: 0, reportsArr };

  const mergedResults = existing.concat(missing);
  const healed = reportsArr.map((r, i) =>
    i === 0 ? { ...r, test_results: mergedResults } : r,
  );

  // Persist so Dispatch / Modified Approval stay consistent after this view.
  await supabase
    .from("approved_reports")
    .update({ test_results: mergedResults } as any)
    .eq("registration_id", registrationId);

  return { added: missing.length, reportsArr: healed };
}

/**
 * Load approved_reports for a registration and merge any approved/dispatched
 * patient_results rows that are missing from the snapshot. Used by Dispatch
 * All / Send Reports before PDF generation.
 */
export async function ensureApprovedReportSnapshotHealed(
  supabase: { from: (table: string) => any },
  registrationId: string,
): Promise<number> {
  if (!registrationId) return 0;
  const { data: report, error } = await supabase
    .from("approved_reports")
    .select("*")
    .eq("registration_id", registrationId)
    .maybeSingle();
  if (error || !report) return 0;

  const { data: tests } = await supabase.from("tests").select("id, test_name");
  const testNameById: Record<string, string> = {};
  (tests || []).forEach((t: any) => {
    testNameById[t.id] = t.test_name;
  });

  const healed = await healApprovedReportSnapshotFromLive(
    supabase,
    registrationId,
    [report],
    testNameById,
  );
  return healed.added;
}


