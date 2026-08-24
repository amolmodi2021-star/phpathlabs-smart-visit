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

type SnapshotResultRow = {
  parameter_id?: string;
  param_code?: string;
  parameter_name?: string;
  result_value?: string | null;
  unit?: string | null;
  normal_range_low?: number | null;
  normal_range_high?: number | null;
  reference_range?: string | null;
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
  return "";
}

/** Shorten long advisory / multi-line reference text for trend captions. */
function shortenReferenceLabel(text: string | null | undefined, maxLen = 42): string {
  const raw = String(text || "").replace(/\r\n/g, "\n").trim();
  if (!raw) return "";
  const firstLine = raw.split(/\n/)[0].trim();
  // Prefer a numeric span if present in the first line (e.g. HbA1c advisory)
  const span = firstLine.match(/(-?\d+(?:\.\d+)?)\s*[-–—to]+\s*(-?\d+(?:\.\d+)?)/i);
  if (span) {
    const unitMatch = firstLine.match(/%|mg\/dL|g\/dL|mmol|IU|U\/L|ng\/mL|pg\/mL|µIU|uIU/i);
    const unit = unitMatch ? ` ${unitMatch[0]}` : "";
    return `${span[1]} - ${span[2]}${unit}`;
  }
  if (firstLine.length <= maxLen) return firstLine;
  return `${firstLine.slice(0, maxLen - 1)}…`;
}

function parseBoundsFromRangeText(rangeText?: string | null): { low?: number; high?: number } {
  if (!rangeText) return {};
  const text = String(rangeText).replace(/,/g, " ");
  const pair = text.match(/(-?\d+(?:\.\d+)?)\s*[-–—to]+\s*(-?\d+(?:\.\d+)?)/i);
  if (pair) {
    const a = Number(pair[1]);
    const b = Number(pair[2]);
    if (Number.isFinite(a) && Number.isFinite(b)) {
      return { low: Math.min(a, b), high: Math.max(a, b) };
    }
  }
  const upper = Array.from(text.matchAll(/(?:<=|≤|<|less\s*than|up\s*to|upto)\s*(-?\d*\.?\d+)/gi))
    .map((m) => Number.parseFloat(m[1]))
    .filter((n) => Number.isFinite(n));
  const lower = Array.from(text.matchAll(/(?:>=|≥|>|greater\s*than|more\s*than)\s*(-?\d*\.?\d+)/gi))
    .map((m) => Number.parseFloat(m[1]))
    .filter((n) => Number.isFinite(n));
  const low = lower.length ? Math.max(...lower) : undefined;
  const high = upper.length ? Math.min(...upper) : undefined;
  return { low, high };
}

/**
 * Resolve display bounds for historical trends.
 * Settings override (trend_display_*) wins; otherwise use the parameter reference /
 * normal range (numeric → text → parsed bounds).
 */
export function resolveTrendDisplayRange(meta: {
  trend_display_low?: number | null;
  trend_display_high?: number | null;
  trend_display_label?: string | null;
  normal_range_low?: number | null;
  normal_range_high?: number | null;
  normal_range_text?: string | null;
  /** Snapshot / report reference range when param-level range is empty */
  reference_range?: string | null;
  unit?: string | null;
}): { low?: number; high?: number; rangeLabel: string } {
  const hasTrendOverride =
    (meta.trend_display_low != null && Number.isFinite(Number(meta.trend_display_low)))
    || (meta.trend_display_high != null && Number.isFinite(Number(meta.trend_display_high)))
    || !!(meta.trend_display_label || "").trim();

  if (hasTrendOverride) {
    const low =
      meta.trend_display_low != null && Number.isFinite(Number(meta.trend_display_low))
        ? Number(meta.trend_display_low)
        : undefined;
    const high =
      meta.trend_display_high != null && Number.isFinite(Number(meta.trend_display_high))
        ? Number(meta.trend_display_high)
        : undefined;
    const label = (meta.trend_display_label || "").trim()
      || formatShortRange(low, high, meta.unit)
      || "—";
    return { low, high, rangeLabel: label };
  }

  // Default: parameter / report reference range (clinical — not modified by Settings)
  let low =
    meta.normal_range_low != null && Number.isFinite(Number(meta.normal_range_low))
      ? Number(meta.normal_range_low)
      : undefined;
  let high =
    meta.normal_range_high != null && Number.isFinite(Number(meta.normal_range_high))
      ? Number(meta.normal_range_high)
      : undefined;

  const refText =
    (meta.normal_range_text || "").trim()
    || (meta.reference_range || "").trim()
    || "";

  if (low == null && high == null && refText) {
    const parsed = parseBoundsFromRangeText(refText);
    low = parsed.low;
    high = parsed.high;
  }

  const label =
    formatShortRange(low, high, meta.unit)
    || shortenReferenceLabel(refText)
    || "—";

  return { low, high, rangeLabel: label };
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

function asTrendSeriesArray(raw: unknown): TrendSeries[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: TrendSeries[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const s = item as TrendSeries;
    if (!s.parameter_id || !Array.isArray(s.data) || s.data.length === 0) continue;
    out.push(s);
  }
  return out.length ? out : null;
}

function snapshotSortKey(row: {
  approval_date?: string | null;
  sample_collection_date?: string | null;
  registration_date?: string | null;
  created_at?: string | null;
}): number {
  const iso =
    row.sample_collection_date
    || row.approval_date
    || row.registration_date
    || row.created_at
    || "";
  return Date.parse(String(iso)) || 0;
}

/**
 * Build historical trend series for report PDF from approved_reports snapshots only
 * (not live patient_results), so values match printed approved reports.
 *
 * For final reports: prefer frozen `historical_trends` on the current approved row;
 * if missing, build from snapshots up to this visit and optionally persist (caller).
 * For provisional: past approved snapshots + current provisional results.
 */
export async function buildReportHistoricalTrends(opts: {
  umrNumber: string | null | undefined;
  registrationId: string;
  /** parameter_ids present on the current report */
  reportParameterIds: string[];
  isProvisional?: boolean;
  /** Frozen series from approved_reports.historical_trends (if any) */
  frozenTrends?: unknown;
  /**
   * Cutoff: only include approved snapshots at or before this visit
   * (approval_date / sample_collection / registration_date).
   */
  asOfIso?: string | null;
  /**
   * Current visit results (from approved snapshot or provisional synthesis).
   * Used when this visit must contribute a point.
   */
  currentVisitResults?: SnapshotResultRow[];
  currentVisitDateIso?: string | null;
}): Promise<{ trends: TrendSeries[]; fromFrozen: boolean }> {
  const umr = String(opts.umrNumber || "").trim();
  const reportParamIds = Array.from(new Set(opts.reportParameterIds.filter(Boolean)));
  if (!umr || reportParamIds.length === 0) return { trends: [], fromFrozen: false };

  const { data: analyticsParams, error: pErr } = await (supabase as any)
    .from("report_test_parameters")
    .select(
      "id, param_code, parameter_name, unit, normal_range_low, normal_range_high, normal_range_text, trend_display_low, trend_display_high, trend_display_label, store_for_analytics",
    )
    .eq("store_for_analytics", true)
    .in("id", reportParamIds);
  if (pErr) throw new Error(pErr.message);
  const metaList = (analyticsParams || []) as TrendParamMeta[];
  if (metaList.length === 0) return { trends: [], fromFrozen: false };

  const analyticsIds = new Set(metaList.map((p) => p.id));
  const metaById = new Map(metaList.map((p) => [p.id, p]));

  const applyDisplayRange = (series: TrendSeries): TrendSeries => {
    const meta = metaById.get(series.parameter_id);
    if (!meta) return series;
    const range = resolveTrendDisplayRange(meta);
    return {
      ...series,
      low: range.low,
      high: range.high,
      rangeLabel: range.rangeLabel,
      data: series.data.map((d) => ({
        ...d,
        low: range.low,
        high: range.high,
        rangeLabel: range.rangeLabel,
      })),
    };
  };

  const frozen = asTrendSeriesArray(opts.frozenTrends);
  if (frozen && !opts.isProvisional) {
    // Keep frozen values/dates; refresh Ref lines/labels from Settings or default reference range
    return {
      trends: frozen
        .filter((s) => reportParamIds.includes(s.parameter_id))
        .map(applyDisplayRange),
      fromFrozen: true,
    };
  }

  const { data: approvedRows, error: aErr } = await (supabase as any)
    .from("approved_reports")
    .select(
      "id, registration_id, approval_date, sample_collection_date, registration_date, created_at, test_results",
    )
    .eq("umr_number", umr);
  if (aErr) throw new Error(aErr.message);

  const asOfMs = opts.asOfIso ? (Date.parse(String(opts.asOfIso)) || Number.POSITIVE_INFINITY) : Number.POSITIVE_INFINITY;

  type RawPoint = TrendPoint & { sortKey: number; registrationId: string };
  const byParam = new Map<string, RawPoint[]>();

  const pushPoint = (
    registrationId: string,
    parameterId: string,
    resultValue: string | null | undefined,
    whenIso: string | null | undefined,
    snapshotRange?: {
      reference_range?: string | null;
      normal_range_low?: number | null;
      normal_range_high?: number | null;
      unit?: string | null;
    },
  ) => {
    if (!analyticsIds.has(parameterId)) return;
    const meta = metaById.get(parameterId);
    if (!meta) return;
    const value = parseNumeric(resultValue);
    if (value == null) return;
    const range = resolveTrendDisplayRange({
      ...meta,
      // Prefer snapshot reference when settings override is empty
      normal_range_low: snapshotRange?.normal_range_low ?? meta.normal_range_low,
      normal_range_high: snapshotRange?.normal_range_high ?? meta.normal_range_high,
      reference_range: snapshotRange?.reference_range,
      unit: snapshotRange?.unit ?? meta.unit,
    });
    const sortKey = Date.parse(String(whenIso || "")) || 0;
    const point: RawPoint = {
      date: formatTrendDate(whenIso),
      value,
      low: range.low,
      high: range.high,
      rangeLabel: range.rangeLabel,
      sortKey,
      registrationId,
    };
    if (!byParam.has(parameterId)) byParam.set(parameterId, []);
    byParam.get(parameterId)!.push(point);
  };

  for (const ar of approvedRows || []) {
    const regId = String(ar.registration_id || "");
    if (!regId) continue;
    // Always include this visit's approved snapshot; for other visits enforce as-of cutoff
    // so later approvals cannot rewrite an older report's graphs.
    const sk = snapshotSortKey(ar);
    if (regId !== opts.registrationId && sk > asOfMs) continue;

    const rows = Array.isArray(ar.test_results) ? (ar.test_results as SnapshotResultRow[]) : [];
    const when =
      ar.sample_collection_date
      || ar.approval_date
      || ar.registration_date
      || ar.created_at;
    for (const tr of rows) {
      const pid = String(tr.parameter_id || "");
      if (!pid) continue;
      pushPoint(regId, pid, tr.result_value, when, {
        reference_range: tr.reference_range,
        normal_range_low: tr.normal_range_low,
        normal_range_high: tr.normal_range_high,
        unit: tr.unit,
      });
    }
  }

  // Provisional (or missing current snapshot): add current visit from provided results
  const currentRows = opts.currentVisitResults || [];
  if (currentRows.length > 0) {
    const when = opts.currentVisitDateIso || opts.asOfIso || new Date().toISOString();
    for (const tr of currentRows) {
      const pid = String(tr.parameter_id || "");
      if (!pid) continue;
      pushPoint(opts.registrationId, pid, tr.result_value, when, {
        reference_range: tr.reference_range,
        normal_range_low: tr.normal_range_low,
        normal_range_high: tr.normal_range_high,
        unit: tr.unit,
      });
    }
  }

  const series: TrendSeries[] = [];
  for (const pid of reportParamIds) {
    const meta = metaById.get(pid);
    if (!meta) continue;
    const points = byParam.get(pid) || [];
    if (points.length === 0) continue;
    const byReg = new Map<string, RawPoint>();
    for (const p of points) {
      const prev = byReg.get(p.registrationId);
      if (!prev || p.sortKey >= prev.sortKey) byReg.set(p.registrationId, p);
    }
    const ordered = Array.from(byReg.values())
      .sort((a, b) => a.sortKey - b.sortKey)
      .slice(-TREND_MAX_POINTS)
      .map(({ sortKey: _s, registrationId: _r, ...rest }) => rest);
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
  return { trends: series, fromFrozen: false };
}

/** Persist frozen trends onto approved_reports (no-op if already frozen or empty). */
export async function freezeApprovedReportHistoricalTrends(
  registrationId: string,
  trends: TrendSeries[],
): Promise<void> {
  if (!registrationId || !trends.length) return;
  const { data: row, error: readErr } = await (supabase as any)
    .from("approved_reports")
    .select("id, historical_trends")
    .eq("registration_id", registrationId)
    .maybeSingle();
  if (readErr) throw new Error(readErr.message);
  if (!row?.id) return;
  if (asTrendSeriesArray(row.historical_trends)) return; // already frozen
  const { error } = await (supabase as any)
    .from("approved_reports")
    .update({ historical_trends: trends })
    .eq("id", row.id)
    .is("historical_trends", null);
  if (error) throw new Error(error.message);
}

export function chunkTrendsForPages(trends: TrendSeries[], perPage = TRENDS_PER_PAGE): TrendSeries[][] {
  if (!trends.length) return [];
  const pages: TrendSeries[][] = [];
  for (let i = 0; i < trends.length; i += perPage) {
    pages.push(trends.slice(i, i + perPage));
  }
  return pages;
}
