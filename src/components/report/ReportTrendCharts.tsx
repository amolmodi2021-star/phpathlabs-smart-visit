import { Component, type ReactNode } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, ReferenceLine, Customized, ResponsiveContainer } from "recharts";
import type { TrendSeries } from "@/lib/reportHistoricalTrends";

interface ReportTrendChartsProps {
  trends: TrendSeries[];
  /** When true, render for A4 PDF capture (fixed sizes, no tooltip). */
  forPdf?: boolean;
}

type AbnormalFlag = "H" | "L" | null;

/** Prefer approved-snapshot flag; else compare against snapshot low/high. */
const getFlag = (
  value: number,
  low?: number,
  high?: number,
  snapshotFlag?: string,
): AbnormalFlag => {
  const f = String(snapshotFlag ?? "").trim().toUpperCase();
  if (f === "H" || f === "HIGH") return "H";
  if (f === "L" || f === "LOW") return "L";
  if (f === "N" || f === "X") return null;
  if (low != null && value < low) return "L";
  if (high != null && value > high) return "H";
  return null;
};

const formatValue = (value: number) =>
  Number(value).toFixed(Number.isInteger(value) ? 0 : 2);

/** Decimals for axis labels from domain span (fine when the window is small). */
function axisDecimals(span: number): number {
  const s = Math.abs(span);
  if (s >= 10) return 0;
  if (s >= 1) return 1;
  if (s >= 0.1) return 2;
  if (s >= 0.01) return 3;
  return 4;
}

function formatAxisTick(value: number, decimals = 2): string {
  if (!Number.isFinite(value)) return "";
  return Number(value.toFixed(decimals)).toString();
}

/**
 * Same interval count as before (3 evenly spaced ticks) — only the labels are
 * rounded. Does not invent extra nice-step intervals.
 */
function buildLabeledYTicks(yMin: number, yMax: number, count = 3): number[] {
  if (!Number.isFinite(yMin) || !Number.isFinite(yMax)) return [0];
  const lo = Math.min(yMin, yMax);
  const hi = Math.max(yMin, yMax);
  const span = Math.max(hi - lo, Number.EPSILON);
  const decimals = axisDecimals(span);
  const n = Math.max(2, count);
  const ticks: number[] = [];
  for (let i = 0; i < n; i += 1) {
    const raw = lo + (span * i) / (n - 1);
    ticks.push(Number(raw.toFixed(decimals)));
  }
  // If rounding collapsed neighbors, fall back to unique sorted values
  const uniq = Array.from(new Set(ticks));
  if (uniq.length >= 2) return uniq;
  return [Number(lo.toFixed(decimals)), Number(hi.toFixed(decimals))];
}

/**
 * Zoom Y around data + normal band so the green ref area gets most of the plot.
 * Do NOT force [0, max] for high ranges (Calcium 8.6–10.3, Hb 12–15) — that
 * crushes the band. Only anchor at 0 when the clinical range itself starts at 0
 * or is an upper-limit-only range (< N).
 */
function buildYDomain(
  values: number[],
  low?: number,
  high?: number,
): { yMin: number; yMax: number } {
  const nums = values.filter((v) => Number.isFinite(v));
  if (low != null && Number.isFinite(low)) nums.push(low);
  if (high != null && Number.isFinite(high)) nums.push(high);
  if (!nums.length) return { yMin: 0, yMax: 1 };

  const minVal = Math.min(...nums);
  const maxVal = Math.max(...nums);
  if (!Number.isFinite(minVal) || !Number.isFinite(maxVal)) return { yMin: 0, yMax: 1 };

  const span = Math.max(maxVal - minVal, Math.abs(maxVal) * 0.08, 0.2);
  const pad = span * 0.35;

  // Upper-limit only (Triglycerides < 150): green from 0 → keep zero baseline
  if ((low == null || !Number.isFinite(low)) && high != null && Number.isFinite(high)) {
    const yMax = Math.max(maxVal, high) + pad;
    return { yMin: 0, yMax: Number.isFinite(yMax) && yMax > 0 ? yMax : 1 };
  }

  // Lower-limit only (HDL > 60): zoom just below the floor
  if (low != null && Number.isFinite(low) && (high == null || !Number.isFinite(high))) {
    const yMin = low <= pad ? 0 : Math.max(0, Math.min(minVal, low) - pad);
    const yMax = Math.max(maxVal, low) + pad;
    if (!Number.isFinite(yMin) || !Number.isFinite(yMax) || !(yMax > yMin)) {
      return { yMin: Math.max(0, low - pad), yMax: low + pad };
    }
    return { yMin, yMax };
  }

  // Two-sided normal band — zoom tightly so green stays large
  let yMin = Math.min(minVal, low ?? minVal) - pad * 0.45;
  let yMax = Math.max(maxVal, high ?? maxVal) + pad * 0.45;

  if (low != null && high != null && high > low) {
    const band = high - low;
    const domain = Math.max(yMax - yMin, Number.EPSILON);
    const TARGET = 0.5; // aim for green ≥ half the plot height
    if (band / domain < TARGET) {
      const need = band / TARGET;
      const extra = (need - domain) / 2;
      yMin -= extra;
      yMax += extra;
    }
  }

  // Never draw negative axis for non-negative labs — but do not expand down to 0
  if (minVal >= 0 && (low == null || low >= 0)) {
    yMin = Math.max(0, yMin);
  }

  // Ref literally starts at 0 (Bilirubin 0–1.2)
  if (low === 0) yMin = 0;

  if (!Number.isFinite(yMin) || !Number.isFinite(yMax) || !(yMax > yMin)) {
    yMin = Math.max(0, minVal - pad);
    yMax = maxVal + pad;
  }
  if (!(yMax > yMin)) yMax = yMin + Math.max(span, 1);
  return { yMin, yMax };
}

/** One-line caption under each point (full advisory stays under the title). */
const shortRangeCaption = (text?: string, maxLen = 36): string => {
  const raw = String(text || "").replace(/\r\n/g, "\n").trim();
  if (!raw) return "—";
  const first = raw.split(/\n/)[0].trim();
  if (first.length <= maxLen) return first;
  return `${first.slice(0, maxLen - 1)}…`;
};

const CustomDot = (props: any) => {
  const { cx, cy, payload, low, high } = props;
  if (cx == null || cy == null) return null;
  const flag = getFlag(
    payload.value,
    payload.low ?? low,
    payload.high ?? high,
    payload.flag,
  );
  const normal = !flag;
  return (
    <circle
      cx={cx}
      cy={cy}
      r={4.5}
      fill={normal ? "#16a34a" : "#dc2626"}
      stroke="#fff"
      strokeWidth={1.5}
    />
  );
};

/**
 * Prefer label above the point; if that would collide with a green ref line
 * (value below the line but close enough that the label sits on it), put the
 * label below the point / dashed line instead.
 */
const shouldPlaceValueBelowRefLine = (
  value: number,
  low: number | undefined,
  high: number | undefined,
  yMin: number,
  yMax: number,
): boolean => {
  const span = Math.max(yMax - yMin, Math.abs(value) * 0.2, 1);
  // ~label height + gap as a fraction of the y-domain
  const clearance = span * 0.3;
  if (high != null && Number.isFinite(high) && value <= high && high - value <= clearance) {
    return true;
  }
  if (low != null && Number.isFinite(low) && value < low && low - value <= clearance) {
    // Point below low line — label above would cross the low dashed line
    return true;
  }
  return false;
};

const ValueLabel = (props: any) => {
  const { x, y, value, low, high, yMin, yMax, payload } = props;
  if (x == null || y == null || value == null) return null;
  const num = Number(value);
  const flag = getFlag(
    num,
    payload?.low ?? low,
    payload?.high ?? high,
    payload?.flag,
  );
  const text = formatValue(num);
  const placeBelow = shouldPlaceValueBelowRefLine(num, low, high, Number(yMin), Number(yMax));
  // SVG y grows downward: below the point = larger y
  const textY = placeBelow ? y + 14 : y - 9;
  const fill = flag ? "#dc2626" : "#166534";

  if (!flag) {
    return (
      <text x={x} y={textY} textAnchor="middle" fontSize={8} fill={fill} fontWeight={600}>
        {text}
      </text>
    );
  }
  return (
    <text x={x} y={textY} textAnchor="middle" fontSize={8} fontWeight={700}>
      <tspan fill="#dc2626">{text}</tspan>
      <tspan fill="#dc2626" dx={2} fontSize={7} fontWeight={800}>
        {flag}
      </tspan>
    </text>
  );
};

/**
 * Normal-range band spanning the full plot width (left→right graph edges).
 * Uses chart offset — unlike ReferenceArea, which only covers category points.
 */
const FullWidthNormalBand = (props: {
  y1?: number;
  y2?: number;
  offset?: { left?: number; width?: number };
  yAxisMap?: Record<string, { scale?: (v: number) => number }>;
}) => {
  const { y1, y2, offset, yAxisMap } = props;
  if (y1 == null || y2 == null || !Number.isFinite(y1) || !Number.isFinite(y2)) return null;
  const yAxis = yAxisMap ? (Object.values(yAxisMap)[0] as { scale?: (v: number) => number } | undefined) : undefined;
  const scale = yAxis?.scale;
  if (!scale || typeof scale !== "function") return null;
  const left = offset?.left ?? 0;
  const width = offset?.width ?? 0;
  if (!(width > 0)) return null;
  const py1 = scale(y1);
  const py2 = scale(y2);
  if (!Number.isFinite(py1) || !Number.isFinite(py2)) return null;
  const top = Math.min(py1, py2);
  const height = Math.abs(py2 - py1);
  if (!(height > 0)) return null;
  return (
    <rect
      className="hist-fill trend-ref-fill"
      data-print-strip-fill="trend"
      x={left}
      y={top}
      width={width}
      height={height}
      fill="#16a34a"
      fillOpacity={0.08}
      stroke="none"
      pointerEvents="none"
    />
  );
};

function ChartCard({ trend, forPdf }: { trend: TrendSeries; forPdf?: boolean }) {
  const sortedData = Array.isArray(trend?.data)
    ? trend.data.filter((d) => d != null && Number.isFinite(Number(d.value)))
    : [];
  if (!sortedData.length) return null;

  const values = sortedData.map((d) => Number(d.value));
  // Prefer series bounds; fall back to per-point snapshot bounds
  const boundLow =
    (trend.low != null && Number.isFinite(trend.low) ? trend.low : undefined)
    ?? sortedData.map((d) => d.low).find((v) => v != null && Number.isFinite(v));
  const boundHigh =
    (trend.high != null && Number.isFinite(trend.high) ? trend.high : undefined)
    ?? sortedData.map((d) => d.high).find((v) => v != null && Number.isFinite(v));
  const { yMin, yMax } = buildYDomain(values, boundLow, boundHigh);
  const yDecimals = axisDecimals(yMax - yMin);
  const yTicks = buildLabeledYTicks(yMin, yMax, 3);
  // Slightly shorter plot so multi-line Ref + 6 cards can fit; AutoScale shrinks further if needed.
  const chartH = forPdf ? 96 : 140;
  const refText = (trend.rangeLabel || "").trim() || "—";
  const areaLow = boundLow ?? trend.low;
  const areaHigh = boundHigh ?? trend.high;

  return (
    <div
      className="border border-slate-200 rounded-md p-2 bg-white flex flex-col min-w-0"
      style={{ breakInside: "avoid" }}
      data-trend-param={trend.parameter_id}
    >
      <div className="mb-1 min-w-0">
        <h3
          className="text-[11px] font-bold text-slate-800 leading-snug"
          style={{ wordBreak: "break-word", overflowWrap: "anywhere" }}
        >
          {trend.parameter_name}
          {trend.unit ? <span className="ml-1 font-normal text-slate-500">({trend.unit})</span> : null}
        </h3>
        <div
          className="text-[8px] text-green-700 font-medium leading-snug mt-0.5"
          style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", overflowWrap: "anywhere" }}
        >
          Ref: {refText}
        </div>
      </div>

      <div style={{ width: "100%", height: chartH }} className="shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={sortedData} margin={{ left: 0, right: 28, top: 14, bottom: 4 }}>
            {/* Grey grid only at labeled Y ticks — no unlabeled extras / no verticals */}
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="#cbd5e1"
              vertical={false}
              horizontalValues={yTicks}
            />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 8, fill: "#64748b" }}
              tickLine={false}
              axisLine={{ stroke: "#cbd5e1" }}
              padding={{ left: 14, right: 22 }}
              interval={0}
              minTickGap={2}
            />
            <YAxis
              tick={{ fontSize: 8, fill: "#64748b" }}
              width={36}
              tickLine={false}
              axisLine={{ stroke: "#cbd5e1" }}
              domain={[yMin, yMax]}
              ticks={yTicks}
              tickFormatter={(val: number) => formatAxisTick(val, yDecimals)}
              interval={0}
            />
            {areaLow != null && Number.isFinite(areaLow) && areaHigh != null && Number.isFinite(areaHigh) ? (
              <Customized
                component={(p: any) => (
                  <FullWidthNormalBand {...p} y1={areaLow} y2={areaHigh} />
                )}
              />
            ) : areaHigh != null && Number.isFinite(areaHigh) ? (
              <Customized
                component={(p: any) => (
                  <FullWidthNormalBand {...p} y1={yMin} y2={areaHigh} />
                )}
              />
            ) : areaLow != null && Number.isFinite(areaLow) ? (
              <Customized
                component={(p: any) => (
                  <FullWidthNormalBand {...p} y1={areaLow} y2={yMax} />
                )}
              />
            ) : null}
            {areaHigh != null && Number.isFinite(areaHigh) && (
              <ReferenceLine
                y={areaHigh}
                stroke="#16a34a"
                strokeDasharray="5 3"
                strokeWidth={1.75}
                ifOverflow="extendDomain"
              />
            )}
            {areaLow != null && Number.isFinite(areaLow) && (
              <ReferenceLine
                y={areaLow}
                stroke="#16a34a"
                strokeDasharray="5 3"
                strokeWidth={1.75}
                ifOverflow="extendDomain"
              />
            )}
            <Line
              type="monotone"
              dataKey="value"
              stroke="#1d4ed8"
              strokeWidth={2}
              isAnimationActive={false}
              dot={<CustomDot low={areaLow} high={areaHigh} />}
              label={<ValueLabel low={areaLow} high={areaHigh} yMin={yMin} yMax={yMax} />}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div
        className="mt-1 grid gap-0.5"
        style={{ gridTemplateColumns: `repeat(${Math.max(sortedData.length, 1)}, minmax(0, 1fr))` }}
      >
        {sortedData.map((point, idx) => {
          const flag = getFlag(
            point.value,
            point.low ?? trend.low,
            point.high ?? trend.high,
            point.flag,
          );
          const abnormal = !!flag;
          return (
            <div key={`${point.date}-${idx}`} className="text-center min-w-0 px-0.5">
              <div className="text-[8px] text-slate-500 leading-tight truncate">{point.date}</div>
              <div
                className={`text-[10px] font-semibold leading-tight ${
                  abnormal ? "text-red-600" : "text-green-700"
                }`}
              >
                {formatValue(point.value)}
                {flag ? (
                  <span className="ml-0.5 text-[9px] font-bold text-red-600">{flag}</span>
                ) : null}
              </div>
              <div className="text-[7px] text-green-700/80 leading-tight truncate">
                {shortRangeCaption(point.rangeLabel || trend.rangeLabel)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Historical Trends block for report PDF / screen.
 * Caller chunks to ≤6 charts per page and may wrap in AutoScaleContent.
 */
class TrendChartsErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  render() {
    if (this.state.hasError) return null;
    return this.props.children;
  }
}

const ReportTrendCharts = ({ trends, forPdf = true }: ReportTrendChartsProps) => {
  if (!trends.length) return null;

  return (
    <TrendChartsErrorBoundary>
      <div className="w-full" data-historical-trends>
        <h2
          className="text-[13px] font-bold tracking-wide text-slate-800 mb-1.5 pb-1"
          style={{ borderBottom: "1.5px solid #1e3a5f" }}
        >
          HISTORICAL TRENDS
        </h2>
        <div className="grid grid-cols-2 gap-2">
          {trends.map((trend) => (
            <TrendChartsErrorBoundary key={trend.parameter_id}>
              <ChartCard trend={trend} forPdf={forPdf} />
            </TrendChartsErrorBoundary>
          ))}
        </div>
      </div>
    </TrendChartsErrorBoundary>
  );
};

export default ReportTrendCharts;
