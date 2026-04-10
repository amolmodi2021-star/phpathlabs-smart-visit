import React from 'react';

export interface TestResult {
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
  sample_type?: string;
  analyzer?: string;
  method?: string;
  is_outsourced?: boolean;
  outsourced_caption?: string;
  interpretation?: string;
  remark?: string;
  is_subheader?: boolean;
  subheader_text?: string;
}

export interface ProfileMeta {
  sample_type?: string;
  analyzer?: string;
  method?: string;
  is_outsourced?: boolean;
  outsourced_caption?: string;
  interpretation?: string;
  enable_test_grouping?: boolean;
}

export interface ReportResultsSectionProps {
  grouped: Record<string, Record<string, TestResult[]>>;
  shouldShowProfile: (params: TestResult[]) => boolean;
  compact?: boolean;
  hideDeptHeader?: boolean;
  profileMetaMap?: Record<string, ProfileMeta>;
  showFlagText?: boolean;
  fontSize?: {
    department?: string;
    profile?: string;
    tableHeader?: string;
    row?: string;
    meta?: string;
  };
}

// ── Helpers ──

const groupByTestName = (params: TestResult[]): { testName: string | null; params: TestResult[] }[] => {
  const groups: { testName: string | null; params: TestResult[] }[] = [];
  const seen = new Map<string, TestResult[]>();
  params.forEach((r) => {
    if (r.is_subheader) return;
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

const isDescriptiveResult = (r: TestResult): boolean => {
  return !r.unit && !r.normal_range_text && !r.normal_range_low && !r.normal_range_high
    && (!r.flag || r.flag === "N" || r.flag === "Normal");
};

const isAbnormalFlag = (flag?: string): boolean => {
  return flag === "H" || flag === "L" || flag === "High" || flag === "Low";
};

// ── Sub-components ──

interface ParamRowProps {
  r: TestResult;
  rowKey: string;
  compact: boolean;
  isMorph: boolean;
  showFlagText: boolean;
  rowFontSize: string;
  colCount: number;
}

const ParamRow = ({ r, rowKey, compact, isMorph, showFlagText, rowFontSize, colCount }: ParamRowProps) => {
  const isAbnormal = isAbnormalFlag(r.flag);
  const isDescriptive = isDescriptiveResult(r) || isMorph;
  const py = compact ? 'py-[2px]' : 'py-0.5';

  // Bold styling only for abnormal rows
  const nameWeight = isAbnormal ? 'font-bold text-red-600' : 'font-normal';
  const resultWeight = isAbnormal ? 'font-bold text-red-600' : 'font-normal';
  const rangeWeight = isAbnormal ? 'font-bold' : 'font-normal';

  // Descriptive right span: Result + RefRange + Flag (if shown) = 2 or 3
  const rightSpan = showFlagText ? 3 : 2;

  return (
    <tr key={rowKey} className={`border-b border-gray-100 ${isAbnormal ? 'bg-red-50 print:bg-transparent' : ''}`} style={{ fontSize: rowFontSize }}>
      <td className={`px-3 ${nameWeight} ${py}`}>{r.parameter_name}</td>
      {!showFlagText && (
        <td className={`text-right ${py}`} style={{ width: '24px' }}>
          {isAbnormal && <span className="flag-badge inline-flex items-center justify-center min-w-[18px] h-[18px] rounded bg-red-600 text-white text-xs leading-none font-bold">{r.flag}</span>}
        </td>
      )}
      {isDescriptive ? (
        <td colSpan={rightSpan} className={`text-left px-2 text-gray-800 ${py}`} style={{ wordBreak: 'break-word', whiteSpace: 'normal' }}>
          {r.result_value}
        </td>
      ) : (
        <>
          <td className={`text-center ${resultWeight} ${py}`}>
            {r.result_value}
          </td>
          <td className={`text-center text-gray-600 ${rangeWeight} ${py}`}>
            {r.normal_range_text || `${r.normal_range_low || ""} - ${r.normal_range_high || ""}${r.unit ? ` ${r.unit}` : ''}`}
          </td>
          {showFlagText && (
            <td className={`text-center ${py}`}>
              {r.flag && r.flag !== "N" && r.flag !== "Normal" && (
                <span className={`font-bold ${r.flag === "H" || r.flag === "High" ? "text-red-600" : "text-blue-600"}`}>
                  {r.flag === "H" ? "HIGH" : r.flag === "L" ? "LOW" : r.flag}
                </span>
              )}
            </td>
          )}
        </>
      )}
    </tr>
  );
};

// ── Table header (no Unit column) ──

const TableHeader = ({ showFlagText, fontSize }: { showFlagText: boolean; fontSize: string }) => (
  <thead>
    <tr className="text-gray-500 border-b" style={{ fontSize }}>
      <th className="text-left py-0.5 px-3" style={{ width: showFlagText ? '40%' : '42%' }}>Parameter</th>
      {!showFlagText && <th style={{ width: '24px' }}></th>}
      <th className="text-center py-0.5" style={{ width: '20%' }}>Result</th>
      <th className="text-center py-0.5" style={{ width: showFlagText ? '25%' : '30%' }}>Reference Range</th>
      {showFlagText && <th className="text-center py-0.5" style={{ width: '15%' }}>Flag</th>}
    </tr>
  </thead>
);

// ── Main component ──

const ReportResultsSection = ({
  grouped,
  shouldShowProfile,
  compact,
  hideDeptHeader,
  profileMetaMap,
  showFlagText = false,
  fontSize,
}: ReportResultsSectionProps) => {
  const deptFontSize = fontSize?.department || '18px';
  const profileFontSize = fontSize?.profile || '18px';
  const headerFontSize = fontSize?.tableHeader || '14px';
  const rowFontSize = fontSize?.row || '14px';
  const metaFontSize = fontSize?.meta || '12px';
  const colCount = showFlagText ? 4 : 4;

  return (
    <>
      {Object.entries(grouped).map(([dept, profiles]) => (
        <div key={dept} data-pdf-section="department">
          {!hideDeptHeader && (
            <div
              className="px-3 py-1.5 rounded-t font-bold text-center bg-[#2E3192] text-white print:bg-transparent print:text-gray-900 print:border-2 print:border-gray-800"
              style={{ fontSize: deptFontSize }}
            >
              {dept}
            </div>
          )}
          <div className={`border ${hideDeptHeader ? 'rounded' : 'border-t-0 rounded-b'}`}>
            {Object.entries(profiles).map(([profName, params], profIdx) => {
              const useCompact = compact || isCompactProfile(profName);
              const isStandalone = profName === "_individual";

              // ─── Standalone parameters ───
              if (isStandalone) {
                return (
                  <div key="standalone-group" data-pdf-section="profile" className="print:break-inside-avoid">
                    {profIdx > 0 && <div style={{ height: '2mm' }} />}
                    <table className="w-full" style={{ fontSize: rowFontSize }}>
                      <TableHeader showFlagText={showFlagText} fontSize={headerFontSize} />
                      <tbody>
                        {params.map((r, pIdx) => {
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
                          const prevParam = pIdx > 0 ? params[pIdx - 1] : null;
                          const prevHadInterpretation = prevParam?.interpretation && prevParam.interpretation.replace(/<[^>]*>/g, '').trim().length > 0;
                          const totalCols = colCount;

                          return (
                            <React.Fragment key={`standalone-${pIdx}`}>
                              {pIdx > 0 && (
                                <tr><td colSpan={totalCols}><div className="border-t-2 border-gray-400" style={{ marginBottom: '3mm' }} /></td></tr>
                              )}
                              {prevHadInterpretation && <TableHeader showFlagText={showFlagText} fontSize={headerFontSize} />}
                              <ParamRow r={r} rowKey={`s-${pIdx}`} compact={useCompact} isMorph={isMorphRow} showFlagText={showFlagText} rowFontSize={rowFontSize} colCount={totalCols} />
                              {r.remark && (
                                <tr className="border-b border-gray-100">
                                  <td colSpan={totalCols} className="px-3 py-0.5">
                                    <span className="italic text-gray-600" style={{ fontSize: metaFontSize }}>* {r.remark}</span>
                                  </td>
                                </tr>
                              )}
                              {paramMeta.sample_type && (
                                <tr>
                                  <td colSpan={totalCols} className="px-3 py-0.5 text-gray-500 border-t border-gray-100" style={{ fontSize: metaFontSize }}>
                                    (Sample: {paramMeta.sample_type})
                                  </td>
                                </tr>
                              )}
                              {(paramMeta.analyzer || paramMeta.method) && (
                                <tr>
                                  <td colSpan={totalCols} className="px-3 py-0.5 text-gray-500 border-t border-gray-100" style={{ fontSize: metaFontSize }}>
                                    {[
                                      paramMeta.analyzer && `Instrument: ${paramMeta.analyzer}`,
                                      paramMeta.method && `Method: ${paramMeta.method}`,
                                    ].filter(Boolean).join(' | ')}
                                  </td>
                                </tr>
                              )}
                              {hasParamInterpretation && (
                                <tr>
                                  <td colSpan={totalCols} className="px-3 py-1.5 border-t border-gray-100">
                                    <div className="font-semibold text-gray-600 mb-0.5" style={{ fontSize: metaFontSize }}>Interpretation:</div>
                                    <div
                                      className="text-gray-700 prose prose-xs max-w-none [&_img]:max-h-[60mm] [&_img]:inline-block [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:list-decimal [&_ol]:pl-4"
                                      style={{ fontSize: metaFontSize }}
                                      dangerouslySetInnerHTML={{ __html: paramMeta.interpretation! }}
                                    />
                                  </td>
                                </tr>
                              )}
                              {hasParamOutsourced && (
                                <tr>
                                  <td colSpan={totalCols} className="px-3 py-1 text-gray-500 italic border-t border-gray-100" style={{ fontSize: metaFontSize }}>
                                    {paramMeta.outsourced_caption}
                                  </td>
                                </tr>
                              )}
                            </React.Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                );
              }

              // ─── Profile-level rendering ───
              const profMeta = profileMetaMap ? profileMetaMap[profName] : null;
              const isGroupedProfile = profMeta?.enable_test_grouping ?? false;
              const testGroups = groupByTestName(params);
              const hasMultipleTestNames = isGroupedProfile && testGroups.filter(g => g.testName).length >= 1;
              
              const hasOutsourced = profMeta?.is_outsourced && profMeta?.outsourced_caption;
              const hasInterpretation = profMeta?.interpretation && profMeta.interpretation.replace(/<[^>]*>/g, '').trim().length > 0;
              const totalCols = colCount;

              const subheaders = params.filter(p => p.is_subheader);
              const nonSubheaderParams = params.filter(p => !p.is_subheader);

              return (
                <div key={profName} data-pdf-section="profile" className="print:break-inside-avoid">
                  {profIdx > 0 && <div style={{ height: useCompact ? '1.5mm' : '2mm' }} />}
                  {shouldShowProfile(nonSubheaderParams) && (
                    <>
                      <div style={{ height: '1mm' }} />
                      <div className="px-3 py-1 font-semibold bg-blue-50 print:bg-transparent border border-gray-600" style={{ color: '#2E3192', fontSize: profileFontSize }}>
                        {profName}
                        {profMeta?.sample_type && (
                          <span className="font-normal text-gray-500 ml-2" style={{ fontSize: metaFontSize }}>
                            (Sample: {profMeta.sample_type})
                          </span>
                        )}
                      </div>
                      {(profMeta?.analyzer || profMeta?.method) && (
                        <div className="px-3 py-0.5 text-gray-500" style={{ fontSize: metaFontSize }}>
                          {[
                            profMeta?.analyzer && `Instrument: ${profMeta.analyzer}`,
                            profMeta?.method && `Method: ${profMeta.method}`,
                          ].filter(Boolean).join(' | ')}
                        </div>
                      )}
                    </>
                  )}
                  <table className="w-full" style={{ fontSize: rowFontSize }}>
                    <TableHeader showFlagText={showFlagText} fontSize={headerFontSize} />
                    <tbody>
                      {params.map((r, i) => {
                        if (r.is_subheader) {
                          return (
                            <tr key={`sh-${i}`}>
                              <td colSpan={totalCols} className="font-semibold pt-3 pb-0.5 text-gray-700 border-b px-3" style={{ fontSize: rowFontSize }}>
                                {r.subheader_text || r.parameter_name}
                              </td>
                            </tr>
                          );
                        }

                        const isMorphRow = isMorphologySection(r.test_name);
                        return (
                          <React.Fragment key={`p-${i}`}>
                            {hasMultipleTestNames && r.test_name && (i === 0 || r.test_name !== params[i - 1]?.test_name) && !params[i - 1]?.is_subheader && (
                              <tr>
                                <td colSpan={totalCols} className="px-3 font-semibold text-gray-700 bg-gray-50 print:bg-transparent border-b py-0.5" style={{ fontSize: rowFontSize }}>
                                  {r.test_name}
                                </td>
                              </tr>
                            )}
                            <ParamRow r={r} rowKey={`r-${i}`} compact={useCompact} isMorph={isMorphRow} showFlagText={showFlagText} rowFontSize={rowFontSize} colCount={totalCols} />
                            {r.remark && (
                              <tr className="border-b border-gray-100">
                                <td colSpan={totalCols} className="px-3 py-0.5">
                                  <span className="italic text-gray-600" style={{ fontSize: metaFontSize }}>* {r.remark}</span>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>

                  {hasInterpretation && (
                    <div className="px-3 py-1.5 border-t border-gray-100">
                      <div className="font-semibold text-gray-600 mb-0.5" style={{ fontSize: metaFontSize }}>Interpretation:</div>
                      <div
                        className="text-gray-700 prose prose-xs max-w-none [&_img]:max-h-[60mm] [&_img]:inline-block [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:list-decimal [&_ol]:pl-4"
                        style={{ fontSize: metaFontSize }}
                        dangerouslySetInnerHTML={{ __html: profMeta!.interpretation! }}
                      />
                    </div>
                  )}
                  {hasOutsourced && (
                    <div className="px-3 py-1 text-gray-500 italic border-t border-gray-100" style={{ fontSize: metaFontSize }}>
                      {profMeta!.outsourced_caption}
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
