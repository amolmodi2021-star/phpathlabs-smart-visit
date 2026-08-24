import { supabase } from "@/integrations/supabase/client";
import { expandItemToLeafIds, type ConflictSelectableItem } from "@/lib/testParameterConflicts";

export type SelectedItemType = "test" | "profile" | "package" | "combo";

export type SelectedItemContentsRef = {
  test_id: string;
  test_name: string;
  item_type?: SelectedItemType | null;
};

export type LeafTestRow = {
  test_id: string;
  test_name: string;
};

export type ParamRow = {
  parameter_id: string | null;
  parameter_name: string;
  is_subheader: boolean;
  subheader_text: string | null;
};

export function contentsKindLabel(itemType?: string | null): string {
  switch (itemType || "test") {
    case "package":
      return "Health check-up";
    case "combo":
      return "Combo";
    case "profile":
      return "Profile";
    default:
      return "Test";
  }
}

/** Leaf tests included in a package / combo / profile. Empty for plain tests. */
export async function loadIncludedLeafTests(item: ConflictSelectableItem): Promise<LeafTestRow[]> {
  const type = item.item_type || "test";
  if (type === "test") return [];

  const leafIds = await expandItemToLeafIds(item);
  if (leafIds.length === 0) return [];

  const { data, error } = await supabase
    .from("tests")
    .select("id, test_name")
    .in("id", leafIds);
  if (error) throw new Error(error.message);

  const byId = new Map((data || []).map((t: any) => [t.id as string, String(t.test_name || "")]));
  return leafIds
    .map((id) => ({ test_id: id, test_name: byId.get(id) || id }))
    .filter((r) => r.test_name);
}

/** Parameters for one leaf test (headers included for readability). Lazy-load only. */
export async function loadTestParamRows(testId: string): Promise<ParamRow[]> {
  const { data, error } = await supabase
    .from("test_parameters")
    .select("parameter_id, display_order, is_subheader, subheader_text, report_test_parameters(parameter_name)")
    .eq("test_id", testId)
    .order("display_order");
  if (error) throw new Error(error.message);

  return (data || []).map((row: any) => {
    const isSub = !!row.is_subheader;
    return {
      parameter_id: row.parameter_id || null,
      parameter_name: isSub
        ? String(row.subheader_text || "Section")
        : String(row.report_test_parameters?.parameter_name || "—"),
      is_subheader: isSub,
      subheader_text: row.subheader_text ?? null,
    };
  });
}