import { LineChart, Line, XAxis, YAxis, CartesianGrid, ReferenceLine, ReferenceArea, ResponsiveContainer } from "recharts";
import type { TrendSeries } from "@/lib/reportHistoricalTrends";

interface ReportTrendChartsProps {
  trends: TrendSeries[];
  /** When true, render for A4 PDF capture (fixed sizes, no tooltip). */
  forPdf?: boolean;
}

type AbnormalFlag = "H" | "L" | null;

const getFlag = (value: number, low?: number, high?: number): AbnormalFlag => {
  if (low != null && value < low) return "L";
  if (high != null && value > high) return "H";
  return null;
};

const formatValue = (value: number) =>
  Number(value).toFixed(Number.isInteger(value) ? 0 : 2);

/** Domain from 0 with natural padding (no forced round tick steps). */
function buildYDomain(values: number[], low?: number, high?: number): { yMin: number; yMax: number } {
  const nums = [...values, low, high].filter(
    (v): v is number => v != null && Number.isFinite(v),
  );
  const dataMax = Math.max(0, ...(nums.length ? nums : [1]));
  const span = Math.max(dataMax, Number.EPSILON);
  const padding = span * 0.15 || 1;
  return { yMin: 0, yMax: dataMax + padding };
}

const formatAxisTick = (value: number) => {
  if (!Number.isFinite(value)) return "";
  if (Math.abs(value) >= 100) return String(Math.round(value));
  if (Math.abs(value - Math.round(value)) < 1e-6) return String(Math.round(value));
  return Number(value.toFixed(2)).toString();
};

/** Keep Y labels vertically centered on their grid lines. */
const AlignedYTick = (props: any) => {
  const { x, y, payload } = props;
  if (x == null || y == null || payload?.value == null) return null;
  return (
    <text
      x={x - 4}
      y={y}
      textAnchor="end"
      dominantBaseline="central"
      fontSize={8}
      fill="#64748b"
    >
      {formatAxisTick(Number(payload.value))}
    </text>
  );
};

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
  const flag = getFlag(payload.value, low ?? payload.low, high ?? payload.high);
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
 * Place value label where it won't sit on a green ref dashed line.
 */
const pickLabelSide = (
  value: number,
  low: number | undefined,
  high: number | undefined,
  yMin: number,
  yMax: number,
): "above" | "below" => {
  const span = Math.max(yMax - yMin, Math.abs(value) * 0.2, 1);
  const clearance = span * 0.12;
  const nearHigh = high != null && Number.isFinite(high) && Math.abs(value - high) <= clearance;
  const nearLow = low != null && Number.isFinite(low) && Math.abs(value - low) <= clearance;
  if (nearHigh && high != null && value <= high && !(nearLow && low != null && value >= low)) {
    return "below";
  }
  if (nearLow) return "above";
  if (low != null && value < low && low - value <= clearance) return "below";
  if (
    high != null
    && value < high
    && high - value <= span * 0.22
    && (low == null || value - low > span * 0.1)
  ) {
    return "below";
  }
  return "above";
};

const ValueLabel = (props: any) => {
  const { x, y, value, low, high, yMin, yMax } = props;
  if (x == null || y == null || value == null) return null;
  const num = Number(value);
  const flag = getFlag(num, low, high);
  const text = formatValue(num);
  const side = pickLabelSide(num, low, high, Number(yMin), Number(yMax));
  const textY = side === "below" ? y + 14 : y - 9;
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
          <LineChart data={sortedData} margin={{ left: 2, right: 8, top: 14, bottom: 2 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" horizontal vertical={false} />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 8, fill: "#64748b" }}
              tickLine={false}
              axisLine={{ stroke: "#cbd5e1" }}
              padding={{ left: 10, right: 10 }}
              interval={0}
            />
            <YAxis
              width={40}
              tickLine={false}
              axisLine={{ stroke: "#cbd5e1" }}
              domain={[yMin, yMax]}
              tickCount={5}
              allowDecimals
              tick={(props: any) => <AlignedYTick {...props} />}
            />
            {trend.low != null && trend.high != null ? (
              <ReferenceArea
                y1={Math.max(0, trend.low)}
                y2={trend.high}
                fill="#16a34a"
                fillOpacity={0.1}
                strokeOpacity={0}
              />
            ) : trend.high != null ? (
              <ReferenceArea
                y1={0}
                y2={trend.high}
                fill="#16a34a"
                fillOpacity={0.1}
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
            {trend.low != null && trend.low > 0 && (
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
          const flag = getFlag(point.value, point.low ?? trend.low, point.high ?? trend.high);
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
