import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer, LabelList } from "recharts";
import { ArrowUp, ArrowDown } from "lucide-react";

interface TrendData {
  parameter_name: string;
  data: { date: string; value: number; low?: number; high?: number }[];
  low?: number;
  high?: number;
  unit?: string;
}

interface ReportTrendChartsProps {
  trends: TrendData[];
}

const isNormal = (value: number, low?: number, high?: number) => {
  if (low != null && value < low) return false;
  if (high != null && value > high) return false;
  return true;
};

const CustomDot = (props: any) => {
  const { cx, cy, payload, low, high } = props;
  if (cx == null || cy == null) return null;
  const normal = isNormal(payload.value, low, high);
  return (
    <circle cx={cx} cy={cy} r={4} fill={normal ? "#16a34a" : "#2563eb"} stroke={normal ? "#16a34a" : "#2563eb"} strokeWidth={1} />
  );
};

const ReportTrendCharts = ({ trends }: ReportTrendChartsProps) => {
  if (trends.length === 0) return null;

  return (
    <div>
      <h2 className="text-base font-bold text-blue-800 mb-3 border-b-2 border-blue-200 pb-1">Historical Trends</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 print:grid-cols-2 gap-4">
        {trends.slice(0, 6).map((trend) => {
          // Sort by date ascending, deduplicate (same date+value), limit to last 5
          const deduped = [...trend.data]
            .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
            .filter((item, idx, arr) => {
              if (idx === 0) return true;
              const prev = arr[idx - 1];
              return !(item.date === prev.date && item.value === prev.value);
            });
          const sortedData = deduped.slice(-5);

          const values = sortedData.map(d => d.value);
          const allVals = [...values];
          if (trend.low != null) allVals.push(trend.low);
          if (trend.high != null) allVals.push(trend.high);
          const minVal = Math.min(...allVals);
          const maxVal = Math.max(...allVals);
          const padding = (maxVal - minVal) * 0.15 || 1;

          const refRange = trend.low != null && trend.high != null
            ? `${trend.low} - ${trend.high}`
            : trend.low != null ? `≥ ${trend.low}`
            : trend.high != null ? `≤ ${trend.high}`
            : "—";

          return (
            <div key={trend.parameter_name} className="trend-chart-box border rounded-lg p-3 print:break-inside-avoid">
              <h3 className="text-sm font-semibold mb-1">{trend.parameter_name} {trend.unit && <span className="text-xs text-gray-500">({trend.unit})</span>}</h3>
              <ResponsiveContainer width="100%" height={150}>
                <LineChart data={sortedData} margin={{ left: -10, right: 10, top: 15, bottom: 5 }}>
                   <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                   <XAxis dataKey="date" tick={{ fontSize: 10 }} padding={{ left: 30, right: 10 }} />
                   <YAxis
                     tick={{ fontSize: 9 }}
                     width={40}
                     domain={[Math.floor((minVal - padding) * 100) / 100, Math.ceil((maxVal + padding) * 100) / 100]}
                     tickFormatter={(val: number) => Number(val.toFixed(2)).toString()}
                     padding={{ top: 10, bottom: 10 }}
                   />
                  <Tooltip />
                  <Line
                    type="monotone"
                    dataKey="value"
                    stroke="#2563eb"
                    strokeWidth={2}
                    dot={<CustomDot low={trend.low} high={trend.high} />}
                  >
                    <LabelList dataKey="value" position="top" fontSize={9} fill="#374151" offset={8} />
                  </Line>
                   {trend.high != null && <ReferenceLine y={trend.high} stroke="#ef4444" strokeDasharray="5 5" label={{ value: "High", fontSize: 9, fill: "#ef4444", position: "right" }} />}
                   {trend.low != null && <ReferenceLine y={trend.low} stroke="#f59e0b" strokeDasharray="5 5" label={{ value: "Low", fontSize: 9, fill: "#f59e0b", position: "right" }} />}
                </LineChart>
              </ResponsiveContainer>

              {/* Details below graph */}
              <div className="trend-chart-detail-row flex gap-2 mt-2 justify-between">
                {sortedData.map((point, idx) => {
                  const prev = idx > 0 ? sortedData[idx - 1].value : null;
                  const pointLow = point.low ?? trend.low;
                  const pointHigh = point.high ?? trend.high;
                  const normal = isNormal(point.value, pointLow, pointHigh);
                  const pointRange = pointLow != null && pointHigh != null
                    ? `${pointLow} - ${pointHigh}`
                    : pointLow != null ? `≥ ${pointLow}`
                    : pointHigh != null ? `≤ ${pointHigh}`
                    : "—";
                  return (
                    <div key={idx} className="trend-chart-detail-item flex flex-col items-center text-center min-w-[70px]">
                      <span className="text-[11px] leading-tight text-gray-500">{point.date}</span>
                      <span className={`text-xs leading-tight font-semibold flex items-center gap-0.5 ${normal ? "text-green-600" : "text-red-600"}`}>
                        {point.value}
                        {prev != null && (
                          point.value > prev
                            ? <ArrowUp className="w-3 h-3" />
                            : point.value < prev
                              ? <ArrowDown className="w-3 h-3" />
                              : null
                        )}
                      </span>
                      <span className="text-[10px] leading-tight text-gray-400">{pointRange}</span>
                    </div>
                  );
                })}
              </div>

              {/* Remark if normal ranges differ across data points */}
              {(() => {
                const ranges = sortedData.map(p => `${p.low ?? trend.low}-${p.high ?? trend.high}`);
                const allSame = ranges.every(r => r === ranges[0]);
                if (!allSame) {
                  return (
                    <p className="text-[10px] text-red-500 font-medium mt-1 text-center italic">
                      ⚠ Check normal range carefully.
                    </p>
                  );
                }
                return null;
              })()}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default ReportTrendCharts;
