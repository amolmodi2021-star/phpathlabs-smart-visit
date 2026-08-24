import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ChevronDown, ChevronRight, ListTree, Loader2 } from "lucide-react";
import {
  contentsKindLabel,
  loadIncludedLeafTests,
  loadTestParamRows,
  type LeafTestRow,
  type ParamRow,
  type SelectedItemContentsRef,
} from "@/lib/selectedTestContents";

type Props = {
  item: SelectedItemContentsRef;
};

/**
 * Small button on a selected billing item. Opens a lean drill-down:
 * package/combo/profile → included tests → parameters (lazy).
 * Plain test → parameters directly.
 */
export default function SelectedTestContentsButton({ item }: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [leafTests, setLeafTests] = useState<LeafTestRow[] | null>(null);
  const [directParams, setDirectParams] = useState<ParamRow[] | null>(null);
  const [expandedTestId, setExpandedTestId] = useState<string | null>(null);
  const [paramsByTest, setParamsByTest] = useState<Record<string, ParamRow[]>>({});
  const [loadingParamsFor, setLoadingParamsFor] = useState<string | null>(null);

  const kind = item.item_type || "test";
  const isContainer = kind === "package" || kind === "combo" || kind === "profile";

  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError(null);
      try {
        if (isContainer) {
          const rows = await loadIncludedLeafTests({
            test_id: item.test_id,
            item_type: kind,
          });
          if (!cancelled) {
            setLeafTests(rows);
            setDirectParams(null);
          }
        } else {
          const rows = await loadTestParamRows(item.test_id);
          if (!cancelled) {
            setDirectParams(rows);
            setLeafTests(null);
          }
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Could not load contents");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, item.test_id, kind, isContainer]);

  const toggleTestParams = async (testId: string) => {
    if (expandedTestId === testId) {
      setExpandedTestId(null);
      return;
    }
    setExpandedTestId(testId);
    if (paramsByTest[testId]) return;
    setLoadingParamsFor(testId);
    try {
      const rows = await loadTestParamRows(testId);
      setParamsByTest((prev) => ({ ...prev, [testId]: rows }));
    } catch (e: any) {
      setError(e?.message || "Could not load parameters");
    } finally {
      setLoadingParamsFor(null);
    }
  };

  const renderParamList = (rows: ParamRow[]) => {
    if (rows.length === 0) {
      return <p className="px-2 py-1 text-[11px] text-muted-foreground">No parameters linked</p>;
    }
    return (
      <ul className="space-y-0.5">
        {rows.map((p, i) => (
          <li
            key={`${p.parameter_id || "h"}-${i}`}
            className={
              p.is_subheader
                ? "px-2 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
                : "px-2 py-0.5 text-xs text-foreground"
            }
          >
            {p.parameter_name}
          </li>
        ))}
      </ul>
    );
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setExpandedTestId(null);
          setError(null);
        }
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-7 w-7 shrink-0"
          title={`View included ${isContainer ? "tests" : "parameters"}`}
          onClick={(e) => e.stopPropagation()}
        >
          <ListTree className="h-3.5 w-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-80 p-0"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b px-3 py-2">
          <p className="text-xs font-semibold leading-tight">{item.test_name}</p>
          <p className="text-[10px] text-muted-foreground">{contentsKindLabel(kind)} contents</p>
        </div>
        <div className="max-h-72 overflow-y-auto py-1.5">
          {loading && (
            <div className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
            </div>
          )}
          {!loading && error && (
            <p className="px-3 py-2 text-xs text-destructive">{error}</p>
          )}
          {!loading && !error && !isContainer && directParams && renderParamList(directParams)}
          {!loading && !error && isContainer && leafTests && leafTests.length === 0 && (
            <p className="px-3 py-2 text-xs text-muted-foreground">No tests linked</p>
          )}
          {!loading && !error && isContainer && leafTests && leafTests.length > 0 && (
            <ul className="space-y-0.5">
              {leafTests.map((t) => {
                const openRow = expandedTestId === t.test_id;
                const params = paramsByTest[t.test_id];
                const loadingRow = loadingParamsFor === t.test_id;
                return (
                  <li key={t.test_id} className="border-b border-border/40 last:border-0">
                    <button
                      type="button"
                      className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left text-xs font-medium hover:bg-muted/60"
                      onClick={() => void toggleTestParams(t.test_id)}
                    >
                      {openRow ? (
                        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      )}
                      <span className="min-w-0 flex-1 truncate">{t.test_name}</span>
                      {loadingRow && <Loader2 className="h-3 w-3 shrink-0 animate-spin text-muted-foreground" />}
                    </button>
                    {openRow && params && (
                      <div className="bg-muted/30 pb-1.5 pl-4">{renderParamList(params)}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}