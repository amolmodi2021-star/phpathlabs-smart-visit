import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Loader2, Printer, ArrowLeft } from "lucide-react";
import ReportTrendCharts from "@/components/report/ReportTrendCharts";
import ReportHeader from "@/components/report/ReportHeader";
import ReportAbnormalSummary from "@/components/report/ReportAbnormalSummary";
import ReportResultsSection from "@/components/report/ReportResultsSection";
import ReportSignatureBlock from "@/components/report/ReportSignatureBlock";

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
  approved_by?: string;
}

interface TrendData {
  parameter_name: string;
  data: { date: string; value: number }[];
  low?: number;
  high?: number;
  unit?: string;
}

const ViewReport = () => {
  const { reportId } = useParams();
  const navigate = useNavigate();
  const printRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [extracted, setExtracted] = useState<any>(null);
  const [pathologistMap, setPathologistMap] = useState<Record<string, any>>({});
  const [trends, setTrends] = useState<TrendData[]>([]);

  useEffect(() => { loadReport(); }, [reportId]);

  const loadReport = async () => {
    setLoading(true);
    const { data: ext } = await supabase.from("extracted_report_data").select("*").eq("report_id", reportId).single();
    if (!ext) { setLoading(false); return; }
    setExtracted(ext);

    // Load all pathologist signatures
    const { data: allSigs } = await supabase.from("pathologist_signatures").select("*");
    const sigMap: Record<string, any> = {};
    (allSigs || []).forEach((sig: any) => {
      sigMap[sig.pathologist_name.toLowerCase()] = sig;
    });
    setPathologistMap(sigMap);

    // Load trends
    if (ext.umr_id) {
      const results = (ext.test_results as unknown as TestResult[]) || [];
      const paramNames = results.map((r) => r.parameter_name);
      const { data: history } = await supabase.from("test_result_history")
        .select("*").eq("umr_id", ext.umr_id).in("parameter_name", paramNames)
        .order("test_date", { ascending: true });

      if (history && history.length > 0) {
        const grouped: Record<string, TrendData> = {};
        history.forEach((h: any) => {
          if (!grouped[h.parameter_name]) {
            grouped[h.parameter_name] = {
              parameter_name: h.parameter_name,
              data: [],
              low: h.normal_range_low,
              high: h.normal_range_high,
              unit: h.unit,
            };
          }
          grouped[h.parameter_name].data.push({
            date: new Date(h.test_date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" }),
            value: h.result_value,
          });
        });
        setTrends(Object.values(grouped).filter((t) => t.data.length >= 2));
      }
    }
    setLoading(false);
  };

  const handlePrint = () => window.print();

  if (loading) return <div className="flex items-center justify-center p-12"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  if (!extracted) return <div className="p-8 text-center">Report not found.</div>;

  const results = (extracted.test_results as unknown as TestResult[]) || [];
  const abnormalResults = results.filter((r) => r.flag === "H" || r.flag === "L");

  // Determine unique approvers
  const approverNames = [...new Set(results.map(r => r.approved_by).filter(Boolean))] as string[];
  const hasMultipleApprovers = approverNames.length > 1;

  // Group results by approver
  const resultsByApprover: Record<string, TestResult[]> = {};
  if (hasMultipleApprovers) {
    results.forEach(r => {
      const approver = r.approved_by || "Unknown";
      if (!resultsByApprover[approver]) resultsByApprover[approver] = [];
      resultsByApprover[approver].push(r);
    });
  } else {
    resultsByApprover["_all"] = results;
  }

  // Helper to find pathologist signature
  const findPathologistSig = (name: string) => {
    const lower = name.toLowerCase();
    for (const key of Object.keys(pathologistMap)) {
      if (lower.includes(key) || key.includes(lower)) {
        return pathologistMap[key];
      }
    }
    return null;
  };

  // Group results by department then profile
  const groupResults = (resultSet: TestResult[]) => {
    const grouped: Record<string, Record<string, TestResult[]>> = {};
    resultSet.forEach((r) => {
      const dept = r.department || "General";
      const prof = r.profile_name || "_individual";
      if (!grouped[dept]) grouped[dept] = {};
      if (!grouped[dept][prof]) grouped[dept][prof] = [];
      grouped[dept][prof].push(r);
    });
    return grouped;
  };

  const shouldShowProfile = (params: TestResult[]) => params.length >= 2;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 print:hidden">
        <Button variant="outline" size="sm" onClick={() => navigate("/reports")}><ArrowLeft className="h-4 w-4 mr-1" />Back</Button>
        <Button size="sm" onClick={handlePrint}><Printer className="h-4 w-4 mr-1" />Print / Save PDF</Button>
      </div>

      <div ref={printRef} className="bg-white text-black print:text-black mx-auto max-w-[210mm] print:max-w-none" style={{ fontFamily: "'Segoe UI', Arial, sans-serif" }}>
        {/* Render each approver section as a separate "page" */}
        {Object.entries(resultsByApprover).map(([approverKey, approverResults], pageIdx) => {
          const grouped = groupResults(approverResults);
          const approverName = approverKey === "_all" ? (extracted.pathologist_name || "") : approverKey;
          const pathologist = findPathologistSig(approverName);
          const signatureUrl = pathologist?.signature_image_path
            ? supabase.storage.from("signatures").getPublicUrl(pathologist.signature_image_path).data.publicUrl
            : null;

          // Only show abnormal summary on first page
          const pageAbnormals = approverResults.filter(r => r.flag === "H" || r.flag === "L");

          return (
            <div key={approverKey} className={pageIdx > 0 ? "print:break-before-page" : ""}>
              {/* Report Header */}
              <ReportHeader extracted={extracted} />

              {hasMultipleApprovers && (
                <div className="px-6 mb-2">
                  <div className="bg-gray-100 border border-gray-300 rounded px-3 py-1.5 text-sm font-semibold text-gray-700">
                    Section approved by: {approverName}
                  </div>
                </div>
              )}

              <div className="px-6 space-y-6">
                {/* Abnormal Summary for this section */}
                {pageAbnormals.length > 0 && (
                  <ReportAbnormalSummary abnormalResults={pageAbnormals} />
                )}

                {/* Main Results */}
                <ReportResultsSection grouped={grouped} shouldShowProfile={shouldShowProfile} />

                {/* Signature for this section's approver */}
                <ReportSignatureBlock
                  signatureUrl={signatureUrl}
                  pathologistName={pathologist?.pathologist_name || approverName}
                  qualification={pathologist?.qualification}
                  designation={pathologist?.designation}
                />
              </div>

              {/* Footer */}
              <div className="mt-6 border-t pt-2 px-6 pb-4 text-center text-xs text-gray-400">
                <p>This is a computer generated report. | Generated by PH Path Labs Report System</p>
              </div>
            </div>
          );
        })}

        {/* Historical Trends - after all sections */}
        {trends.length > 0 && (
          <div className="px-6 print:break-before-page">
            <ReportTrendCharts trends={trends} />
          </div>
        )}
      </div>

      <style>{`
        @media print {
          body * { visibility: hidden; }
          #root { visibility: visible; }
          .print\\:hidden { display: none !important; }
          .print\\:break-inside-avoid { break-inside: avoid; }
          .print\\:break-before-page { break-before: page; }
          @page { margin: 10mm; size: A4; }
        }
      `}</style>
    </div>
  );
};

export default ViewReport;
