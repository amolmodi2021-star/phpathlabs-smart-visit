import { format, parseISO, isValid } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { pickBestNormalRange, type NormalRangeRow } from "@/lib/parameterNormalRange";

export const TRENDS_PER_PAGE = 6;
export const TREND_MAX_POINTS = 5;

export type TrendPoint = {
  date: string;
  value: number;
  /** Snapshot normal_range_low from approved_reports.test_results */
  low?: number;
  /** Snapshot normal_range_high from approved_reports.test_results */
  high?: number;
  /** Snapshot flag (H/L/N) from approved_reports.test_results — preferred for highlighting */
  flag?: string;
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
  flag?: string | null;
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

/**
 * Resolve Ref label + optional Settings override bounds for historical trends.
 * Highlighting low/high must come from approved snapshot numerics — never parse
 * advisory Ref text (e.g. HDL "No Risk: > 60") into bounds.
 */
export function resolveTrendDisplayRange(meta: {
  trend_display_low?: number | null;
  trend_display_high?: number | null;
  trend_display_label?: string | null;
  normal_range_low?: number | null;
  normal_range_high?: number | null;
  normal_range_text?: string | null;
  reference_range?: string | null;
  /** Full text from parameter_normal_ranges (preferred over short snapshot captions) */
  parameter_range_text?: string | null;
  unit?: string | null;
}): { low?: number; high?: number; rangeLabel: string } {
  const hasTrendOverride =
    toFiniteNumber(meta.trend_display_low) != null
    || toFiniteNumber(meta.trend_display_high) != null
    || !!(meta.trend_display_label || "").trim();

  const refText = pickFullestRangeText(
    meta.parameter_range_text,
    meta.normal_range_text,
    meta.reference_range,
  );

  if (hasTrendOverride) {
    const low = toFiniteNumber(meta.trend_display_low);
    const high = toFiniteNumber(meta.trend_display_high);
    const label = (meta.trend_display_label || "").trim()
      || refText
      || formatShortRange(low, high, meta.unit)
      || "—";
    return { low, high, rangeLabel: label };
  }

  // Numeric bounds only — no text parsing
  const low = toFiniteNumber(meta.normal_range_low);
  const high = toFiniteNumber(meta.normal_range_high);
  const label =
    refText
    || formatShortRange(low, high, meta.unit)
    || "—";

  return { low, high, rangeLabel: label };
}

function normalizeSnapshotFlag(raw?: string | null): string | undefined {
  const f = String(raw ?? "").trim().toUpperCase();
  if (!f) return undefined;
  if (f === "HIGH") return "H";
  if (f === "LOW") return "L";
  if (f === "H" || f === "L" || f === "N" || f === "X") return f;
  return f;
}

/** Prefer multi-line / longer parameter advisory text over a short single-line caption. */
function pickFullestRangeText(...candidates: Array<string | null | undefined>): string {
  const texts = candidates
    .map((t) => String(t ?? "").replace(/\r\n/g, "\n").replace(/^\uFEFF/, "").trim())
    .filter((t) => t.length > 0);
  if (!texts.length) return "";
  texts.sort((a, b) => {
    const aLines = a.split("\n").filter((l) => l.trim()).length;
    const bLines = b.split("\n").filter((l) => l.trim()).length;
    if (bLines !== aLines) return bLines - aLines;
    return b.length - a.length;
  });
  return texts[0];
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
    // Only currently enabled analytics params — turning the flag off hides the chart
    // even if an older freeze still contains that series.
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
      /** When true, low/high come only from the snapshot (null high stays open). */
      useSnapshotBounds?: boolean;
    },
  ) => {
    const meta = metaById.get(parameterId)!;
    const fb = genderFallback.get(parameterId);
    const snapLow = toFiniteNumber(snapshotRange?.normal_range_low);
    const snapHigh = toFiniteNumber(snapshotRange?.normal_range_high);
    const useSnap = !!snapshotRange?.useSnapshotBounds;
    return resolveTrendDisplayRange({
      trend_display_low: meta.trend_display_low,
      trend_display_high: meta.trend_display_high,
      trend_display_label: meta.trend_display_label,
      // Approved snapshot numerics are authoritative for H/L — do not fill null high from Parameters.
      normal_range_low: useSnap
        ? (snapLow ?? null)
        : (snapLow ?? toFiniteNumber(meta.normal_range_low) ?? fb?.low ?? null),
      normal_range_high: useSnap
        ? (snapHigh ?? null)
        : (snapHigh ?? toFiniteNumber(meta.normal_range_high) ?? fb?.high ?? null),
      normal_range_text: meta.normal_range_text,
      parameter_range_text: fb?.text || meta.normal_range_text || null,
      reference_range: snapshotRange?.reference_range || null,
      unit: (snapshotRange?.unit && String(snapshotRange.unit).trim()) || meta.unit,
    });
  };

  const applyResolvedRange = (series: TrendSeries): TrendSeries => {
    // Refresh Ref label only — keep frozen snapshot low/high/flag for highlighting.
    const labelRange = resolveForParam(series.parameter_id);
    return {
      ...series,
      rangeLabel: labelRange.rangeLabel || series.rangeLabel,
      unit: series.unit || metaById.get(series.parameter_id)?.unit || undefined,
      data: series.data.map((d) => ({
        ...d,
        rangeLabel: labelRange.rangeLabel || d.rangeLabel,
      })),
    };
  };

  const frozen = asTrendSeriesArray(opts.frozenTrends);
  const frozenUsable =
    !!frozen
    && !opts.isProvisional
    && frozen.some(seriesHasUsableRange);

  // Always build live series from approved snapshots so newly flagged analytics
  // params (or params missing from an older freeze) still appear.
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
      flag?: string | null;
    },
  ) => {
    if (!analyticsIds.has(parameterId)) return;
    const meta = metaById.get(parameterId);
    if (!meta) return;
    const value = parseNumeric(resultValue);
    if (value == null) return;
    // Label may use fullest Ref text / Settings; H/L bounds always from approved snapshot.
    const labelRange = resolveForParam(parameterId, {
      ...snapshotRange,
      useSnapshotBounds: true,
    });
    const sortKey = Date.parse(String(whenIso || "")) || 0;
    const point: RawPoint = {
      date: formatTrendDate(whenIso),
      value,
      low: toFiniteNumber(snapshotRange?.normal_range_low),
      high: toFiniteNumber(snapshotRange?.normal_range_high),
      flag: normalizeSnapshotFlag(snapshotRange?.flag),
      rangeLabel: labelRange.rangeLabel,
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
        flag: tr.flag,
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
        flag: (tr as SnapshotResultRow).flag,
      });
    }
  }

  const liveSeries: TrendSeries[] = [];
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
    // Green band / dashed lines: Settings override if set, else latest snapshot bounds.
    const displayRange = resolveForParam(pid, {
      normal_range_low: last.low,
      normal_range_high: last.high,
      reference_range: last.rangeLabel,
      unit: meta.unit,
      useSnapshotBounds: true,
    });
    liveSeries.push({
      parameter_id: pid,
      parameter_name: meta.parameter_name,
      param_code: meta.param_code,
      unit: meta.unit || undefined,
      low: displayRange.low ?? last.low,
      high: displayRange.high ?? last.high,
      rangeLabel: displayRange.rangeLabel || last.rangeLabel,
      data: ordered,
    });
  }

  if (frozen && frozenUsable) {
    const frozenById = new Map(
      frozen
        .filter((s) => reportParamIds.includes(s.parameter_id) && analyticsIds.has(s.parameter_id))
        .map((s) => [s.parameter_id, applyResolvedRange(s)]),
    );
    const liveById = new Map(liveSeries.map((s) => [s.parameter_id, s]));
    const merged: TrendSeries[] = [];
    const seen = new Set<string>();
    // Follow reportParamIds order (dept → test → param), not freeze insertion order
    for (const pid of reportParamIds) {
      if (!analyticsIds.has(pid) || seen.has(pid)) continue;
      const s = frozenById.get(pid) || liveById.get(pid);
      if (!s) continue;
      merged.push(s);
      seen.add(pid);
    }
    return {
      trends: merged,
      // False when we added live-only series so caller can merge them into the freeze
      fromFrozen: merged.length > 0 && merged.every((s) => frozenById.has(s.parameter_id)),
    };
  }

  return { trends: liveSeries, fromFrozen: false };
}

/** Persist frozen trends onto approved_reports (create, merge, reorder, or prune). */
export async function freezeApprovedReportHistoricalTrends(
  registrationId: string,
  trends: TrendSeries[],
): Promise<void> {
  if (!registrationId) return;
  const { data: row, error: readErr } = await (supabase as any)
    .from("approved_reports")
    .select("id, historical_trends")
    .eq("registration_id", registrationId)
    .maybeSingle();
  if (readErr) throw new Error(readErr.message);
  if (!row?.id) return;

  const existing = asTrendSeriesArray(row.historical_trends);

  // Current `trends` is already filtered to store_for_analytics=true only.
  // Empty array means prune/clear any previously frozen series (flag turned off).
  if (!trends.length) {
    if (!existing?.length) return;
    const { error } = await (supabase as any)
      .from("approved_reports")
      .update({ historical_trends: [] })
      .eq("id", row.id);
    if (error) throw new Error(error.message);
    return;
  }

  if (existing && existing.some(seriesHasUsableRange)) {
    const byId = new Map(existing.map((s) => [s.parameter_id, s]));
    // Keep frozen point data for still-enabled params; drop disabled; adopt hierarchy order
    const ordered = trends.map((t) => byId.get(t.parameter_id) || t);
    const sameLength = ordered.length === existing.length;
    const sameOrder =
      sameLength
      && ordered.every((s, i) => s.parameter_id === existing[i]?.parameter_id);
    const sameIds =
      sameLength
      && ordered.every((s) => byId.has(s.parameter_id));
    if (sameOrder && sameIds) return;
    const { error } = await (supabase as any)
      .from("approved_reports")
      .update({ historical_trends: ordered })
      .eq("id", row.id);
    if (error) throw new Error(error.message);
    return;
  }

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

/**
 * Order parameter IDs like the report body: department → test → param display_order.
 * Used so Historical Trends charts follow the same hierarchy (not Set/freeze insertion order).
 */
export function orderParameterIdsByReportHierarchy(opts: {
  parameterIds: string[];
  results: Array<{ parameter_id?: string; test_id?: string }>;
  departments: Array<{ id: string; display_order?: number | null }>;
  testsMap: Record<string, { department_id?: string | null; report_display_order?: number | null; test_name?: string | null } | undefined>;
  testParamsMap: Record<string, Array<{ parameter_id?: string; display_order?: number | null }>>;
}): string[] {
  const want = new Set(opts.parameterIds.filter(Boolean));
  if (!want.size) return [];

  const deptOrder = new Map<string, number>();
  for (const d of opts.departments || []) {
    if (d?.id) deptOrder.set(d.id, d.display_order ?? 999);
  }

  type SortKey = {
    pid: string;
    departmentOrder: number;
    testOrder: number;
    paramOrder: number;
    testName: string;
  };
  const best = new Map<string, SortKey>();

  for (const tr of opts.results || []) {
    const pid = String(tr.parameter_id || "");
    if (!pid || !want.has(pid)) continue;
    const testId = String(tr.test_id || "");
    const testInfo = testId ? opts.testsMap[testId] : undefined;
    const deptId = testInfo?.department_id || null;
    const key: SortKey = {
      pid,
      departmentOrder: deptId ? (deptOrder.get(deptId) ?? 999) : 999,
      testOrder: testInfo?.report_display_order ?? 9999,
      paramOrder: 999,
      testName: String(testInfo?.test_name || ""),
    };
    const tpList = testId ? (opts.testParamsMap[testId] || []) : [];
    const tp = tpList.find((row) => String(row.parameter_id || "") === pid);
    if (tp && tp.display_order != null) key.paramOrder = Number(tp.display_order) || 0;

    const prev = best.get(pid);
    if (
      !prev
      || key.departmentOrder < prev.departmentOrder
      || (key.departmentOrder === prev.departmentOrder && key.testOrder < prev.testOrder)
      || (key.departmentOrder === prev.departmentOrder
        && key.testOrder === prev.testOrder
        && key.paramOrder < prev.paramOrder)
      || (key.departmentOrder === prev.departmentOrder
        && key.testOrder === prev.testOrder
        && key.paramOrder === prev.paramOrder
        && key.testName.localeCompare(prev.testName) < 0)
    ) {
      best.set(pid, key);
    }
  }

  // Params with no test_id match still appear, after hierarchy-sorted ones
  for (const pid of want) {
    if (!best.has(pid)) {
      best.set(pid, {
        pid,
        departmentOrder: 9999,
        testOrder: 9999,
        paramOrder: 9999,
        testName: "",
      });
    }
  }

  return [...best.values()]
    .sort((a, b) => {
      if (a.departmentOrder !== b.departmentOrder) return a.departmentOrder - b.departmentOrder;
      if (a.testOrder !== b.testOrder) return a.testOrder - b.testOrder;
      if (a.paramOrder !== b.paramOrder) return a.paramOrder - b.paramOrder;
      const byName = a.testName.localeCompare(b.testName);
      if (byName) return byName;
      return a.pid.localeCompare(b.pid);
    })
    .map((k) => k.pid);
}

/** Reorder trend series to match an ordered parameter-id list. */
export function sortTrendsByParameterOrder(
  trends: TrendSeries[],
  orderedParameterIds: string[],
): TrendSeries[] {
  if (!trends.length) return [];
  const byId = new Map(trends.map((t) => [t.parameter_id, t]));
  const out: TrendSeries[] = [];
  const seen = new Set<string>();
  for (const pid of orderedParameterIds) {
    const s = byId.get(pid);
    if (!s || seen.has(pid)) continue;
    out.push(s);
    seen.add(pid);
  }
  for (const s of trends) {
    if (seen.has(s.parameter_id)) continue;
    out.push(s);
    seen.add(s.parameter_id);
  }
  return out;
}
