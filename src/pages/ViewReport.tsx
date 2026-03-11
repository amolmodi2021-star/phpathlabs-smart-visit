import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Loader2, Printer, ArrowLeft } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import * as pdfjsLib from "pdfjs-dist";
import ReportTrendCharts from "@/components/report/ReportTrendCharts";
import ReportHeader from "@/components/report/ReportHeader";
import ReportAbnormalSummary from "@/components/report/ReportAbnormalSummary";
import ReportResultsSection from "@/components/report/ReportResultsSection";
import ReportSignatureBlock from "@/components/report/ReportSignatureBlock";

pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.worker.min.mjs";

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

interface LayoutSettings {
  top_margin_cm: number;
  bottom_margin_cm: number;
  letterhead_pdf_path: string | null;
}

const ViewReport = () => {
  const { reportId } = useParams();
  const navigate = useNavigate();
  const printRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [extracted, setExtracted] = useState<any>(null);
  const [pathologistMap, setPathologistMap] = useState<Record<string, any>>({});
  const [trends, setTrends] = useState<TrendData[]>([]);
  const [showHeader, setShowHeader] = useState(true);
  const [layoutSettings, setLayoutSettings] = useState<LayoutSettings>({
    top_margin_cm: 2.5,
    bottom_margin_cm: 1.5,
    letterhead_pdf_path: null,
  });
  const [letterheadImageUrl, setLetterheadImageUrl] = useState<string | null>(null);

  useEffect(() => { loadReport(); loadLayoutSettings(); }, [reportId]);

  const convertPdfToBackgroundImage = async (pdfUrl: string) => {
    try {
      const pdf = await pdfjsLib.getDocument(pdfUrl).promise;
      const page = await pdf.getPage(1);
      const viewport = page.getViewport({ scale: 2 });
      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      await page.render({ canvasContext: ctx, viewport }).promise;
      return canvas.toDataURL("image/png");
    } catch {
      return null;
    }
  };

  const loadLayoutSettings = async () => {
    const { data } = await supabase.from("report_layout_settings").select("*").limit(1).single();
    if (data) {
      setLayoutSettings({
        top_margin_cm: Number(data.top_margin_cm) || 2.5,
        bottom_margin_cm: Number(data.bottom_margin_cm) || 1.5,
        letterhead_pdf_path: data.letterhead_pdf_path || null,
      });
      if (data.letterhead_pdf_path) {
        const { data: urlData } = supabase.storage.from("letterheads").getPublicUrl(data.letterhead_pdf_path);
        setLetterheadUrl(urlData.publicUrl);
        const backgroundImage = await convertPdfToBackgroundImage(urlData.publicUrl);
        setLetterheadImageUrl(backgroundImage);
      } else {
        setLetterheadUrl(null);
        setLetterheadImageUrl(null);
      }
    }
  };

  const loadReport = async () => {
    setLoading(true);
    const { data: ext } = await supabase.from("extracted_report_data").select("*").eq("report_id", reportId).single();
    if (!ext) { setLoading(false); return; }
    setExtracted(ext);

    const { data: allSigs } = await supabase.from("pathologist_signatures").select("*");
    const sigMap: Record<string, any> = {};
    (allSigs || []).forEach((sig: any) => {
      sigMap[sig.pathologist_name.toLowerCase()] = sig;
    });
    setPathologistMap(sigMap);

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

  const approverNames = [...new Set(results.map(r => r.approved_by).filter(Boolean))] as string[];
  const hasMultipleApprovers = approverNames.length > 1;

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

  const findPathologistSig = (name: string) => {
    const lower = name.toLowerCase();
    for (const key of Object.keys(pathologistMap)) {
      if (lower.includes(key) || key.includes(lower)) {
        return pathologistMap[key];
      }
    }
    return null;
  };

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

  const topMarginMm = layoutSettings.top_margin_cm * 10;
  const bottomMarginMm = layoutSettings.bottom_margin_cm * 10;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4 print:hidden flex-wrap">
        <Button variant="outline" size="sm" onClick={() => navigate("/reports")}><ArrowLeft className="h-4 w-4 mr-1" />Back</Button>
        <Button size="sm" onClick={handlePrint}><Printer className="h-4 w-4 mr-1" />Print</Button>
        <div className="flex items-center gap-2">
          <Switch id="show-header" checked={showHeader} onCheckedChange={setShowHeader} />
          <Label htmlFor="show-header" className="text-sm cursor-pointer">
            {showHeader ? "With Header" : "Without Header"}
          </Label>
        </div>
      </div>

      <div ref={printRef} className="bg-white text-black print:text-black mx-auto max-w-[210mm] print:max-w-none report-print-area" style={{ fontFamily: "'Segoe UI', Arial, sans-serif" }}>
        {Object.entries(resultsByApprover).map(([approverKey, approverResults], pageIdx) => {
          const grouped = groupResults(approverResults);
          const approverName = approverKey === "_all" ? (extracted.pathologist_name || "") : approverKey;
          const pathologist = findPathologistSig(approverName);
          const signatureUrl = pathologist?.signature_image_path
            ? supabase.storage.from("signatures").getPublicUrl(pathologist.signature_image_path).data.publicUrl
            : null;

          const pageAbnormals = approverResults.filter(r => r.flag === "H" || r.flag === "L");

          return (
            <div key={approverKey} className={`report-page ${pageIdx > 0 ? "print:break-before-page" : ""}`}
              style={{ paddingTop: `${topMarginMm}mm`, paddingBottom: `${bottomMarginMm}mm` }}>
              
              {showHeader && <ReportHeader extracted={extracted} />}

              {hasMultipleApprovers && (
                <div className="px-6 mb-2">
                  <div className="bg-gray-100 border border-gray-300 rounded px-3 py-1.5 text-sm font-semibold text-gray-700">
                    Section approved by: {approverName}
                  </div>
                </div>
              )}

              <div className="px-6 space-y-6">
                {pageAbnormals.length > 0 && (
                  <ReportAbnormalSummary abnormalResults={pageAbnormals} />
                )}

                <ReportResultsSection grouped={grouped} shouldShowProfile={shouldShowProfile} />

                <ReportSignatureBlock
                  signatureUrl={signatureUrl}
                  pathologistName={pathologist?.pathologist_name || approverName}
                  qualification={pathologist?.qualification}
                  designation={pathologist?.designation}
                />
              </div>
            </div>
          );
        })}

        {trends.length > 0 && (
          <div className="px-6 print:break-before-page" style={{ paddingTop: `${topMarginMm}mm`, paddingBottom: `${bottomMarginMm}mm` }}>
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
          .report-print-area { width: 210mm !important; max-width: 210mm !important; }
          .report-page {
            min-height: 297mm;
            width: 210mm;
            box-sizing: border-box;
            position: relative;
          }
          @page {
            size: A4;
            margin: 0;
          }
          ${showHeader && letterheadImageUrl ? `
          .report-page {
            background-image: url("${letterheadImageUrl}");
            background-size: 210mm 297mm;
            background-repeat: no-repeat;
            background-position: center;
          }
          ` : ''}
        }
        /* Screen preview */
        .report-page {
          min-height: 297mm;
          width: 210mm;
          box-sizing: border-box;
          position: relative;
          margin: 0 auto;
          ${showHeader && letterheadImageUrl ? `
          background-image: url("${letterheadImageUrl}");
          background-size: 210mm 297mm;
          background-repeat: no-repeat;
          background-position: center;
          ` : ''}
        }
      `}</style>
    </div>
  );
};

export default ViewReport;
