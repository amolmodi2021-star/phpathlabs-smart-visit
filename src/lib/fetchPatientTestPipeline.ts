/**
 * Lean on-demand fetch for patient test pipeline hover (egress-aware).
 * Loads only when the hover opens; caches briefly via react-query on the caller.
 */
import { supabase } from "@/integrations/supabase/client";
import { expandRegistrationTests } from "@/lib/expandRegistrationTests";
import {
  buildPipelineOverview,
  type PipelineTestRow,
} from "@/lib/testPipelineStatus";

const REG_SELECT = "id, tests, cancelled_tests, repeat_tests, bill_cancelled";
const TUBE_SELECT = "test_ids, status";
const RESULT_SELECT = "test_id, status";
const SNIP_SELECT = "test_id, outsource_status";

export async function fetchPatientTestPipeline(registrationId: string): Promise<PipelineTestRow[]> {
  if (!registrationId) return [];

  const [{ data: reg, error: regErr }, { data: tubes, error: tubeErr }, { data: results, error: resErr }, { data: snips, error: snipErr }] =
    await Promise.all([
      supabase.from("patient_registrations").select(REG_SELECT).eq("id", registrationId).maybeSingle(),
      supabase.from("sample_tubes").select(TUBE_SELECT).eq("registration_id", registrationId),
      supabase.from("patient_results").select(RESULT_SELECT).eq("registration_id", registrationId),
      supabase.from("outsourced_test_snips").select(SNIP_SELECT).eq("registration_id", registrationId),
    ]);

  if (regErr) throw regErr;
  if (tubeErr) throw tubeErr;
  if (resErr) throw resErr;
  if (snipErr) throw snipErr;
  if (!reg) return [];

  const leafIds = new Set<string>();
  for (const tb of tubes || []) {
    for (const id of Array.isArray(tb.test_ids) ? tb.test_ids : []) {
      if (id) leafIds.add(id);
    }
  }
  // Also include registered tests not yet on a tube
  for (const t of Array.isArray((reg as any).tests) ? (reg as any).tests : []) {
    if (t?.test_id) leafIds.add(t.test_id);
  }

  const leafIdList = [...leafIds];
  let testsMap: Record<string, { test_name?: string | null }> = {};
  if (leafIdList.length > 0) {
    const { data: tests, error: tErr } = await supabase
      .from("tests")
      .select("id, test_name")
      .in("id", leafIdList.slice(0, 200));
    if (tErr) throw tErr;
    for (const t of tests || []) testsMap[t.id] = t;
  }

  const leafTests = expandRegistrationTests(
    (reg as any).tests || [],
    leafIds,
    testsMap,
  ).map((t: any) => ({
    test_id: t.test_id,
    test_name: t.test_name || testsMap[t.test_id]?.test_name || "",
  }));

  // Include orphan leafs present on tubes but missing from registration JSON
  const seen = new Set(leafTests.map((t) => t.test_id));
  for (const id of leafIds) {
    if (seen.has(id)) continue;
    leafTests.push({ test_id: id, test_name: testsMap[id]?.test_name || "" });
  }

  return buildPipelineOverview({
    registration: reg as any,
    tubes: (tubes || []) as any[],
    resultRows: (results || []) as any[],
    snips: (snips || []) as any[],
    testsMap,
    leafTests,
  });
}