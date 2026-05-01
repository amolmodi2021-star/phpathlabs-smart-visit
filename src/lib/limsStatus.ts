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
 */
export async function recalculateRegistrationStatus(registrationId: string): Promise<void> {
  const [{ data: tubes }, { data: results }, { data: snips }] = await Promise.all([
    supabase.from("sample_tubes" as any).select("status, test_ids").eq("registration_id", registrationId),
    supabase.from("patient_results").select("status, result_value, test_id").eq("registration_id", registrationId),
    supabase.from("outsourced_test_snips").select("outsource_status, test_id").eq("registration_id", registrationId),
  ]);

  const t = (tubes || []) as any[];
  const r = (results || []) as any[];
  const s = (snips || []) as any[];

  if (t.length === 0) {
    await supabase.from("patient_registrations").update({ status: "registered" } as any).eq("id", registrationId);
    return;
  }

  // Build set of test_ids that have ANY tracking row (result or snip).
  const trackedTestIds = new Set<string>();
  r.forEach((x: any) => x.test_id && trackedTestIds.add(x.test_id));
  s.forEach((x: any) => x.test_id && trackedTestIds.add(x.test_id));

  // Test_ids attached to ACCEPTED tubes — these are tests that should have entries.
  const acceptedTubeTestIds = new Set<string>();
  t.forEach((tube: any) => {
    if (tube.status === "accepted") {
      (Array.isArray(tube.test_ids) ? tube.test_ids : []).forEach((id: string) => {
        if (id) acceptedTubeTestIds.add(id);
      });
    }
  });

  // Any accepted-tube test that has no result/snip row → entry is still pending.
  let hasUntrackedAcceptedTest = false;
  acceptedTubeTestIds.forEach((id) => {
    if (!trackedTestIds.has(id)) hasUntrackedAcceptedTest = true;
  });

  // Downstream statuses (results + relevant snip statuses)
  const downstream = [
    ...r.map((x: any) => x.status),
    ...s.map((x: any) => x.outsource_status).filter((st: string) =>
      ["entered", "results_entered", "verified", "approved", "dispatched"].includes(st)
    ),
  ];

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
  } else if (r.some((x: any) => x.result_value && x.result_value.trim() !== "")) {
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

  await supabase.from("patient_registrations").update({ status: newStatus } as any).eq("id", registrationId);
}
