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

const CustomDot = (props: any) => {
  const { cx, cy, payload, low, high } = props;
  if (cx == null || cy == null) return null;
  const flag = getFlag(payload.value, low ?? payload.low, high ?? payload.high);
  const normal = !flag;
  return (
    <circle
      cx={cx}
      cy={cy}
      r={5}
      fill={normal ? "#16a34a" : "#dc2626"}
      stroke="#fff"
      strokeWidth={1.5}
    />
  );
};

const ValueLabel = (props: any) => {
  const { x, y, value, low, high } = props;
  if (x == null || y == null || value == null) return null;
  const flag = getFlag(Number(value), low, high);
  const text = formatValue(Number(value));
  if (!flag) {
    return (
      <text x={x} y={y - 10} textAnchor="middle" fontSize={9} fill="#166534" fontWeight={600}>
        {text}
      </text>
    );
  }
  return (
    <text x={x} y={y - 10} textAnchor="middle" fontSize={9} fontWeight={700}>
      <tspan fill="#dc2626">{text}</tspan>
      <tspan fill="#dc2626" dx={2} fontSize={8} fontWeight={800}>
        {flag}
      </tspan>
    </text>
  );
};

function ChartCard({ trend, forPdf }: { trend: TrendSeries; forPdf?: boolean }) {
  const sortedData = trend.data;
  const values = sortedData.map((d) => d.value);
  const allVals = [...values];
  if (trend.low != null) allVals.push(trend.low);
  if (trend.high != null) allVals.push(trend.high);
  const minVal = Math.min(...allVals);
  const maxVal = Math.max(...allVals);
  const range = maxVal - minVal;
  const padding = range > 0 ? range * 0.2 : Math.abs(maxVal) * 0.15 || 1;
  const yMin = Math.min(minVal - padding, trend.low != null ? trend.low - padding * 0.3 : minVal - padding);
  const yMax = Math.max(maxVal + padding, trend.high != null ? trend.high + padding * 0.3 : maxVal + padding);
  const chartH = forPdf ? 118 : 150;

  return (
    <div
      className="border border-slate-200 rounded-md p-2.5 bg-white"
      style={{ breakInside: "avoid" }}
      data-trend-param={trend.parameter_id}
    >
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <h3 className="text-[12px] font-bold text-slate-800 leading-tight truncate">
          {trend.parameter_name}
          {trend.unit ? <span className="ml-1 font-normal text-slate-500">({trend.unit})</span> : null}
        </h3>
        <span className="shrink-0 text-[9px] text-green-700 whitespace-nowrap font-medium">
          Ref: {trend.rangeLabel}
        </span>
      </div>

      <div style={{ width: "100%", height: chartH }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={sortedData} margin={{ left: 2, right: 10, top: 18, bottom: 2 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 9, fill: "#64748b" }}
              tickLine={false}
              axisLine={{ stroke: "#cbd5e1" }}
              padding={{ left: 12, right: 12 }}
              interval={0}
            />
            <YAxis
              tick={{ fontSize: 9, fill: "#64748b" }}
              width={42}
              tickLine={false}
              axisLine={{ stroke: "#cbd5e1" }}
              domain={[yMin, yMax]}
              tickFormatter={(val: number) => Number(val.toFixed(2)).toString()}
            />
            {trend.low != null && trend.high != null && (
              <ReferenceArea
                y1={trend.low}
                y2={trend.high}
                fill="#16a34a"
                fillOpacity={0.08}
                strokeOpacity={0}
              />
            )}
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
              label={<ValueLabel low={trend.low} high={trend.high} />}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div
        className="mt-1.5 grid gap-1"
        style={{ gridTemplateColumns: `repeat(${Math.max(sortedData.length, 1)}, minmax(0, 1fr))` }}
      >
        {sortedData.map((point, idx) => {
          const flag = getFlag(point.value, point.low ?? trend.low, point.high ?? trend.high);
          const abnormal = !!flag;
          return (
            <div key={`${point.date}-${idx}`} className="text-center min-w-0 px-0.5">
              <div className="text-[9px] text-slate-500 leading-tight truncate">{point.date}</div>
              <div
                className={`text-[11px] font-semibold leading-tight ${
                  abnormal ? "text-red-600" : "text-green-700"
                }`}
              >
                {formatValue(point.value)}
                {flag ? (
                  <span className="ml-0.5 text-[10px] font-bold text-red-600">{flag}</span>
                ) : null}
              </div>
              <div className="text-[8px] text-green-700/80 leading-tight truncate">
                {point.rangeLabel || trend.rangeLabel}
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
 * Caller chunks to ≤6 charts per page.
 */
const ReportTrendCharts = ({ trends, forPdf = true }: ReportTrendChartsProps) => {
  if (!trends.length) return null;

  return (
    <div className="w-full" data-historical-trends>
      <h2
        className="text-[14px] font-bold tracking-wide text-slate-800 mb-2 pb-1"
        style={{ borderBottom: "1.5px solid #1e3a5f" }}
      >
        HISTORICAL TRENDS
      </h2>
      <div className="grid grid-cols-2 gap-2.5">
        {trends.map((trend) => (
          <ChartCard key={trend.parameter_id} trend={trend} forPdf={forPdf} />
        ))}
      </div>
    </div>
  );
};

export default ReportTrendCharts;
