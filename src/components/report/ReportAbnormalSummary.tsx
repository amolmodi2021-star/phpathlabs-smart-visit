interface TestResult {
  parameter_name: string;
  result_value: string;
  unit?: string;
  normal_range_low?: string;
  normal_range_high?: string;
  normal_range_text?: string;
  flag?: string;
}

interface ReportAbnormalSummaryProps {
  abnormalResults: TestResult[];
}

const ReportAbnormalSummary = ({ abnormalResults }: ReportAbnormalSummaryProps) => {
  if (abnormalResults.length === 0) return null;

  return (
    <div className="border border-red-200 rounded-lg p-4 bg-red-50">
      <h2 className="text-base font-bold text-red-700 mb-2 border-b border-red-200 pb-1">⚠ Abnormal Results Summary</h2>
      <table className="w-full text-sm" style={{ tableLayout: 'fixed' }}>
        <colgroup>
          <col style={{ width: '38%' }} />
          <col style={{ width: '18%' }} />
          <col style={{ width: '14%' }} />
          <col style={{ width: '22%' }} />
          <col style={{ width: '8%' }} />
        </colgroup>
        <thead>
          <tr className="text-left text-xs text-red-600">
            <th className="py-1">Test</th>
            <th className="py-1">Result</th>
            <th className="py-1">Unit</th>
            <th className="py-1">Range</th>
            <th className="py-1">Flag</th>
          </tr>
        </thead>
        <tbody>
          {abnormalResults.map((r, i) => (
            <tr key={i} className="text-red-800 font-semibold">
              <td className="py-0.5 truncate">{r.parameter_name}</td>
              <td className="py-0.5">{r.result_value}</td>
              <td className="py-0.5">{r.unit}</td>
              <td className="py-0.5">{r.normal_range_text || `${r.normal_range_low || ""}-${r.normal_range_high || ""}`}</td>
              <td className="py-0.5"><span className="bg-red-600 text-white px-1.5 py-0.5 rounded text-xs">{r.flag}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default ReportAbnormalSummary;
