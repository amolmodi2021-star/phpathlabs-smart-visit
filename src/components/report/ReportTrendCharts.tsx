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

/** Nice step in 1/2/5 × 10^n (works for 0.01, 0.02, 0.05, 0.1, 1, 2, …). */
function niceNum(range: number, round: boolean): number {
  const r = Math.max(Math.abs(range), Number.EPSILON);
  const exp = Math.floor(Math.log10(r));
  const frac = r / 10 ** exp;
  let nice: number;
  if (round) {
    if (frac < 1.5) nice = 1;
    else if (frac < 3) nice = 2;
    else if (frac < 7) nice = 5;
    else nice = 10;
  } else if (frac <= 1) nice = 1;
  else if (frac <= 2) nice = 2;
  else if (frac <= 5) nice = 5;
  else nice = 10;
  return nice * 10 ** exp;
}

function tickDecimals(step: number): number {
  if (!Number.isFinite(step) || step <= 0) return 2;
  if (step >= 1) return Number.isInteger(step) ? 0 : 2;
  // e.g. step 0.01 → 2, 0.015-ish → enough digits; 0.001 → 3
  return Math.min(6, Math.max(0, Math.ceil(-Math.log10(step))));
}

function formatAxisTick(value: number, step?: number): string {
  if (!Number.isFinite(value)) return "";
  const decimals = step != null ? tickDecimals(step) : 2;
  return Number(value.toFixed(decimals)).toString();
}

/**
 * Rounded Y ticks (and lightly snapped domain) inside the zoomed window.
 * Small spans get fine steps (0.01 / 0.02 / 0.05 / 0.1 …).
 */
function buildRoundedYAxis(
  yMin: number,
  yMax: number,
  targetTickCount = 5,
): { yMin: number; yMax: number; ticks: number[]; step: number } {
  if (!Number.isFinite(yMin) || !Number.isFinite(yMax)) {
    return { yMin: 0, yMax: 1, ticks: [0, 1], step: 1 };
  }
  const lo0 = Math.min(yMin, yMax);
  const hi0 = Math.max(yMin, yMax);
  const span0 = Math.max(hi0 - lo0, Number.EPSILON);
  const step = niceNum(span0 / Math.max(targetTickCount - 1, 1), true);
  const decimals = tickDecimals(step);

  let niceMin = Math.floor(lo0 / step - 1e-12) * step;
  let niceMax = Math.ceil(hi0 / step + 1e-12) * step;
  if (lo0 >= 0) niceMin = Math.max(0, niceMin);
  if (!(niceMax > niceMin)) niceMax = niceMin + step;

  const ticks: number[] = [];
  const maxIter = 40;
  for (let i = 0; i <= maxIter; i += 1) {
    const v = Number((niceMin + i * step).toFixed(decimals));
    if (v > niceMax + step * 1e-9) break;
    ticks.push(v);
  }
  if (ticks.length < 2) {
    ticks.length = 0;
    ticks.push(Number(lo0.toFixed(decimals)), Number(hi0.toFixed(decimals)));
  }

  return {
    yMin: ticks[0],
    yMax: ticks[ticks.length - 1],
    ticks,
    step,
  };
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
  const nums = [...values];
  if (low != null && Number.isFinite(low)) nums.push(low);
  if (high != null && Number.isFinite(high)) nums.push(high);
  const minVal = Math.min(...(nums.length ? nums : [0]));
  const maxVal = Math.max(...(nums.length ? nums : [1]));
  const span = Math.max(maxVal - minVal, Math.abs(maxVal) * 0.08, 0.2);
  const pad = span * 0.35;

  // Upper-limit only (Triglycerides < 150): green from 0 → keep zero baseline
  if ((low == null || !Number.isFinite(low)) && high != null && Number.isFinite(high)) {
    return { yMin: 0, yMax: Math.max(maxVal, high) + pad };
  }

  // Lower-limit only (HDL > 60): zoom just below the floor
  if (low != null && Number.isFinite(low) && (high == null || !Number.isFinite(high))) {
    const yMin = low <= pad ? 0 : Math.max(0, Math.min(minVal, low) - pad);
    const yMax = Math.max(maxVal, low) + pad;
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

function ChartCard({ trend, forPdf }: { trend: TrendSeries; forPdf?: boolean }) {
  const sortedData = trend.data;
  const values = sortedData.map((d) => d.value);
  // Prefer series bounds; fall back to per-point snapshot bounds
  const boundLow =
    trend.low
    ?? sortedData.map((d) => d.low).find((v) => v != null && Number.isFinite(v));
  const boundHigh =
    trend.high
    ?? sortedData.map((d) => d.high).find((v) => v != null && Number.isFinite(v));
  const { yMin: rawMin, yMax: rawMax } = buildYDomain(values, boundLow, boundHigh);
  const { yMin, yMax, ticks: yTicks, step: yStep } = buildRoundedYAxis(rawMin, rawMax, 5);
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
              tickFormatter={(val: number) => formatAxisTick(val, yStep)}
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
