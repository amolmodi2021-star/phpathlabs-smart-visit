import { LineChart, Line, XAxis, YAxis, CartesianGrid, ReferenceLine, ReferenceArea, ResponsiveContainer } from "recharts";
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

const formatAxisTick = (value: number) => {
  if (!Number.isFinite(value)) return "";
  return Number(value.toFixed(2)).toString();
};

/** Evenly spaced Y ticks so every grey grid line has a matching label. */
function buildLabeledYTicks(yMin: number, yMax: number, count = 3): number[] {
  if (!Number.isFinite(yMin) || !Number.isFinite(yMax)) return [0];
  if (Math.abs(yMax - yMin) < Number.EPSILON) return [yMin];
  const n = Math.max(2, count);
  const ticks: number[] = [];
  for (let i = 0; i < n; i += 1) {
    ticks.push(yMin + ((yMax - yMin) * i) / (n - 1));
  }
  return ticks;
}

/**
 * Prefer yMin=0 when the normal (green) band still fills enough of the chart
 * (e.g. Bilirubin 0–1.2, TSH 0.3–4.5). If starting at 0 would crush a high
 * narrow band (e.g. Hb 12–15), zoom around data + ref like the unbound scale.
 */
function buildYDomain(
  values: number[],
  low?: number,
  high?: number,
): { yMin: number; yMax: number } {
  const allVals = [...values];
  if (low != null) allVals.push(low);
  if (high != null) allVals.push(high);
  const minVal = Math.min(...(allVals.length ? allVals : [0]));
  const maxVal = Math.max(...(allVals.length ? allVals : [1]));
  const span = Math.max(maxVal - minVal, Number.EPSILON);
  const padding = span * 0.2 || Math.abs(maxVal) * 0.15 || 1;

  let zoomMin = Math.min(
    minVal - padding,
    low != null ? low - padding * 0.3 : minVal - padding,
  );
  const zoomMax = Math.max(
    maxVal + padding,
    high != null ? high + padding * 0.3 : maxVal + padding,
  );
  if (minVal >= 0 && (low == null || low >= 0)) {
    zoomMin = Math.max(0, zoomMin);
  }

  const zeroMax = Math.max(zoomMax, Number.EPSILON);

  // How tall is the green band if the axis is [0, zeroMax]?
  let greenOnZero = 0;
  if (low != null && high != null) {
    greenOnZero = Math.max(0, Math.min(high, zeroMax) - Math.max(low, 0));
  } else if (high != null) {
    greenOnZero = Math.max(0, Math.min(high, zeroMax));
  } else if (low != null) {
    greenOnZero = Math.max(0, zeroMax - Math.max(low, 0));
  } else {
    // No ref band — zero baseline is fine
    return { yMin: 0, yMax: zeroMax };
  }

  const greenFraction = greenOnZero / zeroMax;
  // Keep ~1/3+ of the plot for the normal band when starting at 0
  const MIN_GREEN_FRACTION = 0.3;
  const lowNearZero = low != null && low <= zeroMax * 0.12;

  if (greenFraction >= MIN_GREEN_FRACTION || lowNearZero || (low == null && high != null)) {
    return { yMin: 0, yMax: zeroMax };
  }

  // High narrow bands (Hb 12–15): zoom so green gets maximum space
  return { yMin: zoomMin, yMax: zoomMax };
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

function ChartCard({ trend, forPdf }: { trend: TrendSeries; forPdf?: boolean }) {
  const sortedData = trend.data;
  const values = sortedData.map((d) => d.value);
  const { yMin, yMax } = buildYDomain(values, trend.low, trend.high);
  const yTicks = buildLabeledYTicks(yMin, yMax, 3);
  // Slightly shorter plot so multi-line Ref + 6 cards can fit; AutoScale shrinks further if needed.
  const chartH = forPdf ? 96 : 140;
  const refText = (trend.rangeLabel || "").trim() || "—";

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
          <LineChart data={sortedData} margin={{ left: 0, right: 8, top: 14, bottom: 0 }}>
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
              padding={{ left: 10, right: 10 }}
              interval={0}
            />
            <YAxis
              tick={{ fontSize: 8, fill: "#64748b" }}
              width={36}
              tickLine={false}
              axisLine={{ stroke: "#cbd5e1" }}
              domain={[yMin, yMax]}
              ticks={yTicks}
              tickFormatter={formatAxisTick}
              interval={0}
            />
            {trend.low != null && trend.high != null ? (
              <ReferenceArea
                y1={trend.low}
                y2={trend.high}
                fill="#16a34a"
                fillOpacity={0.08}
                strokeOpacity={0}
              />
            ) : trend.high != null ? (
              <ReferenceArea
                y1={yMin}
                y2={trend.high}
                fill="#16a34a"
                fillOpacity={0.08}
                strokeOpacity={0}
              />
            ) : trend.low != null ? (
              <ReferenceArea
                y1={trend.low}
                y2={yMax}
                fill="#16a34a"
                fillOpacity={0.08}
                strokeOpacity={0}
              />
            ) : null}
            {trend.high != null && (
              <ReferenceLine
                y={trend.high}
                stroke="#16a34a"
                strokeDasharray="5 3"
                strokeWidth={1.75}
                ifOverflow="extendDomain"
              />
            )}
            {trend.low != null && (
              <ReferenceLine
                y={trend.low}
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
              dot={<CustomDot low={trend.low} high={trend.high} />}
              label={<ValueLabel low={trend.low} high={trend.high} yMin={yMin} yMax={yMax} />}
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
const ReportTrendCharts = ({ trends, forPdf = true }: ReportTrendChartsProps) => {
  if (!trends.length) return null;

  return (
    <div className="w-full" data-historical-trends>
      <h2
        className="text-[13px] font-bold tracking-wide text-slate-800 mb-1.5 pb-1"
        style={{ borderBottom: "1.5px solid #1e3a5f" }}
      >
        HISTORICAL TRENDS
      </h2>
      <div className="grid grid-cols-2 gap-2">
        {trends.map((trend) => (
          <ChartCard key={trend.parameter_id} trend={trend} forPdf={forPdf} />
        ))}
      </div>
    </div>
  );
};

export default ReportTrendCharts;
