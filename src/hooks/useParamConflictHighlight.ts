import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  resolveSelectedItemParamSets,
  computeParamConflictHighlightIds,
  type ConflictSelectableItem,
} from "@/lib/testParameterConflicts";

/**
 * Highlights selected billing items that share report parameters with a larger
 * selected item (fewer params → highlight). Does not auto-remove; save stays allowed.
 */
export function useParamConflictHighlight(
  selectedItems: ConflictSelectableItem[],
  queryKeyPrefix = "param-conflicts",
) {
  const selectedKey = selectedItems
    .map((t) => `${t.test_id}:${t.item_type || "test"}`)
    .join("|");

  const { data: paramConflictIds = [] } = useQuery({
    queryKey: [queryKeyPrefix, selectedKey],
    queryFn: async () => {
      if (selectedItems.length < 2) return [] as string[];
      const paramSets = await resolveSelectedItemParamSets(selectedItems);
      return Array.from(computeParamConflictHighlightIds(paramSets));
    },
    enabled: selectedItems.length >= 2,
    staleTime: 30_000,
  });

  const paramConflictSet = useMemo(() => new Set(paramConflictIds), [paramConflictIds]);

  return paramConflictSet;
}