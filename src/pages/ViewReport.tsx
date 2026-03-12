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

// A "page section" is a unit we try not to split across pages
interface PageSection {
  type: "abnormal-summary" | "department-profile";
  dept?: string;
  profName?: string;
  results?: TestResult[];
  abnormals?: TestResult[];
  estimatedHeightMm: number;
}

const HEADER_HEIGHT_MM = 32; // patient details header
const SIGNATURE_HEIGHT_MM = 28; // signature block
const PAGE_NUM_HEIGHT_MM = 8;
const DEPT_HEADER_HEIGHT_MM = 8;
const PROFILE_HEADER_HEIGHT_MM = 6;
const TABLE_HEADER_HEIGHT_MM = 6;
const ROW_HEIGHT_MM = 5.5;
const PROFILE_GAP_MM = 3;
const ABNORMAL_SUMMARY_BASE_MM = 16;
const ABNORMAL_ROW_MM = 5;

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
        const backgroundImage = await convertPdfToBackgroundImage(urlData.publicUrl);
        setLetterheadImageUrl(backgroundImage);
      } else {
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
  const PAGE_HEIGHT_MM = 297;
  const usableHeight = PAGE_HEIGHT_MM - topMarginMm - bottomMarginMm - HEADER_HEIGHT_MM - SIGNATURE_HEIGHT_MM - PAGE_NUM_HEIGHT_MM;

  // Build sections for each approver group
  const buildSections = (approverResults: TestResult[], includeAbnormalSummary: boolean): PageSection[] => {
    const sections: PageSection[] = [];

    if (includeAbnormalSummary) {
      const allAbnormals = results.filter(r => r.flag === "H" || r.flag === "L");
      if (allAbnormals.length > 0) {
        sections.push({
          type: "abnormal-summary",
          abnormals: allAbnormals,
          estimatedHeightMm: ABNORMAL_SUMMARY_BASE_MM + allAbnormals.length * ABNORMAL_ROW_MM,
        });
      }
    }

    const grouped = groupResults(approverResults);
    Object.entries(grouped).forEach(([dept, profiles]) => {
      Object.entries(profiles).forEach(([profName, params]) => {
        const showProf = profName !== "_individual" && shouldShowProfile(params);
        const heightMm = DEPT_HEADER_HEIGHT_MM + (showProf ? PROFILE_HEADER_HEIGHT_MM : 0) + TABLE_HEADER_HEIGHT_MM + params.length * ROW_HEIGHT_MM + PROFILE_GAP_MM;
        sections.push({
          type: "department-profile",
          dept,
          profName,
          results: params,
          estimatedHeightMm: heightMm,
        });
      });
    });

    return sections;
  };

  // Paginate sections into pages
  const paginateSections = (sections: PageSection[]): PageSection[][] => {
    const pages: PageSection[][] = [];
    let currentPage: PageSection[] = [];
    let currentHeight = 0;

    sections.forEach((section) => {
      if (currentHeight + section.estimatedHeightMm > usableHeight && currentPage.length > 0) {
        pages.push(currentPage);
        currentPage = [];
        currentHeight = 0;
      }
      currentPage.push(section);
      currentHeight += section.estimatedHeightMm;
    });

    if (currentPage.length > 0) {
      pages.push(currentPage);
    }

    return pages;
  };

  // Build all pages across all approvers
  interface ReportPage {
    sections: PageSection[];
    approverKey: string;
    approverName: string;
  }

  const allPages: ReportPage[] = [];
  const approverEntries = Object.entries(resultsByApprover);

  approverEntries.forEach(([approverKey, approverResults], approverIdx) => {
    const sections = buildSections(approverResults, approverIdx === 0);
    const pages = paginateSections(sections);
    const approverName = approverKey === "_all" ? (extracted.pathologist_name || "") : approverKey;
    pages.forEach((pageSections) => {
      allPages.push({ sections: pageSections, approverKey, approverName });
    });
  });

  // Add trends page
  const hasTrends = trends.length > 0;
  const totalPages = allPages.length + (hasTrends ? 1 : 0);

  const renderPageSections = (sections: PageSection[]) => {
    return sections.map((section, idx) => {
      if (section.type === "abnormal-summary" && section.abnormals) {
        return <ReportAbnormalSummary key={`abnormal-${idx}`} abnormalResults={section.abnormals} />;
      }
      if (section.type === "department-profile" && section.results && section.dept) {
        const grouped: Record<string, Record<string, TestResult[]>> = {
          [section.dept]: { [section.profName || "_individual"]: section.results },
        };
        return (
          <div key={`${section.dept}-${section.profName}-${idx}`} style={{ marginBottom: `${PROFILE_GAP_MM}mm` }}>
            <ReportResultsSection grouped={grouped} shouldShowProfile={shouldShowProfile} />
          </div>
        );
      }
      return null;
    });
  };

  return (
    <div className="space-y-4 print:space-y-0">
      <div className="flex items-center gap-4 print:hidden flex-wrap">
        <Button variant="outline" size="sm" onClick={() => navigate("/reports")}><ArrowLeft className="h-4 w-4 mr-1" />Back</Button>
        <Button size="sm" onClick={handlePrint}><Printer className="h-4 w-4 mr-1" />Print</Button>
        <div className="flex items-center gap-2">
          <Switch id="show-header" checked={showHeader} onCheckedChange={setShowHeader} />
          <Label htmlFor="show-header" className="text-sm cursor-pointer">
            {showHeader ? "With Letterhead" : "Without Letterhead"}
          </Label>
        </div>
      </div>

      <div ref={printRef} className="bg-white text-black print:text-black mx-auto max-w-[210mm] print:max-w-none report-print-area" style={{ fontFamily: "'Segoe UI', Arial, sans-serif" }}>
        {allPages.map((page, pageIdx) => {
          const pathologist = findPathologistSig(page.approverName);
          const signatureUrl = pathologist?.signature_image_path
            ? supabase.storage.from("signatures").getPublicUrl(pathologist.signature_image_path).data.publicUrl
            : null;

          return (
            <div key={pageIdx} className="report-page"
              style={{ paddingTop: `${topMarginMm}mm`, paddingBottom: `${bottomMarginMm}mm` }}>
              
              <ReportHeader extracted={extracted} />

              <div className="px-6 space-y-2">
                {renderPageSections(page.sections)}
              </div>

              <div style={{ position: 'absolute', bottom: `${bottomMarginMm + PAGE_NUM_HEIGHT_MM + 2}mm`, left: '24px', right: '24px' }}>
                <ReportSignatureBlock
                  signatureUrl={signatureUrl}
                  pathologistName={pathologist?.pathologist_name || page.approverName}
                  qualification={pathologist?.qualification}
                  designation={pathologist?.designation}
                />
              </div>

              <div className="page-number-footer" style={{ position: 'absolute', bottom: `${bottomMarginMm + 2}mm`, left: 0, right: 0, textAlign: 'center', fontSize: '9px', color: '#666' }}>
                Page {pageIdx + 1} of {totalPages}
              </div>
            </div>
          );
        })}

        {hasTrends && (
          <div className="report-page" style={{ paddingTop: `${topMarginMm}mm`, paddingBottom: `${bottomMarginMm}mm` }}>
            <ReportHeader extracted={extracted} />
            <div className="px-6">
              <ReportTrendCharts trends={trends} />
            </div>
            <div className="page-number-footer" style={{ position: 'absolute', bottom: `${bottomMarginMm + 2}mm`, left: 0, right: 0, textAlign: 'center', fontSize: '9px', color: '#666' }}>
              Page {totalPages} of {totalPages}
            </div>
          </div>
        )}
      </div>

      <style>{`
        @media print {
          html, body {
            margin: 0 !important;
            padding: 0 !important;
          }
          body * { visibility: hidden; }
          .report-print-area, .report-print-area * { visibility: visible; }
          .report-print-area { 
            position: absolute;
            left: 50%;
            top: 0;
            transform: translateX(-50%);
            width: 210mm !important; 
            max-width: 210mm !important;
            margin: 0 !important;
            padding: 0 !important;
          }
          .print\\:hidden { display: none !important; }
          .print\\:break-inside-avoid { break-inside: avoid; }
          .report-page {
            height: 296mm;
            max-height: 296mm;
            width: 210mm;
            box-sizing: border-box;
            position: relative;
            overflow: hidden;
            page-break-after: always;
            page-break-inside: avoid;
            margin: 0 auto !important;
          }
          .report-page:last-child {
            page-break-after: auto;
          }
          @page {
            size: A4;
            margin: 0;
          }
          ${showHeader && letterheadImageUrl ? `
          .report-page {
            background-image: url("${letterheadImageUrl}");
            background-size: 210mm 296mm;
            background-repeat: no-repeat;
            background-position: top center;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          ` : ''}
        }
        /* Screen preview */
        .report-page {
          min-height: 297mm;
          height: 297mm;
          width: 210mm;
          box-sizing: border-box;
          position: relative;
          margin: 0 auto 16px auto;
          border: 1px solid #e5e7eb;
          overflow: hidden;
          ${showHeader && letterheadImageUrl ? `
          background-image: url("${letterheadImageUrl}");
          background-size: 210mm 297mm;
          background-repeat: no-repeat;
          background-position: top center;
          ` : ''}
        }
      `}</style>
    </div>
  );
};

export default ViewReport;
