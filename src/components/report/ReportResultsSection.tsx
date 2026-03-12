interface TestResult {
  department?: string;
  profile_name?: string;
  test_name?: string;
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
  compact?: boolean;
  hideDeptHeader?: boolean;
}

const groupByTestName = (params: TestResult[]): { testName: string | null; params: TestResult[] }[] => {
  const groups: { testName: string | null; params: TestResult[] }[] = [];
  const seen = new Map<string, TestResult[]>();

  params.forEach((r) => {
    const tn = r.test_name || null;
    const key = tn || "__none__";
    if (!seen.has(key)) {
      seen.set(key, []);
      groups.push({ testName: tn, params: seen.get(key)! });
    }
    seen.get(key)!.push(r);
  });

  return groups;
};

const COMPACT_PROFILES = ["cbc", "complete blood count", "urine routine analysis", "urine routine", "urine analysis"];

const isCompactProfile = (profName: string): boolean => {
  const lower = profName.toLowerCase();
  return COMPACT_PROFILES.some(cp => lower.includes(cp));
};

const ReportResultsSection = ({ grouped, shouldShowProfile, compact, hideDeptHeader }: ReportResultsSectionProps) => {
  return (
    <>
      {Object.entries(grouped).map(([dept, profiles]) => (
        <div key={dept} data-pdf-section="department">
          {!hideDeptHeader && <div className="text-white px-3 py-1.5 rounded-t font-semibold text-sm text-center" style={{ backgroundColor: '#2E3192' }}>{dept}</div>}
          <div className={`border ${hideDeptHeader ? 'rounded' : 'border-t-0 rounded-b'}`}>
            {Object.entries(profiles).map(([profName, params], profIdx) => {
              const useCompact = compact || isCompactProfile(profName);
              const testGroups = groupByTestName(params);
              const hasMultipleTestNames = useCompact && (testGroups.filter(g => g.testName).length > 1 || (testGroups.length === 1 && testGroups[0].testName && testGroups[0].testName !== profName));

              return (
                <div key={profName} data-pdf-section="profile" className="print:break-inside-avoid">
                  {profIdx > 0 && <div style={{ height: useCompact ? '1.5mm' : '2mm' }} />}
                  {profName !== "_individual" && shouldShowProfile(params) && (
                    <>
                      <div style={{ height: '1mm' }} />
                      <div className="bg-blue-50 px-3 py-1 font-semibold text-sm text-blue-800 border-b">{profName}</div>
                    </>
                  )}
                  <table className={`w-full ${useCompact ? 'text-xs' : 'text-sm'}`} style={{ tableLayout: 'fixed' }}>
                    <colgroup>
                      <col style={{ width: '36%' }} />
                      <col style={{ width: '24px' }} />
                      <col style={{ width: 'auto' }} />
                      <col style={{ width: '14%' }} />
                      <col style={{ width: '28%' }} />
                    </colgroup>
                    <thead>
                      <tr className={`text-gray-500 border-b ${useCompact ? 'text-[10px]' : 'text-xs'}`}>
                        <th className="text-left py-0.5 px-3">Parameter</th>
                        <th></th>
                        <th className="text-center py-0.5">Result</th>
                        <th className="text-center py-0.5">Unit</th>
                        <th className="text-center py-0.5">Reference Range</th>
                      </tr>
                    </thead>
                    <tbody>
                      {testGroups.map((group, gIdx) => (
                        <>
                          {hasMultipleTestNames && group.testName && (
                            <tr key={`header-${gIdx}`}>
                              <td colSpan={5} className={`px-3 font-semibold text-gray-700 bg-gray-50 border-b ${useCompact ? 'py-0.5 text-[10px]' : 'py-0.5 text-xs'}`}>
                                {group.testName}
                              </td>
                            </tr>
                          )}
                          {group.params.map((r, i) => {
                            const isAbnormal = r.flag === "H" || r.flag === "L";
                            return (
                              <tr key={`${gIdx}-${i}`} className={`border-b border-gray-100 ${isAbnormal ? "bg-red-50" : ""}`} style={useCompact ? { lineHeight: '1.2' } : undefined}>
                                <td className={`px-3 ${useCompact ? 'py-[2px]' : 'py-1'}`}>{r.parameter_name}</td>
                                <td className={`text-right ${useCompact ? 'py-[2px]' : 'py-1'}`}>
                                  {isAbnormal && <span className="bg-red-600 text-white px-1 py-0 rounded text-[9px] font-bold">{r.flag}</span>}
                                </td>
                                <td className={`text-center font-semibold ${useCompact ? 'py-[2px]' : 'py-1'} ${isAbnormal ? "text-red-600 font-bold" : ""}`}>
                                  {r.result_value}
                                </td>
                                <td className={`text-center text-gray-600 ${useCompact ? 'py-[2px]' : 'py-1'}`}>{r.unit}</td>
                                <td className={`text-center text-gray-600 ${useCompact ? 'py-[2px]' : 'py-1'}`}>{r.normal_range_text || `${r.normal_range_low || ""} - ${r.normal_range_high || ""}`}</td>
                              </tr>
                            );
                          })}
                        </>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </>
  );
};

export default ReportResultsSection;
