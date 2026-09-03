import type { SupabaseClient } from "@supabase/supabase-js";

export type LimsOrderTest = {
  code: string;
  name: string;
  unit: string;
  machine_id: string;
  status: "pending";
};

export type TestParamInterfaceInfo = {
  params: Array<{ code: string; name: string; machine_id: string; unit: string }>;
  hasAnyParam: boolean;
};

export type TubeForOrder = {
  suffix?: string | null;
  test_ids?: string[] | null;
};

/** Build analyzer-facing tests for one tube from master maps. */
export function buildOrderTestsForTube(
  testIds: string[],
  testsMap: Record<string, { test_code?: string; test_name?: string; machine_id?: string | null }>,
  testParamData: Record<string, TestParamInterfaceInfo>,
  cancelledIds: Set<string> = new Set()
): LimsOrderTest[] {
  const orderTests: LimsOrderTest[] = [];
  const activeTestIds = (testIds || []).filter((id) => id && !cancelledIds.has(id));

  for (const testId of activeTestIds) {
    const testInfo = testsMap[testId] || {};
    const paramData = testParamData[testId];
    if (paramData && paramData.params.length > 0) {
      for (const p of paramData.params) {
        orderTests.push({
          code: p.code,
          name: p.name,
          unit: p.unit,
          machine_id: p.machine_id || testInfo.machine_id || "",
          status: "pending",
        });
      }
    } else if (paramData && paramData.hasAnyParam) {
      // Parameters exist but none are interface-flagged — skip (manual/calculated only).
      continue;
    } else {
      orderTests.push({
        code: testInfo.test_code || "",
        name: testInfo.test_name || "",
        unit: "",
        machine_id: testInfo.machine_id || "",
        status: "pending",
      });
    }
  }

  return orderTests;
}

export function sampleIdForTube(invoiceNumber: string, suffix?: string | null): string {
  const s = (suffix || "").trim();
  return s ? `${invoiceNumber}${s}` : String(invoiceNumber);
}

function cancelledIdSet(cancelledTests: unknown): Set<string> {
  const list = Array.isArray(cancelledTests) ? cancelledTests : [];
  return new Set(
    list
      .map((item: any) => (typeof item === "string" ? item : item?.test_id))
      .filter(Boolean)
  );
}

async function getSupabase() {
  const { supabase } = await import("@/integrations/supabase/client");
  return supabase as SupabaseClient;
}

/** Load test + interface-parameter maps for the given test IDs (avoids stale UI cache / 1000-row caps). */
export async function loadInterfaceMapsForTests(testIds: string[]): Promise<{
  testsMap: Record<string, any>;
  testParamData: Record<string, TestParamInterfaceInfo>;
}> {
  const unique = [...new Set(testIds.filter(Boolean))];
  const testsMap: Record<string, any> = {};
  const testParamData: Record<string, TestParamInterfaceInfo> = {};
  if (unique.length === 0) return { testsMap, testParamData };

  const supabase = await getSupabase();
  const { data: tests, error: testsErr } = await supabase
    .from("tests")
    .select("id, test_name, test_code, machine_id")
    .in("id", unique);
  if (testsErr) throw testsErr;
  for (const t of tests || []) testsMap[t.id] = t;

  const { data: params, error: paramsErr } = await supabase
    .from("test_parameters")
    .select("test_id, parameter_id, report_test_parameters(param_code, parameter_name, send_for_interface, machine_id, unit)")
    .in("test_id", unique);
  if (paramsErr) throw paramsErr;

  for (const tp of params || []) {
    const p = (tp as any).report_test_parameters;
    if (!p || !tp.test_id) continue;
    if (!testParamData[tp.test_id]) testParamData[tp.test_id] = { params: [], hasAnyParam: false };
    testParamData[tp.test_id].hasAnyParam = true;
    if (p.send_for_interface) {
      testParamData[tp.test_id].params.push({
        code: p.param_code,
        name: p.parameter_name,
        machine_id: p.machine_id || "",
        unit: p.unit || "",
      });
    }
  }

  return { testsMap, testParamData };
}

/**
 * Insert lims_test_orders for accepted tubes. Fetches fresh master data so acceptance
 * does not depend on Sample Acceptance React Query caches.
 *
 * - Multiple tubes that share the same sample_id (e.g. no suffix) are merged into one order.
 * - If a pending/in_progress order already exists for that sample_id, skip insert
 *   (prevents double-accept duplicates that make analyzers see each test twice).
 */
export async function createLimsOrdersForAcceptedTubes(args: {
  invoiceNumber: string;
  patientName: string;
  cancelledTests?: unknown;
  tubes: TubeForOrder[];
}): Promise<{ created: number; sampleIds: string[]; skipped: number }> {
  const allTestIds = args.tubes.flatMap((t) => t.test_ids || []);
  const { testsMap, testParamData } = await loadInterfaceMapsForTests(allTestIds);
  const cancelledIds = cancelledIdSet(args.cancelledTests);
  const supabase = await getSupabase();

  // Merge tubes that resolve to the same analyzer barcode / sample_id.
  const bySampleId = new Map<string, LimsOrderTest[]>();
  for (const tube of args.tubes) {
    const orderTests = buildOrderTestsForTube(
      tube.test_ids || [],
      testsMap,
      testParamData,
      cancelledIds,
    );
    if (orderTests.length === 0) continue;
    const sampleId = sampleIdForTube(args.invoiceNumber, tube.suffix);
    const existing = bySampleId.get(sampleId) || [];
    const seen = new Set(existing.map((t) => `${t.code}||${t.machine_id}`));
    for (const t of orderTests) {
      const key = `${t.code}||${t.machine_id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      existing.push(t);
    }
    bySampleId.set(sampleId, existing);
  }

  const sampleIds: string[] = [];
  let created = 0;
  let skipped = 0;

  for (const [sampleId, orderTests] of bySampleId) {
    if (orderTests.length === 0) continue;

    const { data: existingOrders, error: existingErr } = await supabase
      .from("lims_test_orders")
      .select("id")
      .eq("sample_id", sampleId)
      .in("status", ["pending", "in_progress"])
      .limit(1);
    if (existingErr) throw existingErr;
    if (existingOrders && existingOrders.length > 0) {
      skipped += 1;
      continue;
    }

    const { error } = await supabase.from("lims_test_orders").insert({
      sample_id: sampleId,
      patient_name: args.patientName,
      tests: orderTests,
      status: "pending",
    });
    if (error) throw error;
    created += 1;
    sampleIds.push(sampleId);
  }

  return { created, sampleIds, skipped };
}
