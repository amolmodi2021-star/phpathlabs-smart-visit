interface TestResult {
  department?: string;
  profile_name?: string;
  parameter_name: string;
  result_value: string;
  unit?: string;
  normal_range_low?: string;
  normal_range_high?: string;
  normal_range_text?: string;
  flag?: string;
}

interface ReportResultsSectionProps {
  grouped: Record<string, Record<string, TestResult[]>>;
  shouldShowProfile: (params: TestResult[]) => boolean;
}

const ReportResultsSection = ({ grouped, shouldShowProfile }: ReportResultsSectionProps) => {
  return (
    <>
      {Object.entries(grouped).map(([dept, profiles]) => (
        <div key={dept} data-pdf-section="department">
          <div className="bg-blue-600 text-white px-3 py-1.5 rounded-t font-semibold text-sm text-center">{dept}</div>
          <div className="border border-t-0 rounded-b">
            {Object.entries(profiles).map(([profName, params], profIdx) => (
              <div key={profName} data-pdf-section="profile" className="print:break-inside-avoid">
                {profIdx > 0 && <div className="h-2" />}
                {profName !== "_individual" && shouldShowProfile(params) && (
                  <>
                    <div className="h-1" />
                    <div className="bg-blue-50 px-3 py-1 font-semibold text-sm text-blue-800 border-b">{profName}</div>
                  </>
                )}
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-gray-500 border-b">
                      <th className="text-left py-1 px-3 w-[35%]">Parameter</th>
                      <th className="text-center py-1 w-[15%]">Result</th>
                      <th className="text-center py-1 w-[10%]">Unit</th>
                      <th className="text-center py-1 w-[25%]">Reference Range</th>
                      <th className="text-center py-1 w-[10%]">Flag</th>
                    </tr>
                  </thead>
                  <tbody>
                    {params.map((r, i) => {
                      const isAbnormal = r.flag === "H" || r.flag === "L";
                      return (
                        <tr key={i} className={`border-b border-gray-100 ${isAbnormal ? "bg-red-50" : ""}`}>
                          <td className="py-1 px-3">{r.parameter_name}</td>
                          <td className={`py-1 text-center font-semibold ${isAbnormal ? "text-red-600 font-bold" : ""}`}>{r.result_value}</td>
                          <td className="py-1 text-center text-gray-600">{r.unit}</td>
                          <td className="py-1 text-center text-gray-600">{r.normal_range_text || `${r.normal_range_low || ""} - ${r.normal_range_high || ""}`}</td>
                          <td className="py-1 text-center">
                            {isAbnormal && <span className="bg-red-600 text-white px-1.5 py-0.5 rounded text-xs font-bold">{r.flag}</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        </div>
      ))}
    </>
  );
};

export default ReportResultsSection;
