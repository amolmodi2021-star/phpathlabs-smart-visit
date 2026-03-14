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
  // Master data fields (auto-applied at report render)
  sample_type?: string;
  analyzer?: string;
  method?: string;
  is_outsourced?: boolean;
  outsourced_caption?: string;
  interpretation?: string;
  remark?: string;
}

interface ProfileMeta {
  sample_type?: string;
  analyzer?: string;
  method?: string;
  is_outsourced?: boolean;
  outsourced_caption?: string;
  interpretation?: string;
  enable_test_grouping?: boolean;
}

interface ReportResultsSectionProps {
  grouped: Record<string, Record<string, TestResult[]>>;
  shouldShowProfile: (params: TestResult[]) => boolean;
  compact?: boolean;
  hideDeptHeader?: boolean;
  profileMetaMap?: Record<string, ProfileMeta>;
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

const COMPACT_PROFILES = ["cbc", "complete blood count", "urine routine"];

const MORPHOLOGY_TESTS = ["morphology", "rbc morphology", "wbc morphology", "platelet morphology", "peripheral smear"];

const isCompactProfile = (profName: string): boolean => {
  const lower = profName.toLowerCase();
  return COMPACT_PROFILES.some(cp => lower.includes(cp));
};


const isMorphologySection = (testName: string | null | undefined): boolean => {
  if (!testName) return false;
  const lower = testName.toLowerCase();
  return MORPHOLOGY_TESTS.some(m => lower.includes(m));
};

const ReportResultsSection = ({ grouped, shouldShowProfile, compact, hideDeptHeader, profileMetaMap }: ReportResultsSectionProps) => {
  return (
    <>
      {Object.entries(grouped).map(([dept, profiles]) => (
        <div key={dept} data-pdf-section="department">
          {!hideDeptHeader && <div className="text-white px-3 py-1.5 rounded-t font-semibold text-sm text-center" style={{ backgroundColor: '#2E3192' }}>{dept}</div>}
          <div className={`border ${hideDeptHeader ? 'rounded' : 'border-t-0 rounded-b'}`}>
            {Object.entries(profiles).map(([profName, params], profIdx) => {
              const useCompact = compact || isCompactProfile(profName);
              const isStandalone = profName === "_individual";

              // For standalone parameters, render each one individually with its own metadata
              if (isStandalone) {
                return params.map((r, pIdx) => {
                  const isAbnormal = r.flag === "H" || r.flag === "L";
                  const isMorphRow = isMorphologySection(r.test_name);
                  const paramMeta = {
                    sample_type: r.sample_type,
                    analyzer: r.analyzer,
                    method: r.method,
                    is_outsourced: r.is_outsourced,
                    outsourced_caption: r.outsourced_caption,
                    interpretation: r.interpretation,
                  };
                  const hasParamMeta = paramMeta.sample_type || paramMeta.analyzer || paramMeta.method;
                  const hasParamOutsourced = paramMeta.is_outsourced && paramMeta.outsourced_caption;
                  const hasParamInterpretation = paramMeta.interpretation && paramMeta.interpretation.replace(/<[^>]*>/g, '').trim().length > 0;

                  return (
                    <div key={`standalone-${pIdx}`} data-pdf-section="profile" className="print:break-inside-avoid">
                      {pIdx > 0 && <div className="border-t-2 border-gray-400" style={{ marginBottom: '3mm' }} />}
                      {(profIdx > 0 && pIdx === 0) && <div style={{ height: '2mm' }} />}
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
                          <tr className={`border-b border-gray-100 ${isAbnormal ? "bg-red-50" : ""}`}>
                            <td className="px-3 py-1 font-semibold">{r.parameter_name}</td>
                            <td className="text-right py-1">
                              {isAbnormal && <span className="flag-badge inline-flex items-center justify-center min-w-[14px] h-[14px] rounded bg-red-600 text-white text-[10px] leading-none font-bold">{r.flag}</span>}
                            </td>
                            {isMorphRow ? (
                              <td colSpan={3} className="text-left px-2 text-gray-800 py-1" style={{ whiteSpace: 'normal', wordBreak: 'break-word' }}>
                                {r.result_value}
                              </td>
                            ) : (
                              <>
                                <td className={`text-center font-semibold py-1 ${isAbnormal ? "text-red-600 font-bold" : ""}`}>
                                  {r.result_value}
                                </td>
                                <td className="text-center text-gray-600 py-1">{r.unit}</td>
                                <td className="text-center text-gray-600 py-1">{r.normal_range_text || `${r.normal_range_low || ""} - ${r.normal_range_high || ""}`}</td>
                              </>
                            )}
                          </tr>
                          {r.remark && (
                            <tr className="border-b border-gray-100">
                              <td colSpan={5} className="px-3 py-0.5">
                                <span className="text-[10px] italic text-gray-600">* {r.remark}</span>
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>

                      {hasParamMeta && (
                        <div className="px-3 py-1 text-[10px] text-gray-500 border-t border-gray-100 flex gap-4 flex-wrap">
                          {paramMeta.sample_type && <span><strong>Sample Type:</strong> {paramMeta.sample_type}</span>}
                          {paramMeta.analyzer && <span><strong>Analyzer:</strong> {paramMeta.analyzer}</span>}
                          {paramMeta.method && <span><strong>Method:</strong> {paramMeta.method}</span>}
                        </div>
                      )}
                      {hasParamOutsourced && (
                        <div className="px-3 py-1 text-[10px] text-gray-500 italic border-t border-gray-100">
                          {paramMeta.outsourced_caption}
                        </div>
                      )}
                      {hasParamInterpretation && (
                        <div className="px-3 py-1.5 border-t border-gray-100">
                          <div className="text-[9px] font-semibold text-gray-600 mb-0.5">Interpretation:</div>
                          <div
                            className="text-[9px] text-gray-700 prose prose-xs max-w-none [&_img]:max-h-[60mm] [&_img]:inline-block [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:list-decimal [&_ol]:pl-4"
                            dangerouslySetInnerHTML={{ __html: paramMeta.interpretation! }}
                          />
                        </div>
                      )}
                    </div>
                  );
                });
              }

              // Profile-level rendering (non-standalone)
              const testGroups = groupByTestName(params);
              const isGroupedProfile = profileMetaMap?.[profName]?.enable_test_grouping ?? false;
              const hasMultipleTestNames = isGroupedProfile && testGroups.filter(g => g.testName).length >= 1;
              const profMeta = profileMetaMap ? profileMetaMap[profName] : null;
              const meta = profMeta;
              const hasMetaRow = meta && (meta.sample_type || meta.analyzer || meta.method);
              const hasOutsourced = meta?.is_outsourced && meta?.outsourced_caption;
              const hasInterpretation = meta?.interpretation && meta.interpretation.replace(/<[^>]*>/g, '').trim().length > 0;

              return (
                <div key={profName} data-pdf-section="profile" className="print:break-inside-avoid">
                  {profIdx > 0 && <div style={{ height: useCompact ? '1.5mm' : '2mm' }} />}
                  {shouldShowProfile(params) && (
                    <>
                      <div style={{ height: '1mm' }} />
                      <div className="bg-blue-50 px-3 py-1 font-semibold text-sm border-b" style={{ color: '#2E3192' }}>{profName}</div>
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
                            const isMorphRow = isMorphologySection(group.testName);
                            return (
                              <>
                                <tr key={`${gIdx}-${i}`} className={`border-b border-gray-100 ${isAbnormal ? "bg-red-50" : ""}`} style={useCompact ? { lineHeight: '1.2' } : undefined}>
                                  <td className={`px-3 font-semibold ${useCompact ? 'py-[2px]' : 'py-1'}`}>{r.parameter_name}</td>
                                  <td className={`text-right ${useCompact ? 'py-[2px]' : 'py-1'}`}>
                                    {isAbnormal && <span className="flag-badge inline-flex items-center justify-center min-w-[14px] h-[14px] rounded bg-red-600 text-white text-[10px] leading-none font-bold">{r.flag}</span>}
                                  </td>
                                  {isMorphRow ? (
                                    <td colSpan={3} className={`text-left px-2 text-gray-800 ${useCompact ? 'py-[2px]' : 'py-1'}`} style={{ whiteSpace: 'normal', wordBreak: 'break-word' }}>
                                      {r.result_value}
                                    </td>
                                  ) : (
                                    <>
                                      <td className={`text-center font-semibold ${useCompact ? 'py-[2px]' : 'py-1'} ${isAbnormal ? "text-red-600 font-bold" : ""}`}>
                                        {r.result_value}
                                      </td>
                                      <td className={`text-center text-gray-600 ${useCompact ? 'py-[2px]' : 'py-1'}`}>{r.unit}</td>
                                      <td className={`text-center text-gray-600 ${useCompact ? 'py-[2px]' : 'py-1'}`}>{r.normal_range_text || `${r.normal_range_low || ""} - ${r.normal_range_high || ""}`}</td>
                                    </>
                                  )}
                                </tr>
                                {r.remark && (
                                  <tr key={`${gIdx}-${i}-remark`} className="border-b border-gray-100">
                                    <td colSpan={5} className="px-3 py-0.5">
                                      <span className="text-[10px] italic text-gray-600">* {r.remark}</span>
                                    </td>
                                  </tr>
                                )}
                              </>
                            );
                          })}
                        </>
                      ))}
                    </tbody>
                  </table>

                  {hasMetaRow && (
                    <div className="px-3 py-1 text-[10px] text-gray-500 border-t border-gray-100 flex gap-4 flex-wrap">
                      {meta!.sample_type && <span><strong>Sample Type:</strong> {meta!.sample_type}</span>}
                      {meta!.analyzer && <span><strong>Analyzer:</strong> {meta!.analyzer}</span>}
                      {meta!.method && <span><strong>Method:</strong> {meta!.method}</span>}
                    </div>
                  )}
                  {hasOutsourced && (
                    <div className="px-3 py-1 text-[10px] text-gray-500 italic border-t border-gray-100">
                      {meta!.outsourced_caption}
                    </div>
                  )}
                  {hasInterpretation && (
                    <div className="px-3 py-1.5 border-t border-gray-100">
                      <div className="text-[9px] font-semibold text-gray-600 mb-0.5">Interpretation:</div>
                      <div
                        className="text-[9px] text-gray-700 prose prose-xs max-w-none [&_img]:max-h-[60mm] [&_img]:inline-block [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:list-decimal [&_ol]:pl-4"
                        dangerouslySetInnerHTML={{ __html: meta!.interpretation! }}
                      />
                    </div>
                  )}
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
