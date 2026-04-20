import { supabase } from "@/integrations/supabase/client";

export interface TubeGroup {
  tubeType: string;
  tubeColor: string;
  sampleType: string;
  suffix: string;
  testIds: string[];
  testNames: string[];
}

export interface TubeGroupingItem {
  test_id: string;
  test_name: string;
  item_type?: "test" | "profile" | "package" | null;
}

/**
 * Build grouped sample tubes from a mixed selection of tests / profiles / health check-ups.
 *
 * - "test"     -> uses the ID directly.
 * - "profile"  -> expanded to leaf tests via billing_profile_tests.
 * - "package"  -> expanded to leaf tests via health_checkup_tests + nested profiles via
 *                 health_checkup_profiles -> billing_profile_tests.
 *
 * Leaf tests are deduped, then grouped by `${sample_tube}||${custom_sample_suffix}` so a
 * profile's CBC and a standalone CBC share the same physical EDTA tube.
 */
export const buildSampleTubeGroups = async (
  selectedItems: TubeGroupingItem[],
  cancelledTestIds?: Set<string>,
): Promise<TubeGroup[]> => {
  if (!selectedItems || selectedItems.length === 0) return [];

  const directTestIds = new Set<string>();
  const profileIds = new Set<string>();
  const packageIds = new Set<string>();

  for (const item of selectedItems) {
    const type = item.item_type || "test";
    if (type === "profile") profileIds.add(item.test_id);
    else if (type === "package") packageIds.add(item.test_id);
    else directTestIds.add(item.test_id);
  }

  // Expand health check-ups: direct leaf tests + nested profile IDs
  const nestedProfileIds = new Set<string>();
  if (packageIds.size > 0) {
    const pkgIdArr = Array.from(packageIds);
    const [pkgTestsRes, pkgProfilesRes] = await Promise.all([
      supabase.from("health_checkup_tests").select("test_id").in("health_checkup_id", pkgIdArr),
      supabase.from("health_checkup_profiles").select("profile_id").in("health_checkup_id", pkgIdArr),
    ]);
    (pkgTestsRes.data || []).forEach((row: any) => row.test_id && directTestIds.add(row.test_id));
    (pkgProfilesRes.data || []).forEach((row: any) => row.profile_id && nestedProfileIds.add(row.profile_id));
  }

  // Expand all profiles (top-level + nested) into leaf tests
  const allProfileIds = new Set<string>([...profileIds, ...nestedProfileIds]);
  if (allProfileIds.size > 0) {
    const { data: profileTests } = await supabase
      .from("billing_profile_tests")
      .select("test_id")
      .in("profile_id", Array.from(allProfileIds));
    (profileTests || []).forEach((row: any) => row.test_id && directTestIds.add(row.test_id));
  }

  // Strip cancelled
  if (cancelledTestIds && cancelledTestIds.size > 0) {
    cancelledTestIds.forEach(id => directTestIds.delete(id));
  }

  if (directTestIds.size === 0) return [];

  const leafIds = Array.from(directTestIds);

  // Batch fetch tube metadata + suffix info + multi-tube assignments
  const [testRowsRes, suffixRowsRes, multiTubesRes] = await Promise.all([
    supabase.from("tests").select("id, test_name, sample_tube, tube_color, sample_type").in("id", leafIds),
    supabase
      .from("test_parameters")
      .select("test_id, report_test_parameters!inner(custom_sample_suffix_enabled, custom_sample_suffix)")
      .in("test_id", leafIds)
      .eq("report_test_parameters.custom_sample_suffix_enabled", true),
    supabase
      .from("test_sample_tubes")
      .select("test_id, tube_value, sample_type, tube_color, display_order")
      .in("test_id", leafIds)
      .order("display_order"),
  ]);

  const testInfoMap: Record<string, any> = {};
  (testRowsRes.data || []).forEach((t: any) => { testInfoMap[t.id] = t; });

  const suffixMap: Record<string, string> = {};
  (suffixRowsRes.data || []).forEach((tp: any) => {
    const suffix = tp.report_test_parameters?.custom_sample_suffix;
    if (tp.test_id && suffix) suffixMap[tp.test_id] = suffix;
  });

  // Per-test multi-tube map: test_id -> [{tube, color, type}, ...]
  const multiTubeMap: Record<string, Array<{ tube: string; color: string; type: string }>> = {};
  (multiTubesRes.data || []).forEach((row: any) => {
    if (!row.test_id || !row.tube_value) return;
    if (!multiTubeMap[row.test_id]) multiTubeMap[row.test_id] = [];
    multiTubeMap[row.test_id].push({
      tube: row.tube_value,
      color: row.tube_color || "",
      type: row.sample_type || "",
    });
  });

  // Group by tube + suffix; fan out per leaf test into all its tubes
  const groupMap: Record<string, TubeGroup> = {};
  for (const id of leafIds) {
    const info = testInfoMap[id] || {};
    const suffix = suffixMap[id] || "";
    // Prefer multi-tube rows; fall back to legacy single column
    const tubes = multiTubeMap[id]?.length
      ? multiTubeMap[id]
      : [{ tube: info.sample_tube || "DEFAULT", color: info.tube_color || "", type: info.sample_type || "" }];

    for (const t of tubes) {
      const key = `${t.tube}||${suffix}`;
      if (!groupMap[key]) {
        groupMap[key] = {
          tubeType: t.tube,
          tubeColor: t.color,
          sampleType: t.type,
          suffix,
          testIds: [],
          testNames: [],
        };
      }
      // Avoid duplicating test name in same group when fan-out happens
      if (!groupMap[key].testIds.includes(id)) {
        groupMap[key].testIds.push(id);
        groupMap[key].testNames.push(info.test_name || "");
      }
    }
  }

  return Object.values(groupMap);
};
