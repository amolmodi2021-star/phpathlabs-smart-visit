import { useEffect, useMemo, useState } from "react";
import {
  resolveSelectedItemParamSets,
  computeParamConflictHighlightIds,
  type ConflictSelectableItem,
} from "@/lib/testParameterConflicts";

/**
 * Highlights selected billing items that share report parameters with a larger
 * selected item (fewer params → highlight). Does not auto-remove; save stays allowed.
 *
 * Uses useEffect (not React Query) so dialogs that open/close often still refresh
 * highlights reliably when the selection changes.
 */
export function useParamConflictHighlight(
  selectedItems: ConflictSelectableItem[],
  _queryKeyPrefix = "param-conflicts",
) {
  const selectedKey = selectedItems
    .map((t) => `${t.test_id}:${t.item_type || "test"}`)
    .join("|");

  const [paramConflictIds, setParamConflictIds] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;

    if (selectedItems.length < 2) {
      setParamConflictIds([]);
      return;
    }

    const items: ConflictSelectableItem[] = selectedItems.map((t) => ({
      test_id: t.test_id,
      item_type: t.item_type || "test",
    }));

    (async () => {
      try {
        const paramSets = await resolveSelectedItemParamSets(items);
        if (cancelled) return;
        setParamConflictIds(Array.from(computeParamConflictHighlightIds(paramSets)));
      } catch {
        if (!cancelled) setParamConflictIds([]);
      }
    })();

    return () => {
      cancelled = true;
    };
    // selectedKey captures id+type; items are rebuilt from selectedItems in this effect run
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey]);

  return useMemo(() => new Set(paramConflictIds), [paramConflictIds]);
}
