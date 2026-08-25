import { format, parseISO, isValid } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { pickBestNormalRange, type NormalRangeRow } from "@/lib/parameterNormalRange";

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
  normal_range_low?: number | string | null;
  normal_range_high?: number | string | null;
  reference_range?: string | null;
};

function toFiniteNumber(raw: unknown): number | undefined {
  if (raw == null || raw === "") return undefined;
  const n = typeof raw === "number" ? raw : Number(String(raw).trim());
  return Number.isFinite(n) ? n : undefined;
}

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
  const u = unit && String(unit).trim() ? ` ${String(unit).trim()}` : "";
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
 * Settings override (trend_display_*) wins; otherwise use reference / normal range
 * from snapshot → param → age/gender table.
 */
export function resolveTrendDisplayRange(meta: {
  trend_display_low?: number | null;
  trend_display_high?: number | null;
  trend_display_label?: string | null;
  normal_range_low?: number | null;
  normal_range_high?: number | null;
  normal_range_text?: string | null;
  reference_range?: string | null;
  unit?: string | null;
}): { low?: number; high?: number; rangeLabel: string } {
  const hasTrendOverride =
    toFiniteNumber(meta.trend_display_low) != null
    || toFiniteNumber(meta.trend_display_high) != null
    || !!(meta.trend_display_label || "").trim();

  if (hasTrendOverride) {
    const low = toFiniteNumber(meta.trend_display_low);
    const high = toFiniteNumber(meta.trend_display_high);
    const label = (meta.trend_display_label || "").trim()
      || formatShortRange(low, high, meta.unit)
      || "—";
    return { low, high, rangeLabel: label };
  }

  let low = toFiniteNumber(meta.normal_range_low);
  let high = toFiniteNumber(meta.normal_range_high);

  const refText =
    (meta.reference_range || "").trim()
    || (meta.normal_range_text || "").trim()
    || "";

  if ((low == null || high == null) && refText) {
    const parsed = parseBoundsFromRangeText(refText);
    if (low == null) low = parsed.low;
    if (high == null) high = parsed.high;
  }

  // Keep full advisory / multi-line reference text (with line breaks) for graph headers.
  // Do not truncate — charts show Ref under the parameter name and can wrap.
  const label =
    String(refText || "").replace(/\r\n/g, "\n").trim()
    || formatShortRange(low, high, meta.unit)
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

function seriesHasUsableRange(s: TrendSeries): boolean {
  if (toFiniteNumber(s.low) != null || toFiniteNumber(s.high) != null) return true;
  if ((s.rangeLabel || "").trim() && s.rangeLabel !== "—") return true;
  return s.data.some(
    (d) =>
      toFiniteNumber(d.low) != null
      || toFiniteNumber(d.high) != null
      || ((d.rangeLabel || "").trim() && d.rangeLabel !== "—"),
  );
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
 */
export async function buildReportHistoricalTrends(opts: {
  umrNumber: string | null | undefined;
  registrationId: string;
  reportParameterIds: string[];
  isProvisional?: boolean;
  frozenTrends?: unknown;
  asOfIso?: string | null;
  currentVisitResults?: SnapshotResultRow[];
  currentVisitDateIso?: string | null;
  /** Patient gender for age/gender normal-range fallback */
  gender?: string | null;
  dob?: string | null;
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

  // Age/gender clinical ranges (most params store ranges here, not on the param row)
  const { data: rangeRows } = await (supabase as any)
    .from("parameter_normal_ranges")
    .select(
      "parameter_id, gender, age_min, age_max, range_type, normal_range_text, normal_range_low, normal_range_high",
    )
    .in("parameter_id", metaList.map((p) => p.id));

  const rangesByParam = new Map<string, NormalRangeRow[]>();
  for (const row of rangeRows || []) {
    const pid = String(row.parameter_id || "");
    if (!pid) continue;
    if (!rangesByParam.has(pid)) rangesByParam.set(pid, []);
    rangesByParam.get(pid)!.push(row as NormalRangeRow);
  }

  const genderFallback = new Map<string, { low?: number; high?: number; text: string }>();
  for (const meta of metaList) {
    const best = pickBestNormalRange(rangesByParam.get(meta.id) || [], {
      gender: opts.gender,
      dob: opts.dob,
    });
    if (!best) continue;
    genderFallback.set(meta.id, {
      low: toFiniteNumber(best.normal_range_low),
      high: toFiniteNumber(best.normal_range_high),
      text: String(best.normal_range_text || "").trim(),
    });
  }

  const resolveForParam = (
    parameterId: string,
    snapshotRange?: {
      reference_range?: string | null;
      normal_range_low?: number | string | null;
      normal_range_high?: number | string | null;
      unit?: string | null;
    },
  ) => {
    const meta = metaById.get(parameterId)!;
    const fb = genderFallback.get(parameterId);
    const snapLow = toFiniteNumber(snapshotRange?.normal_range_low);
    const snapHigh = toFiniteNumber(snapshotRange?.normal_range_high);
    return resolveTrendDisplayRange({
      trend_display_low: meta.trend_display_low,
      trend_display_high: meta.trend_display_high,
      trend_display_label: meta.trend_display_label,
      normal_range_low: snapLow ?? toFiniteNumber(meta.normal_range_low) ?? fb?.low ?? null,
      normal_range_high: snapHigh ?? toFiniteNumber(meta.normal_range_high) ?? fb?.high ?? null,
      normal_range_text: meta.normal_range_text,
      reference_range: snapshotRange?.reference_range || fb?.text || null,
      unit: (snapshotRange?.unit && String(snapshotRange.unit).trim()) || meta.unit,
    });
  };

  const applyResolvedRange = (series: TrendSeries): TrendSeries => {
    // Prefer current Settings / clinical fallback; keep frozen values/dates
    const range = resolveForParam(series.parameter_id, {
      reference_range:
        series.rangeLabel && series.rangeLabel !== "—"
          ? series.rangeLabel
          : series.data.find((d) => d.rangeLabel && d.rangeLabel !== "—")?.rangeLabel,
      normal_range_low: series.low ?? series.data.find((d) => d.low != null)?.low,
      normal_range_high: series.high ?? series.data.find((d) => d.high != null)?.high,
      unit: series.unit,
    });
    return {
      ...series,
      low: range.low,
      high: range.high,
      rangeLabel: range.rangeLabel,
      unit: series.unit || metaById.get(series.parameter_id)?.unit || undefined,
      data: series.data.map((d) => ({
        ...d,
        low: range.low,
        high: range.high,
        rangeLabel: range.rangeLabel,
      })),
    };
  };

  const frozen = asTrendSeriesArray(opts.frozenTrends);
  const frozenUsable =
    !!frozen
    && !opts.isProvisional
    && frozen.some(seriesHasUsableRange);

  if (frozen && frozenUsable) {
    return {
      trends: frozen
        .filter((s) => reportParamIds.includes(s.parameter_id))
        .map(applyResolvedRange),
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
      normal_range_low?: number | string | null;
      normal_range_high?: number | string | null;
      unit?: string | null;
    },
  ) => {
    if (!analyticsIds.has(parameterId)) return;
    const meta = metaById.get(parameterId);
    if (!meta) return;
    const value = parseNumeric(resultValue);
    if (value == null) return;
    const range = resolveForParam(parameterId, snapshotRange);
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
    const last = ordered[ordered.length - 1];
    series.push({
      parameter_id: pid,
      parameter_name: meta.parameter_name,
      param_code: meta.param_code,
      unit: meta.unit || undefined,
      low: last.low,
      high: last.high,
      rangeLabel: last.rangeLabel,
      data: ordered,
    });
  }
  return { trends: series, fromFrozen: false };
}

/** Persist frozen trends onto approved_reports (overwrite empty/broken freeze). */
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

  const existing = asTrendSeriesArray(row.historical_trends);
  if (existing && existing.some(seriesHasUsableRange)) return;

  const { error } = await (supabase as any)
    .from("approved_reports")
    .update({ historical_trends: trends })
    .eq("id", row.id);
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
