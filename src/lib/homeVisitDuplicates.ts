import { supabase } from "@/integrations/supabase/client";

function normName(raw: string | null | undefined): string {
  return String(raw || "").replace(/\s+/g, " ").trim().toUpperCase();
}

function normPhone(raw: string | null | undefined): string {
  const d = String(raw || "").replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : d;
}

export async function assertNoDuplicatePendingHomeVisit(opts: {
  whatsappNumber: string;
  patientName: string;
  visitDate: string;
  visitTime: string;
}): Promise<void> {
  const phone = normPhone(opts.whatsappNumber);
  const name = normName(opts.patientName);
  if (!phone || phone.length !== 10 || !opts.visitDate || !opts.visitTime) return;

  const { data: pending, error } = await supabase
    .from("home_visits")
    .select("id, visit_date, visit_time, estimate_id, estimates(patient_name, whatsapp_number)")
    .eq("status", "Pending")
    .eq("visit_date", opts.visitDate)
    .eq("visit_time", opts.visitTime)
    .limit(50);
  if (error) throw new Error(error.message);

  const hit = (pending || []).find((row: any) => {
    const est = row.estimates || {};
    return normPhone(est.whatsapp_number) === phone && normName(est.patient_name) === name;
  });
  if (hit) {
    throw new Error(
      "A pending home visit already exists for this patient at the same date and time. Open that card instead of booking again.",
    );
  }
}

export async function cancelOrphanDuplicateHomeVisits(registeredVisitId: string): Promise<number> {
  if (!registeredVisitId) return 0;

  const { data: registered, error: regErr } = await supabase
    .from("home_visits")
    .select("id, visit_date, visit_time, estimate_id, estimates(patient_name, whatsapp_number)")
    .eq("id", registeredVisitId)
    .maybeSingle();
  if (regErr) throw new Error(regErr.message);
  if (!registered) return 0;

  const est = (registered as any).estimates || {};
  const phone = normPhone(est.whatsapp_number);
  const name = normName(est.patient_name);
  if (!phone || !registered.visit_date || !registered.visit_time) return 0;

  const { data: candidates, error: cErr } = await supabase
    .from("home_visits")
    .select("id, estimate_id, estimates(patient_name, whatsapp_number)")
    .eq("status", "Pending")
    .eq("visit_date", registered.visit_date)
    .eq("visit_time", registered.visit_time)
    .neq("id", registeredVisitId)
    .limit(50);
  if (cErr) throw new Error(cErr.message);

  const orphanIds: string[] = [];
  for (const row of candidates || []) {
    const rowEst = (row as any).estimates || {};
    if (normPhone(rowEst.whatsapp_number) !== phone) continue;
    if (name && normName(rowEst.patient_name) !== name) continue;

    const { count, error: cntErr } = await supabase
      .from("patient_registrations")
      .select("id", { count: "exact", head: true })
      .eq("home_visit_id", row.id);
    if (cntErr) throw new Error(cntErr.message);
    if ((count || 0) > 0) continue;
    orphanIds.push(row.id);
  }

  if (!orphanIds.length) return 0;

  const { error: updErr } = await supabase
    .from("home_visits")
    .update({
      status: "Cancelled",
      cancellation_reason: "Duplicate booking — auto-cancelled after registration",
      updated_at: new Date().toISOString(),
    } as any)
    .in("id", orphanIds);
  if (updErr) throw new Error(updErr.message);
  return orphanIds.length;
}