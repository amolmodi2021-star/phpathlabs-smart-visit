import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer } from "recharts";

interface TrendData {
  parameter_name: string;
  data: { date: string; value: number }[];
  low?: number;
  high?: number;
  unit?: string;
}

interface ReportTrendChartsProps {
  trends: TrendData[];
}

const ReportTrendCharts = ({ trends }: ReportTrendChartsProps) => {
  if (trends.length === 0) return null;

  return (
    <div>
      <h2 className="text-base font-bold text-blue-800 mb-3 border-b-2 border-blue-200 pb-1">Historical Trends</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 print:grid-cols-2 gap-4">
        {trends.slice(0, 6).map((trend) => (
          <div key={trend.parameter_name} className="border rounded-lg p-3 print:break-inside-avoid">
            <h3 className="text-sm font-semibold mb-1">{trend.parameter_name} {trend.unit && <span className="text-xs text-gray-500">({trend.unit})</span>}</h3>
            <ResponsiveContainer width="100%" height={150}>
              <LineChart data={trend.data}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip />
                <Line type="monotone" dataKey="value" stroke="#2563eb" strokeWidth={2} dot={{ r: 4, fill: "#2563eb" }} />
                {trend.high && <ReferenceLine y={trend.high} stroke="#ef4444" strokeDasharray="5 5" label={{ value: "High", fontSize: 9, fill: "#ef4444" }} />}
                {trend.low && <ReferenceLine y={trend.low} stroke="#f59e0b" strokeDasharray="5 5" label={{ value: "Low", fontSize: 9, fill: "#f59e0b" }} />}
              </LineChart>
            </ResponsiveContainer>
          </div>
        ))}
      </div>
    </div>
  );
};

export default ReportTrendCharts;
