import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Loader2, Printer, ArrowLeft, Download } from "lucide-react";
import { toPng } from "html-to-image";
import jsPDF from "jspdf";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import * as pdfjsLib from "pdfjs-dist";
import ReportTrendCharts from "@/components/report/ReportTrendCharts";
import ReportHeader from "@/components/report/ReportHeader";
import ReportAbnormalSummary from "@/components/report/ReportAbnormalSummary";
import ReportResultsSection from "@/components/report/ReportResultsSection";
import ReportSignatureBlock from "@/components/report/ReportSignatureBlock";
import { shareOnWhatsApp } from "@/lib/whatsapp";
import { useToast } from "@/hooks/use-toast";

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
  sample_type?: string;
  analyzer?: string;
  method?: string;
  is_outsourced?: boolean;
  outsourced_caption?: string;
  interpretation?: string;
}

interface ProfileMeta {
  sample_type?: string;
  analyzer?: string;
  method?: string;
  is_outsourced?: boolean;
  outsourced_caption?: string;
  interpretation?: string;
}

interface TrendData {
  parameter_name: string;
  data: { date: string; value: number; low?: number; high?: number }[];
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
  isAbnormalOnly?: boolean;
}

const HEADER_HEIGHT_MM = 32;
const SIGNATURE_HEIGHT_MM = 14;
const PAGE_NUM_HEIGHT_MM = 8;
const DEPT_HEADER_HEIGHT_MM = 8;
const PROFILE_HEADER_HEIGHT_MM = 6;
const TABLE_HEADER_HEIGHT_MM = 5;
const ROW_HEIGHT_MM = 5;
const ROW_HEIGHT_COMPACT_MM = 3.8;
const PROFILE_GAP_MM = 2;
const ABNORMAL_SUMMARY_BASE_MM = 14;
const ABNORMAL_ROW_MM = 4.5;
const TEST_NAME_HEADER_MM = 4;

const COMPACT_PROFILES = ["cbc", "complete blood count", "urine routine"];
const isCompactProfile = (name: string): boolean => {
  const lower = name.toLowerCase();
  return COMPACT_PROFILES.some(cp => lower.includes(cp));
};

const isDedicatedReportProfile = (section: PageSection): boolean => {
  if (section.type !== "department-profile") return false;

  const profileText = [
    section.profName,
    section.dept,
    ...(section.results?.map((r) => `${r.profile_name || ""} ${r.test_name || ""}`) || []),
  ]
    .join(" ")
    .toLowerCase();

  const isCbc = profileText.includes("cbc") || profileText.includes("complete blood count");
  const isUrine = profileText.includes("urine") && (
    profileText.includes("routine") ||
    profileText.includes("analysis") ||
    profileText.includes("microscopic") ||
    profileText.includes("microscopy") ||
    profileText.includes("urinalysis")
  );

  return isCbc || isUrine;
};

const ViewReport = () => {
  const { reportId } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const printRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [isPdfExporting, setIsPdfExporting] = useState(false);
  const [mobileDialogOpen, setMobileDialogOpen] = useState(false);
  const [mobileNumber, setMobileNumber] = useState("");
  const [extracted, setExtracted] = useState<any>(null);
  const [pathologistMap, setPathologistMap] = useState<Record<string, any>>({});
  const [deptOrderMap, setDeptOrderMap] = useState<Record<string, number>>({});
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

    // Enrich results with test_name from master parameters (with profile context)
    const results = (ext.test_results as unknown as TestResult[]) || [];
    const paramNames = results.map((r) => r.parameter_name);
    const { data: masterParams } = await supabase
      .from("report_test_parameters")
      .select("parameter_name, test_name, report_profiles(profile_name)")
      .in("parameter_name", paramNames);

    // Also fetch with case-insensitive fallback for mismatched casing (e.g. pH vs PH)
    const unmatchedNames = paramNames.filter(pn => 
      !masterParams?.some(mp => mp.parameter_name === pn)
    );
    let allMasterParams = masterParams || [];
    if (unmatchedNames.length > 0) {
      const { data: fallbackParams } = await supabase
        .from("report_test_parameters")
        .select("parameter_name, test_name, report_profiles(profile_name)");
      if (fallbackParams) {
        const lowerMap = new Map<string, typeof fallbackParams[0]>();
        fallbackParams.forEach(fp => {
          lowerMap.set(fp.parameter_name.toLowerCase(), fp);
        });
        unmatchedNames.forEach(name => {
          const match = lowerMap.get(name.toLowerCase());
          if (match) allMasterParams.push({ ...match, parameter_name: name });
        });
      }
    }

    if (allMasterParams.length > 0) {
      // Build profile-specific map using lowercase keys for case-insensitive matching
      const profileSpecificMap: Record<string, string> = {};
      const genericMap: Record<string, string> = {};
      allMasterParams.forEach((mp: any) => {
        if (mp.test_name) {
          genericMap[mp.parameter_name.toLowerCase()] = mp.test_name;
          const profName = mp.report_profiles?.profile_name;
          if (profName) {
            profileSpecificMap[`${profName.toLowerCase()}::${mp.parameter_name.toLowerCase()}`] = mp.test_name;
          }
        }
      });
      results.forEach((r) => {
        // Prefer profile-specific match to avoid cross-profile contamination
        const paramLower = r.parameter_name.toLowerCase();
        const profileKey = r.profile_name ? `${r.profile_name.toLowerCase()}::${paramLower}` : null;
        if (profileKey && profileSpecificMap[profileKey]) {
          r.test_name = profileSpecificMap[profileKey];
        } else if (genericMap[paramLower]) {
          r.test_name = genericMap[paramLower];
        }
      });
      ext.test_results = results as any;
    }

    // Fetch department display order
    const { data: depts } = await supabase.from("report_departments").select("department_name, display_order").order("display_order", { ascending: true });
    if (depts) {
      const orderMap: Record<string, number> = {};
      depts.forEach((d: any) => { orderMap[d.department_name] = d.display_order ?? 999; });
      setDeptOrderMap(orderMap);
    }

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
            low: h.normal_range_low,
            high: h.normal_range_high,
          });
        });
        setTrends(Object.values(grouped).filter((t) => t.data.length >= 2));
      }
    }
    setLoading(false);
  };

  const handlePrint = () => window.print();

  const generatePdfBlob = async (): Promise<{ blob: Blob; fileName: string } | null> => {
    if (!printRef.current || !extracted) return null;

    const waitForPaint = async () => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    };

    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
    if (fonts?.ready) await fonts.ready;
    await waitForPaint();

    const pages = Array.from(printRef.current.querySelectorAll('.report-page')) as HTMLElement[];
    if (pages.length === 0) return null;

    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });

    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      const dataUrl = await toPng(page, {
        cacheBust: true,
        pixelRatio: 2,
        backgroundColor: '#ffffff',
        style: { transform: 'none' },
        filter: (node) => {
          if (!(node instanceof HTMLElement)) return true;
          return !node.classList.contains('recharts-tooltip-wrapper');
        },
      });
      if (i > 0) pdf.addPage();
      pdf.addImage(dataUrl, 'PNG', 0, 0, 210, 297, undefined, 'MEDIUM');
    }

    const patientName = (extracted.patient_name || 'Report').replace(/[^a-zA-Z0-9\s]/g, '').trim();
    const regDate = extracted.reg_date || extracted.report_date || new Date().toISOString().split('T')[0];
    const fileName = `${patientName}_${regDate}.pdf`;

    return { blob: pdf.output('blob'), fileName };
  };

  const handleDownloadClick = () => {
    setMobileNumber("");
    setMobileDialogOpen(true);
  };

  const formatWhatsApp = (raw: string): string => {
    const digits = raw.replace(/\D/g, "");
    return digits.slice(-10);
  };

  const handleMobileSubmit = async () => {
    const cleaned = formatWhatsApp(mobileNumber);
    if (cleaned.length < 10) {
      toast({ title: "Please enter a valid 10-digit mobile number", variant: "destructive" });
      return;
    }

    setMobileDialogOpen(false);
    setDownloading(true);
    setIsPdfExporting(true);

    try {
      const result = await generatePdfBlob();
      if (result) {
        // Download PDF
        const url = URL.createObjectURL(result.blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = result.fileName;
        a.click();
        URL.revokeObjectURL(url);

        // Save mobile number to database
        if (reportId) {
          await supabase.from("uploaded_reports").update({ mobile_number: cleaned } as any).eq("id", reportId);
        }

        // Share on WhatsApp
        const patientName = extracted?.patient_name || "Patient";
        const message = `Dear ${patientName},\n\nYour lab report is ready. Please find the report shared with this message.\n\nThank you.`;
        shareOnWhatsApp(cleaned, message);

        toast({ title: "Report shared on WhatsApp" });
      }
    } catch (err) {
      console.error('PDF download failed:', err);
    } finally {
      setIsPdfExporting(false);
      setDownloading(false);
    }
  };

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
    // Sort by department display_order
    const sorted: Record<string, Record<string, TestResult[]>> = {};
    Object.keys(grouped)
      .sort((a, b) => (deptOrderMap[a] ?? 999) - (deptOrderMap[b] ?? 999))
      .forEach(dept => { sorted[dept] = grouped[dept]; });
    return sorted;
  };

  const shouldShowProfile = (params: TestResult[]) => params.length >= 2;

  const topMarginMm = layoutSettings.top_margin_cm * 10;
  const bottomMarginMm = layoutSettings.bottom_margin_cm * 10;
  const PAGE_HEIGHT_MM = 297;
  const usableHeight = PAGE_HEIGHT_MM - topMarginMm - bottomMarginMm - HEADER_HEIGHT_MM - SIGNATURE_HEIGHT_MM - PAGE_NUM_HEIGHT_MM;

  // Count unique test_names in params for height estimation
  const countTestNameHeaders = (params: TestResult[]): number => {
    const testNames = new Set(params.map(r => r.test_name).filter(Boolean));
    return testNames.size > 1 ? testNames.size : (testNames.size === 1 ? 1 : 0);
  };

  // Build sections for each approver group
  const buildSections = (approverResults: TestResult[], includeAbnormalSummary: boolean): PageSection[] => {
    const sections: PageSection[] = [];

    if (includeAbnormalSummary) {
      const allAbnormals = results.filter(r => r.flag === "H" || r.flag === "L");
      if (allAbnormals.length > 0) {
        // Split abnormal summary into chunks that fit on pages (no signature needed)
        const abnormalUsableHeight = PAGE_HEIGHT_MM - topMarginMm - bottomMarginMm - HEADER_HEIGHT_MM - PAGE_NUM_HEIGHT_MM;
        const maxRowsPerPage = Math.floor((abnormalUsableHeight - ABNORMAL_SUMMARY_BASE_MM) / ABNORMAL_ROW_MM);
        
        for (let i = 0; i < allAbnormals.length; i += maxRowsPerPage) {
          const chunk = allAbnormals.slice(i, i + maxRowsPerPage);
          sections.push({
            type: "abnormal-summary",
            abnormals: chunk,
            estimatedHeightMm: ABNORMAL_SUMMARY_BASE_MM + chunk.length * ABNORMAL_ROW_MM,
            isAbnormalOnly: true,
          });
        }
      }
    }

    const grouped = groupResults(approverResults);
    Object.entries(grouped).forEach(([dept, profiles]) => {
      Object.entries(profiles).forEach(([profName, params]) => {
        const showProf = profName !== "_individual" && shouldShowProfile(params);
        const testNameHeaders = countTestNameHeaders(params);
        const compact = isCompactProfile(profName) || isCompactProfile(dept);
        const rowH = compact ? ROW_HEIGHT_COMPACT_MM : ROW_HEIGHT_MM;
        const heightMm = DEPT_HEADER_HEIGHT_MM + (showProf ? PROFILE_HEADER_HEIGHT_MM : 0) + TABLE_HEADER_HEIGHT_MM + params.length * rowH + testNameHeaders * TEST_NAME_HEADER_MM + PROFILE_GAP_MM;
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
      const pageUsable = section.isAbnormalOnly
        ? (PAGE_HEIGHT_MM - topMarginMm - bottomMarginMm - HEADER_HEIGHT_MM - PAGE_NUM_HEIGHT_MM)
        : usableHeight;

      // Abnormal summary pages are dedicated — nothing else shares the page
      if (section.isAbnormalOnly) {
        if (currentPage.length > 0) {
          pages.push(currentPage);
          currentPage = [];
          currentHeight = 0;
        }
        pages.push([section]);
        return;
      }

      // CBC / Urine profiles always get their own dedicated page
      if (isDedicatedReportProfile(section)) {
        if (currentPage.length > 0) {
          pages.push(currentPage);
          currentPage = [];
          currentHeight = 0;
        }

        pages.push([section]);
        return;
      }

      if (currentHeight + section.estimatedHeightMm > pageUsable && currentPage.length > 0) {
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
    const seenDepts = new Set<string>();
    return sections.map((section, idx) => {
      if (section.type === "abnormal-summary" && section.abnormals) {
        return <ReportAbnormalSummary key={`abnormal-${idx}`} abnormalResults={section.abnormals} />;
      }
      if (section.type === "department-profile" && section.results && section.dept) {
        const showDeptHeader = !seenDepts.has(section.dept);
        seenDepts.add(section.dept);
        const grouped: Record<string, Record<string, TestResult[]>> = {
          [section.dept]: { [section.profName || "_individual"]: section.results },
        };
        return (
          <div key={`${section.dept}-${section.profName}-${idx}`} style={{ marginBottom: `${PROFILE_GAP_MM}mm` }}>
            <ReportResultsSection grouped={grouped} shouldShowProfile={shouldShowProfile} hideDeptHeader={!showDeptHeader} />
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
        <Button size="sm" variant="outline" onClick={handleDownloadClick} disabled={downloading}>
          {downloading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Download className="h-4 w-4 mr-1" />}
          {downloading ? "Downloading..." : "Download PDF"}
        </Button>
        <div className="flex items-center gap-2">
          <Switch id="show-header" checked={showHeader} onCheckedChange={setShowHeader} />
          <Label htmlFor="show-header" className="text-sm cursor-pointer">
            {showHeader ? "With Letterhead" : "Without Letterhead"}
          </Label>
        </div>
      </div>

      <div ref={printRef} className={`bg-white text-black print:text-black mx-auto max-w-[210mm] print:max-w-none report-print-area ${isPdfExporting ? 'pdf-export-mode' : ''}`} style={{ fontFamily: "'Segoe UI', Arial, sans-serif" }}>
        {allPages.map((page, pageIdx) => {
          const isAbnormalOnlyPage = page.sections.every(s => s.isAbnormalOnly);
          const contentBottomReserveMm = isAbnormalOnlyPage
            ? (PAGE_NUM_HEIGHT_MM + 2)
            : (SIGNATURE_HEIGHT_MM + PAGE_NUM_HEIGHT_MM + 4);
          const pathologist = findPathologistSig(page.approverName);
          const sigUrl = pathologist?.signature_image_path
            ? supabase.storage.from("signatures").getPublicUrl(pathologist.signature_image_path).data.publicUrl
            : null;

          return (
            <div key={pageIdx} className="report-page"
              style={{ paddingTop: `${topMarginMm}mm`, paddingBottom: `${bottomMarginMm}mm` }}>
              
              <ReportHeader extracted={extracted} />

              <div className="space-y-1" style={{ paddingLeft: '12mm', paddingRight: '12mm', paddingBottom: `${contentBottomReserveMm}mm` }}>
                {renderPageSections(page.sections)}
              </div>

              {!isAbnormalOnlyPage && (
                <div style={{ position: 'absolute', bottom: `${bottomMarginMm + PAGE_NUM_HEIGHT_MM + 1}mm`, left: '12mm', right: '12mm' }}>
                  <ReportSignatureBlock
                    signatureUrl={sigUrl}
                    pathologistName={pathologist?.pathologist_name || page.approverName}
                    qualification={pathologist?.qualification}
                    designation={pathologist?.designation}
                  />
                </div>
              )}

              <div className="page-number-footer" style={{ position: 'absolute', bottom: `${bottomMarginMm + 2}mm`, left: 0, right: 0, textAlign: 'center', fontSize: '9px', color: '#666' }}>
                Page {pageIdx + 1} of {totalPages}
              </div>
            </div>
          );
        })}

        {hasTrends && (
          <div className="report-page" style={{ paddingTop: `${topMarginMm}mm`, paddingBottom: `${bottomMarginMm}mm` }}>
            <ReportHeader extracted={extracted} />
            <div style={{ paddingLeft: '12mm', paddingRight: '12mm' }}>
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

        .pdf-export-mode .report-page {
          height: 297mm !important;
          max-height: 297mm !important;
          width: 210mm !important;
          margin: 0 auto !important;
          border: 0 !important;
          overflow: hidden !important;
        }
        .pdf-export-mode .recharts-tooltip-wrapper {
          display: none !important;
          visibility: hidden !important;
        }
        .pdf-export-mode .flag-badge {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-width: 14px;
          height: 14px;
          line-height: 1 !important;
          font-size: 10px !important;
          font-weight: 700;
          font-family: 'Segoe UI', Arial, sans-serif;
        }
        .pdf-export-mode .trend-chart-box {
          padding-bottom: 8px !important;
        }
        .pdf-export-mode .trend-chart-detail-row {
          padding-bottom: 2px !important;
        }
        .pdf-export-mode .trend-chart-detail-item span {
          line-height: 1.25 !important;
        }
        ${showHeader && letterheadImageUrl ? `
        .pdf-export-mode .report-page {
          background-image: url("${letterheadImageUrl}");
          background-size: 210mm 297mm;
          background-repeat: no-repeat;
          background-position: top center;
        }
        ` : ''}
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

      <Dialog open={mobileDialogOpen} onOpenChange={setMobileDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Share Report on WhatsApp</DialogTitle>
            <DialogDescription>Enter the patient's mobile number to share this report.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="mobile-input">Mobile Number</Label>
            <Input
              id="mobile-input"
              placeholder="Paste number (any format)"
              type="tel"
              value={mobileNumber}
              onChange={(e) => setMobileNumber(e.target.value)}
              inputMode="numeric"
              onWheel={(e) => (e.target as HTMLInputElement).blur()}
            />
            {mobileNumber && (
              <p className="text-xs text-muted-foreground mt-1">
                Formatted: {formatWhatsApp(mobileNumber) || "Need 10+ digits"}
              </p>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setMobileDialogOpen(false)}>Skip</Button>
            <Button onClick={handleMobileSubmit} disabled={formatWhatsApp(mobileNumber).length !== 10}>
              Share on WhatsApp
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ViewReport;
