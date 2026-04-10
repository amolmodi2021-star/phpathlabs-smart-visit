import { supabase } from "@/integrations/supabase/client";

/**
 * Recalculates and updates patient_registrations.status based on
 * sample_tubes, patient_results, and outsourced_test_snips state.
 */
export async function recalculateRegistrationStatus(registrationId: string): Promise<void> {
  const [{ data: tubes }, { data: results }, { data: snips }] = await Promise.all([
    supabase.from("sample_tubes" as any).select("status").eq("registration_id", registrationId),
    supabase.from("patient_results").select("status, result_value").eq("registration_id", registrationId),
    supabase.from("outsourced_test_snips").select("outsource_status").eq("registration_id", registrationId),
  ]);

  const t = (tubes || []) as any[];
  const r = (results || []) as any[];
  const s = (snips || []) as any[];

  if (t.length === 0) {
    await supabase.from("patient_registrations").update({ status: "registered" } as any).eq("id", registrationId);
    return;
  }

  // Downstream statuses (results + relevant snip statuses)
  const downstream = [
    ...r.map((x: any) => x.status),
    ...s.map((x: any) => x.outsource_status).filter((st: string) =>
      ["entered", "results_entered", "verified", "approved", "dispatched"].includes(st)
    ),
  ];

  let newStatus = "registered";

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

  await supabase.from("patient_registrations").update({ status: newStatus } as any).eq("id", registrationId);
}
