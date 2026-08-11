import { supabase } from "@/integrations/supabase/client";

/**
 * Recalculates and updates patient_registrations.status based on
 * sample_tubes, patient_results, and outsourced_test_snips state.
 *
 * IMPORTANT: A registration must NOT be flagged "processed/verified/approved/dispatched"
 * if there is any accepted tube whose tests have no result rows yet — that test still
 * needs entry. Without this guard, the registration silently leaves the Results Entry
 * queue while real work is still pending (see invoice 2605010014: CBC+ESR tube was
 * accepted but never entered, yet status was 'approved' because the only existing
 * patient_results rows happened to be approved).
 *
 * IMPORTANT: Pending tubes must also block terminal / downstream-complete statuses.
 * `repeat_collection` is preserved ONLY when that status was already set (explicit
 * doctor/acceptance send-back). First-time pending tubes while siblings advance
 * use partial_* statuses — never the REPEAT badge.
 */
export async function recalculateRegistrationStatus(registrationId: string): Promise<void> {
  const [{ data: tubes }, { data: results }, { data: snips }, { data: reg }] = await Promise.all([
    supabase.from("sample_tubes" as any).select("status, test_ids").eq("registration_id", registrationId),
    supabase.from("patient_results").select("status, result_value, test_id").eq("registration_id", registrationId),
    supabase.from("outsourced_test_snips").select("outsource_status, test_id").eq("registration_id", registrationId),
    supabase.from("patient_registrations").select("cancelled_tests, status, repeat_tests").eq("id", registrationId).maybeSingle(),
  ]);

  const t = (tubes || []) as any[];
  const r = (results || []) as any[];
  const s = (snips || []) as any[];
  const currentStatus = String((reg as any)?.status || "");
  const cancelledTestIds = new Set<string>(
    (Array.isArray((reg as any)?.cancelled_tests) ? (reg as any).cancelled_tests : [])
      .map((x: any) => (typeof x === "string" ? x : x?.test_id || x?.id))
      .filter(Boolean),
  );
  const repeatTestsRaw = Array.isArray((reg as any)?.repeat_tests) ? ((reg as any).repeat_tests as any[]) : [];
  const pendingRepeatTests = repeatTestsRaw.filter((rt: any) => {
    const tid = rt?.test_id;
    if (!tid || cancelledTestIds.has(tid)) return false;
    return t.some(
      (tube: any) =>
        tube.status === "pending" &&
        Array.isArray(tube.test_ids) &&
        tube.test_ids.includes(tid),
    );
  });
  // Drop completed repeat entries (test no longer pending)
  const repeatTestsChanged = pendingRepeatTests.length !== repeatTestsRaw.length;

  if (t.length === 0) {
    await supabase.from("patient_registrations").update({ status: "registered" } as any).eq("id", registrationId);
    return;
  }

  // Build set of test_ids that have a MEANINGFUL tracking row (work actually submitted).
  // - patient_results: ONLY count rows whose status has progressed past 'pending'.
  //   A row with a pre-filled result_value but status='pending' (machine interface
  //   auto-push, calculated values) still requires manual Results Entry submission;
  //   if we treat it as tracked the registration disappears from every queue.
  // - outsourced_test_snips: only count rows whose outsource_status is past 'pending'/'sent'.
  const trackedTestIds = new Set<string>();
  r.forEach((x: any) => {
    if (!x.test_id || cancelledTestIds.has(x.test_id)) return;
    const pastPending = ["entered", "results_entered", "verified", "approved", "dispatched"].includes(x.status);
    if (pastPending) trackedTestIds.add(x.test_id);
  });
  s.forEach((x: any) => {
    if (!x.test_id || cancelledTestIds.has(x.test_id)) return;
    if (["results_entered", "entered", "verified", "approved", "dispatched"].includes(x.outsource_status)) {
      trackedTestIds.add(x.test_id);
    }
  });

  // Test_ids attached to ACCEPTED tubes — these are tests that should have entries.
  // Cancelled tests must not block terminal status.
  const acceptedTubeTestIds = new Set<string>();
  t.forEach((tube: any) => {
    if (tube.status === "accepted") {
      (Array.isArray(tube.test_ids) ? tube.test_ids : []).forEach((id: string) => {
        if (id && !cancelledTestIds.has(id)) acceptedTubeTestIds.add(id);
      });
    }
  });

  // Any accepted-tube test that has no result/snip row → entry is still pending.
  let hasUntrackedAcceptedTest = false;
  acceptedTubeTestIds.forEach((id) => {
    if (!trackedTestIds.has(id)) hasUntrackedAcceptedTest = true;
  });

  // Downstream statuses — only rows whose test_id is on a sample tube for this
  // registration. Orphan pending rows under leftover/standalone test_ids (e.g.
  // S.ALBUMIN while the tube carries LFT) must not keep the visit stuck in
  // partial_processing after Save & Verify.
  const tubeTestIds = new Set<string>();
  t.forEach((tube: any) => {
    (Array.isArray(tube.test_ids) ? tube.test_ids : []).forEach((id: string) => {
      if (id && !cancelledTestIds.has(id)) tubeTestIds.add(id);
    });
  });
  const downstream = [
    ...r
      .filter((x: any) => x.test_id && tubeTestIds.has(x.test_id) && !cancelledTestIds.has(x.test_id))
      .map((x: any) => x.status),
    ...s
      .filter((x: any) => x.test_id && !cancelledTestIds.has(x.test_id))
      .map((x: any) => x.outsource_status)
      .filter((st: string) =>
        ["entered", "results_entered", "verified", "approved", "dispatched"].includes(st)
      ),
  ];

  const hasPendingTube = t.some((tube: any) => tube.status === "pending");
  const hasCollectedTube = t.some((tube: any) => tube.status === "collected");

  // Explicit repeat only: keep badge while listed repeat tests still have pending tubes.
  // First-time pending tubes (not in repeat_tests) must NOT get repeat_collection.
  const hasActiveRepeat = pendingRepeatTests.length > 0;
  if (hasActiveRepeat) {
    const patch: Record<string, any> = { status: "repeat_collection" };
    if (repeatTestsChanged) patch.repeat_tests = pendingRepeatTests;
    await supabase.from("patient_registrations").update(patch as any).eq("id", registrationId);
    return;
  }

  let newStatus = "registered";

  // Compute "natural" status from downstream rows alone (original cascade).
  if (downstream.length > 0 && downstream.every((st: string) => st === "dispatched")) {
    newStatus = "dispatched";
  } else if (downstream.some((st: string) => st === "dispatched")) {
    newStatus = "partially_dispatched";
  } else if (downstream.length > 0 && downstream.every((st: string) => st === "approved")) {
    newStatus = "approved";
  } else if (downstream.some((st: string) => st === "approved")) {
    newStatus = "partially_approved";
  } else if (downstream.length > 0 && downstream.every((st: string) => st === "verified")) {
    newStatus = "verified";
  } else if (downstream.some((st: string) => st === "verified")) {
    newStatus = "partial_verified";
  } else if (downstream.length > 0 && downstream.every((st: string) => ["entered", "results_entered"].includes(st))) {
    newStatus = "processed";
  } else if (downstream.some((st: string) => ["entered", "results_entered"].includes(st))) {
    newStatus = "partial_processing";
  } else if (r.some((x: any) => x.test_id && tubeTestIds.has(x.test_id) && !cancelledTestIds.has(x.test_id) && x.result_value && x.result_value.trim() !== "")) {
    newStatus = "processing";
  } else {
    // Check tube statuses only
    const tubeStatuses = t.map((x: any) => x.status as string);
    if (tubeStatuses.every((st) => st === "accepted")) {
      newStatus = "sample_accepted";
    } else if (tubeStatuses.some((st) => st === "accepted")) {
      newStatus = "partially_accepted";
    } else if (tubeStatuses.every((st) => st === "collected" || st === "accepted")) {
      newStatus = "sample_collected";
    } else if (tubeStatuses.some((st) => st === "collected")) {
      newStatus = "partially_collected";
    } else {
      newStatus = "registered";
    }
  }

  // GUARD: if any accepted-tube test has zero result/snip rows (= entry not started),
  // a "terminal" status (processed/verified/approved/dispatched) is wrong because
  // real work is still pending. Downgrade ONLY those terminal statuses to their
  // "partial_*" equivalent — this preserves visibility in BOTH the entry queue
  // AND every downstream queue (Verification, Doctor Approval, Dispatch) that
  // already includes the partial_* variants in their filters.
  if (hasUntrackedAcceptedTest) {
    if (newStatus === "dispatched") newStatus = "partially_dispatched";
    else if (newStatus === "approved") newStatus = "partially_approved";
    else if (newStatus === "verified") newStatus = "partial_verified";
    else if (newStatus === "processed") newStatus = "partial_processing";
    // partial_* / processing / sample_* / registered already route through entry — leave alone.
  }

  // GUARD: first-time (or leftover) pending tubes — never mark repeat_collection here.
  // Block "all done" statuses so collection incomplete work stays visible as partial_*.
  if (hasPendingTube) {
    if (newStatus === "dispatched") newStatus = "partially_dispatched";
    else if (newStatus === "approved") newStatus = "partially_approved";
    else if (newStatus === "verified") newStatus = "partial_verified";
    else if (newStatus === "processed") newStatus = "partial_processing";
    else if (newStatus === "sample_accepted") newStatus = "partially_accepted";
    else if (newStatus === "sample_collected") newStatus = "partially_collected";
    else if (newStatus === "registered" && hasCollectedTube) newStatus = "partially_collected";
  }

  // Clear stale repeat_collection / empty repeat_tests once no active repeat work remains
  const patch: Record<string, any> = { status: newStatus };
  if (repeatTestsChanged || (currentStatus === "repeat_collection" && !hasActiveRepeat)) {
    patch.repeat_tests = pendingRepeatTests;
  }
  // If status was repeat_collection but no active repeat tests, cascade status above already replaced it
  await supabase.from("patient_registrations").update(patch as any).eq("id", registrationId);
}
