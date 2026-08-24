import { supabase } from "@/integrations/supabase/client";

export type ConflictSelectableItem = {
  test_id: string;
  item_type?: "test" | "profile" | "package" | "combo" | null;
};

/**
 * Expand one selectable billing item to leaf test IDs (same graph as sampleTubeGrouping).
 */
export async function expandItemToLeafIds(item: ConflictSelectableItem): Promise<string[]> {
  const type = item.item_type || "test";
  if (type === "test") return [item.test_id];

  const leafIds = new Set<string>();
  const profileIds = new Set<string>();

  if (type === "package") {
    const [pkgTests, pkgProfiles] = await Promise.all([
      supabase.from("health_checkup_tests").select("test_id").eq("health_checkup_id", item.test_id),
      supabase.from("health_checkup_profiles").select("profile_id").eq("health_checkup_id", item.test_id),
    ]);
    (pkgTests.data || []).forEach((r: any) => r.test_id && leafIds.add(r.test_id));
    (pkgProfiles.data || []).forEach((r: any) => r.profile_id && profileIds.add(r.profile_id));
  } else if (type === "combo") {
    const [cmbTests, cmbProfiles] = await Promise.all([
      (supabase as any).from("combo_tests").select("test_id").eq("combo_id", item.test_id),
      (supabase as any).from("combo_profiles").select("profile_id").eq("combo_id", item.test_id),
    ]);
    (cmbTests.data || []).forEach((r: any) => r.test_id && leafIds.add(r.test_id));
    (cmbProfiles.data || []).forEach((r: any) => r.profile_id && profileIds.add(r.profile_id));
  } else if (type === "profile") {
    profileIds.add(item.test_id);
  }

  if (profileIds.size > 0) {
    const { data } = await supabase
      .from("billing_profile_tests")
      .select("test_id")
      .in("profile_id", Array.from(profileIds));
    (data || []).forEach((r: any) => r.test_id && leafIds.add(r.test_id));
  }

  return Array.from(leafIds);
}

/**
 * For each selected item, resolve the set of report parameter IDs it covers.
 * Returns Map<item.test_id, Set<parameter_id>>.
 */
export async function resolveSelectedItemParamSets(
  items: ConflictSelectableItem[],
): Promise<Map<string, Set<string>>> {
  const result = new Map<string, Set<string>>();
  if (!items.length) return result;

  const leafByItem = new Map<string, string[]>();
  await Promise.all(
    items.map(async (item) => {
      leafByItem.set(item.test_id, await expandItemToLeafIds(item));
    }),
  );

  const allLeafIds = Array.from(new Set(Array.from(leafByItem.values()).flat()));
  const paramsByLeaf = new Map<string, Set<string>>();

  if (allLeafIds.length > 0) {
    const { data } = await supabase
      .from("test_parameters")
      .select("test_id, parameter_id, is_subheader")
      .in("test_id", allLeafIds)
      .not("parameter_id", "is", null);

    (data || []).forEach((row: any) => {
      if (!row.test_id || !row.parameter_id || row.is_subheader) return;
      if (!paramsByLeaf.has(row.test_id)) paramsByLeaf.set(row.test_id, new Set());
      paramsByLeaf.get(row.test_id)!.add(row.parameter_id);
    });
  }

  for (const item of items) {
    const set = new Set<string>();
    for (const leafId of leafByItem.get(item.test_id) || []) {
      const leafParams = paramsByLeaf.get(leafId);
      if (leafParams) leafParams.forEach((p) => set.add(p));
    }
    result.set(item.test_id, set);
  }

  return result;
}

/**
 * When two selected items share >=1 parameter, the one with fewer parameters is
 * marked for removal (red highlight). Equal sizes with overlap -> both marked.
 * Never auto-removes — caller only highlights.
 */
export function computeParamConflictHighlightIds(
  paramSets: Map<string, Set<string>>,
): Set<string> {
  const ids = Array.from(paramSets.keys());
  const marked = new Set<string>();

  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = ids[i];
      const b = ids[j];
      const setA = paramSets.get(a)!;
      const setB = paramSets.get(b)!;
      if (setA.size === 0 || setB.size === 0) continue;

      let overlap = false;
      for (const p of setA) {
        if (setB.has(p)) {
          overlap = true;
          break;
        }
      }
      if (!overlap) continue;

      if (setA.size < setB.size) marked.add(a);
      else if (setB.size < setA.size) marked.add(b);
      else {
        marked.add(a);
        marked.add(b);
      }
    }
  }

  return marked;
}