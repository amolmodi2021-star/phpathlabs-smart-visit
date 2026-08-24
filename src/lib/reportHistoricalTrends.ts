import { format, parseISO, isValid } from "date-fns";
import { supabase } from "@/integrations/supabase/client";

export const TRENDS_PER_PAGE = 6;
export const TREND_MAX_POINTS = 5;

export type TrendPoint = {
  date: string;
  value: number;
  low?: number;
  high?: number;
  rangeLabel: string;
};

export type TrendSeries = {
  parameter_id: string;
  parameter_name: string;
  param_code: string | null;
  unit?: string;
  low?: number;
  high?: number;
  rangeLabel: string;
  data: TrendPoint[];
};

type TrendParamMeta = {
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
};

function parseNumeric(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const s = String(raw).trim().replace(/,/g, "");
  if (!s) return null;
  const m = s.match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

function formatShortRange(low?: number | null, high?: number | null, unit?: string | null): string {
  const u = unit ? ` ${unit}` : "";
  if (low != null && high != null) return `${low} - ${high}${u}`;
  if (low != null) return `≥ ${low}${u}`;
  if (high != null) return `≤ ${high}${u}`;
  return "—";
}

/** Resolve display bounds for historical trends (override → clinical numeric). */
export function resolveTrendDisplayRange(meta: {
  trend_display_low?: number | null;
  trend_display_high?: number | null;
  trend_display_label?: string | null;
  normal_range_low?: number | null;
  normal_range_high?: number | null;
  normal_range_text?: string | null;
  unit?: string | null;
}): { low?: number; high?: number; rangeLabel: string } {
  const low =
    meta.trend_display_low != null && Number.isFinite(Number(meta.trend_display_low))
      ? Number(meta.trend_display_low)
      : meta.normal_range_low != null && Number.isFinite(Number(meta.normal_range_low))
        ? Number(meta.normal_range_low)
        : undefined;
  const high =
    meta.trend_display_high != null && Number.isFinite(Number(meta.trend_display_high))
      ? Number(meta.trend_display_high)
      : meta.normal_range_high != null && Number.isFinite(Number(meta.normal_range_high))
        ? Number(meta.normal_range_high)
        : undefined;

  const label = (meta.trend_display_label || "").trim()
    || formatShortRange(low, high, meta.unit);

  return { low, high, rangeLabel: label || "—" };
}

function formatTrendDate(iso: string | null | undefined): string {
  if (!iso) return "";
  try {
    const d = typeof iso === "string" && iso.includes("T") ? parseISO(iso) : new Date(iso);
    if (!isValid(d)) return String(iso).slice(0, 10);
    return format(d, "dd-MMM-yy");
  } catch {
    return String(iso).slice(0, 10);
  }
}

/**
 * Build historical trend series for report PDF.
 * Only parameters with store_for_analytics that appear on this report (numeric).
 * Last TREND_MAX_POINTS visits per parameter (oldest→newest on chart).
 */
export async function buildReportHistoricalTrends(opts: {
  umrNumber: string | null | undefined;
  registrationId: string;
  /** parameter_ids present on the current report */
  reportParameterIds: string[];
}): Promise<TrendSeries[]> {
  const umr = String(opts.umrNumber || "").trim();
  const reportParamIds = Array.from(new Set(opts.reportParameterIds.filter(Boolean)));
  if (!umr || reportParamIds.length === 0) return [];

  const { data: analyticsParams, error: pErr } = await (supabase as any)
    .from("report_test_parameters")
    .select(
      "id, param_code, parameter_name, unit, normal_range_low, normal_range_high, normal_range_text, trend_display_low, trend_display_high, trend_display_label, store_for_analytics",
    )
    .eq("store_for_analytics", true)
    .in("id", reportParamIds);
  if (pErr) throw new Error(pErr.message);
  const metaList = (analyticsParams || []) as TrendParamMeta[];
  if (metaList.length === 0) return [];

  const analyticsIds = metaList.map((p) => p.id);
  const metaById = new Map(metaList.map((p) => [p.id, p]));

  const { data: regs, error: rErr } = await supabase
    .from("patient_registrations")
    .select("id, created_at")
    .eq("umr_number", umr)
    .order("created_at", { ascending: true });
  if (rErr) throw new Error(rErr.message);
  const regRows = regs || [];
  if (regRows.length === 0) return [];
  const regIds = regRows.map((r) => r.id);
  const regDateById = new Map(regRows.map((r) => [r.id, r.created_at as string]));

  const { data: results, error: resErr } = await supabase
    .from("patient_results")
    .select("parameter_id, result_value, registration_id, created_at, status")
    .in("registration_id", regIds)
    .in("parameter_id", analyticsIds)
    .not("result_value", "is", null)
    .in("status", ["entered", "pending", "results_entered", "verified", "approved", "dispatched"]);
  if (resErr) throw new Error(resErr.message);

  type RawPoint = TrendPoint & { sortKey: number; registrationId: string; resultAt: number };
  const byParam = new Map<string, RawPoint[]>();
  for (const row of results || []) {
    const pid = row.parameter_id as string;
    const meta = metaById.get(pid);
    if (!meta) continue;
    const value = parseNumeric(row.result_value as string);
    if (value == null) continue;
    const range = resolveTrendDisplayRange(meta);
    const regId = row.registration_id as string;
    const when = regDateById.get(regId) || (row.created_at as string);
    const sortKey = Date.parse(when) || 0;
    const resultAt = Date.parse(String(row.created_at || when)) || sortKey;
    const point: RawPoint = {
      date: formatTrendDate(when),
      value,
      low: range.low,
      high: range.high,
      rangeLabel: range.rangeLabel,
      sortKey,
      registrationId: regId,
      resultAt,
    };
    if (!byParam.has(pid)) byParam.set(pid, []);
    byParam.get(pid)!.push(point);
  }

  const series: TrendSeries[] = [];
  // Keep report parameter order
  for (const pid of reportParamIds) {
    const meta = metaById.get(pid);
    if (!meta) continue;
    const points = byParam.get(pid) || [];
    if (points.length === 0) continue;
    // One point per registration (keep latest result if duplicates)
    const byReg = new Map<string, RawPoint>();
    for (const p of points) {
      const prev = byReg.get(p.registrationId);
      if (!prev || p.resultAt >= prev.resultAt) byReg.set(p.registrationId, p);
    }
    const ordered = Array.from(byReg.values())
      .sort((a, b) => a.sortKey - b.sortKey || a.resultAt - b.resultAt)
      .slice(-TREND_MAX_POINTS)
      .map(({ sortKey: _s, registrationId: _r, resultAt: _t, ...rest }) => rest);
    if (ordered.length === 0) continue;
    const range = resolveTrendDisplayRange(meta);
    series.push({
      parameter_id: pid,
      parameter_name: meta.parameter_name,
      param_code: meta.param_code,
      unit: meta.unit || undefined,
      low: range.low,
      high: range.high,
      rangeLabel: range.rangeLabel,
      data: ordered,
    });
  }
  return series;
}

export function chunkTrendsForPages(trends: TrendSeries[], perPage = TRENDS_PER_PAGE): TrendSeries[][] {
  if (!trends.length) return [];
  const pages: TrendSeries[][] = [];
  for (let i = 0; i < trends.length; i += perPage) {
    pages.push(trends.slice(i, i + perPage));
  }
  return pages;
}