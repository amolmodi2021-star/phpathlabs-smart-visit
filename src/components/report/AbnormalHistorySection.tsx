import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Activity, ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  sortAbnormalTestsByDateDesc,
  getAbnormalTestDateSortValue,
} from "@/lib/abnormalTests";

interface Props {
  /** grouped: { TEST_NAME_UPPER: rows[] } */
  grouped: Record<string, any[]>;
}

const formatDateCell = (value?: string | null) => {
  if (!value) return "—";
  const trimmed = String(value).trim();
  // Already day-first?
  if (/^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}$/.test(trimmed)) return trimmed;
  const t = Date.parse(trimmed);
  if (isNaN(t)) return trimmed;
  const d = new Date(t);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}-${mm}-${d.getFullYear()}`;
};

const AbnormalHistorySection = ({ grouped }: Props) => {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const orderedKeys = useMemo(() => {
    return Object.keys(grouped).sort((a, b) => {
      // Sort groups by most-recent test_date desc, then by name
      const arrA = grouped[a];
      const arrB = grouped[b];
      const maxA = Math.max(
        ...arrA.map((r) => getAbnormalTestDateSortValue(r.test_date)),
        Number.NEGATIVE_INFINITY,
      );
      const maxB = Math.max(
        ...arrB.map((r) => getAbnormalTestDateSortValue(r.test_date)),
        Number.NEGATIVE_INFINITY,
      );
      if (maxA !== maxB) return maxB - maxA;
      return a.localeCompare(b);
    });
  }, [grouped]);

  if (orderedKeys.length === 0) return null;

  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 mb-3">
        <Activity className="h-4 w-4 text-rose-600" />
        <h3 className="font-semibold text-sm">Abnormal History</h3>
        <Badge variant="secondary" className="text-[10px]">
          {orderedKeys.length} test{orderedKeys.length === 1 ? "" : "s"}
        </Badge>
      </div>
      <p className="text-[11px] text-muted-foreground mb-3">
        All abnormal results found across your visits. Tap a test to expand.
      </p>
      <div className="divide-y">
        {orderedKeys.map((key) => {
          const rows = sortAbnormalTestsByDateDesc(grouped[key]);
          const isOpen = !!expanded[key];
          const display = rows[0]?.test_name || key;
          return (
            <div key={key} className="py-2">
              <button
                type="button"
                onClick={() => setExpanded((p) => ({ ...p, [key]: !p[key] }))}
                className="w-full flex items-center justify-between gap-2 text-left hover:bg-muted/40 px-2 py-1.5 rounded"
              >
                <div className="flex items-center gap-2 min-w-0">
                  {isOpen ? (
                    <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  )}
                  <span className="font-medium text-sm truncate">{display}</span>
                </div>
                <Badge variant="outline" className="text-[10px] shrink-0">
                  {rows.length} result{rows.length === 1 ? "" : "s"}
                </Badge>
              </button>
              {isOpen && (
                <div className="mt-2 ml-5 overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-muted-foreground">
                        <th className="py-1 pr-3 font-medium">Date</th>
                        <th className="py-1 pr-3 font-medium">Result</th>
                        <th className="py-1 font-medium">Reference range</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r, i) => (
                        <tr
                          key={i}
                          className={cn(
                            "border-t border-border/60",
                            i === 0 && "bg-amber-50/60 dark:bg-amber-950/20",
                          )}
                        >
                          <td className="py-1.5 pr-3 whitespace-nowrap">
                            {formatDateCell(r.test_date)}
                          </td>
                          <td className="py-1.5 pr-3 font-medium text-rose-700 dark:text-rose-400">
                            {r.result_value || "—"}
                          </td>
                          <td className="py-1.5 text-muted-foreground">
                            {r.normal_range || "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
};

export default AbnormalHistorySection;
