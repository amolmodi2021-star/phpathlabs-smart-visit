import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Edit2, Search } from "lucide-react";
import { resolveTrendDisplayRange } from "@/lib/reportHistoricalTrends";

type TrendParamRow = {
  id: string;
  param_code: string | null;
  parameter_name: string;
  unit: string | null;
  normal_range_low: number | null;
  normal_range_high: number | null;
  normal_range_text: string | null;
  trend_display_low: number | null;
  trend_display_high: number | null;
  trend_display_label: string | null;
  store_for_analytics: boolean | null;
};

function formatClinical(p: TrendParamRow): string {
  if (p.normal_range_low != null && p.normal_range_high != null) {
    return `${p.normal_range_low} - ${p.normal_range_high}${p.unit ? ` ${p.unit}` : ""}`;
  }
  const text = (p.normal_range_text || "").trim();
  if (text) return text.length > 48 ? `${text.slice(0, 48)}…` : text;
  return "—";
}

/**
 * Edit trend-only normal range display for parameters flagged Store for Analytics.
 * Does not change clinical parameter ranges used on reports / flags.
 */
const HistoricalTrendsSettings = () => {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<TrendParamRow | null>(null);
  const [low, setLow] = useState("");
  const [high, setHigh] = useState("");
  const [label, setLabel] = useState("");

  const { data: params = [], isLoading } = useQuery({
    queryKey: ["historical_trends_display_params"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("report_test_parameters")
        .select(
          "id, param_code, parameter_name, unit, normal_range_low, normal_range_high, normal_range_text, trend_display_low, trend_display_high, trend_display_label, store_for_analytics",
        )
        .eq("store_for_analytics", true)
        .eq("is_active", true)
        .order("parameter_name");
      if (error) throw error;
      return (data || []) as TrendParamRow[];
    },
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return params;
    return params.filter(
      (p) =>
        p.parameter_name.toLowerCase().includes(q)
        || (p.param_code || "").toLowerCase().includes(q),
    );
  }, [params, search]);

  const openEdit = (p: TrendParamRow) => {
    setEditing(p);
    setLow(p.trend_display_low != null ? String(p.trend_display_low) : "");
    setHigh(p.trend_display_high != null ? String(p.trend_display_high) : "");
    setLabel(p.trend_display_label || "");
  };

  const preview = useMemo(() => {
    if (!editing) return "";
    const lowN = low.trim() === "" ? null : Number(low);
    const highN = high.trim() === "" ? null : Number(high);
    return resolveTrendDisplayRange({
      trend_display_low: lowN != null && Number.isFinite(lowN) ? lowN : null,
      trend_display_high: highN != null && Number.isFinite(highN) ? highN : null,
      trend_display_label: label,
      normal_range_low: editing.normal_range_low,
      normal_range_high: editing.normal_range_high,
      normal_range_text: editing.normal_range_text,
      unit: editing.unit,
    }).rangeLabel;
  }, [editing, low, high, label]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!editing) return;
      const lowN = low.trim() === "" ? null : Number(low);
      const highN = high.trim() === "" ? null : Number(high);
      if (low.trim() !== "" && (lowN == null || !Number.isFinite(lowN))) {
        throw new Error("Trend low must be a number (or blank)");
      }
      if (high.trim() !== "" && (highN == null || !Number.isFinite(highN))) {
        throw new Error("Trend high must be a number (or blank)");
      }
      const { error } = await (supabase as any)
        .from("report_test_parameters")
        .update({
          trend_display_low: lowN,
          trend_display_high: highN,
          trend_display_label: label.trim() || null,
        })
        .eq("id", editing.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["historical_trends_display_params"] });
      toast.success("Historical Trends display range saved (clinical range unchanged)");
      setEditing(null);
    },
    onError: (e: any) => toast.error(e.message || "Save failed"),
  });

  const clearMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any)
        .from("report_test_parameters")
        .update({
          trend_display_low: null,
          trend_display_high: null,
          trend_display_label: null,
        })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["historical_trends_display_params"] });
      toast.success("Cleared trend display override");
      setEditing(null);
    },
    onError: (e: any) => toast.error(e.message || "Clear failed"),
  });

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold">Historical Trends — Normal Range Display</h3>
        <p className="text-sm text-muted-foreground mt-1 max-w-3xl">
          Optional overrides for Historical Trends graphs only. If nothing is set here,
          the graph uses the parameter’s normal / reference range by default.
          Clinical ranges on the report table are never changed.
          Only parameters with <span className="font-medium">Store for Analytics</span> are listed.
        </p>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Search parameter or code…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No analytics parameters found. Enable “Store for Analytics” on a parameter first.
        </p>
      ) : (
        <div className="rounded-md border overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Parameter</TableHead>
                <TableHead>Clinical range (unchanged)</TableHead>
                <TableHead>Trend display range</TableHead>
                <TableHead className="w-[80px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((p) => {
                const trend = resolveTrendDisplayRange(p);
                const hasOverride =
                  p.trend_display_low != null
                  || p.trend_display_high != null
                  || !!(p.trend_display_label || "").trim();
                return (
                  <TableRow key={p.id}>
                    <TableCell className="font-mono text-xs">{p.param_code || "—"}</TableCell>
                    <TableCell>
                      <div className="font-medium">{p.parameter_name}</div>
                      {p.unit ? <div className="text-xs text-muted-foreground">{p.unit}</div> : null}
                    </TableCell>
                    <TableCell className="text-xs max-w-[220px] truncate" title={formatClinical(p)}>
                      {formatClinical(p)}
                    </TableCell>
                    <TableCell className="text-sm">
                      {trend.rangeLabel}
                      {hasOverride ? (
                        <span className="ml-2 text-[10px] uppercase tracking-wide text-primary">override</span>
                      ) : (
                        <span className="ml-2 text-[10px] uppercase tracking-wide text-muted-foreground">default</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Button size="sm" variant="ghost" onClick={() => openEdit(p)} aria-label="Edit">
                        <Edit2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Trend display range</DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="space-y-3">
              <p className="text-sm">
                <span className="font-medium">{editing.parameter_name}</span>
                {editing.param_code ? (
                  <span className="ml-2 font-mono text-xs text-muted-foreground">{editing.param_code}</span>
                ) : null}
              </p>
              <p className="text-xs text-muted-foreground">
                Clinical range stays: {formatClinical(editing)}
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="trend-low">Trend low</Label>
                  <Input
                    id="trend-low"
                    inputMode="decimal"
                    placeholder="e.g. 0"
                    value={low}
                    onChange={(e) => setLow(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="trend-high">Trend high</Label>
                  <Input
                    id="trend-high"
                    inputMode="decimal"
                    placeholder="e.g. 5.6"
                    value={high}
                    onChange={(e) => setHigh(e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="trend-label">Short label (optional)</Label>
                <Input
                  id="trend-label"
                  placeholder="e.g. 0 - 5.6 %"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                />
                <p className="text-[11px] text-muted-foreground">
                  Shown under each graph point. Leave all fields blank to use the normal / reference range.
                </p>
              </div>
              <div className="rounded-md bg-muted/50 px-3 py-2 text-sm">
                Preview on graph: <span className="font-medium">{preview || "—"}</span>
              </div>
            </div>
          )}
          <DialogFooter className="gap-2 sm:gap-0">
            {editing && (
              <Button
                type="button"
                variant="outline"
                className="mr-auto"
                disabled={clearMutation.isPending}
                onClick={() => clearMutation.mutate(editing.id)}
              >
                Clear override
              </Button>
            )}
            <Button type="button" variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button type="button" disabled={saveMutation.isPending} onClick={() => saveMutation.mutate()}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default HistoricalTrendsSettings;
