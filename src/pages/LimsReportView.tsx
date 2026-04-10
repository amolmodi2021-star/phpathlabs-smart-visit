import { useState, useEffect, useRef, useMemo } from "react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Loader2, Printer, ArrowLeft, Download } from "lucide-react";
import { toPng } from "html-to-image";
import jsPDF from "jspdf";
import * as pdfjsLib from "pdfjs-dist";
import LimsReportHeader from "@/components/report/LimsReportHeader";
import ReportSignatureBlock from "@/components/report/ReportSignatureBlock";
import { toast } from "sonner";

pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

// ── Height constants (mm) ──
const PAGE_HEIGHT_MM = 297;
const PAGE_WIDTH_MM = 210;
const HEADER_HEIGHT_MM = 28;
const SIGNATURE_HEIGHT_MM = 16;
const PAGE_NUM_HEIGHT_MM = 6;
const DEPT_HEADER_MM = 8;
const TEST_HEADER_MM = 6;
const TABLE_HEADER_MM = 5;
const ROW_HEIGHT_MM = 4.5;
const INTERPRETATION_MM = 8;
const META_LINE_MM = 4;
const GAP_MM = 3;

interface TestResultEntry {
  test_id: string;
  test_name: string;
  parameter_id: string;
  parameter_name: string;
  result_value: string;
  unit: string | null;
  reference_range: string | null;
  flag: string | null;
  normal_range_low: number | null;
  normal_range_high: number | null;
  is_outsourced?: boolean;
  outsource_lab_name?: string | null;
  param_code?: string;
  is_calculated?: boolean;
}

interface TestBlock {
  testId: string;
  testName: string;
  departmentId: string | null;
  departmentName: string;
  departmentOrder: number;
  params: TestResultEntry[];
  instrument?: string | null;
  method?: string | null;
  sampleType?: string | null;
  interpretation?: string | null;
  estimatedHeightMm: number;
}

interface SnipPage {
  imageUrl: string;
}

interface PageContent {
  type: "structured" | "snip";
  departmentName?: string;
  testBlocks?: TestBlock[];
  snipImage?: string;
}

const LimsReportView = () => {
  const { registrationId } = useParams();
  const navigate = useNavigate();
  const printRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [showLetterhead, setShowLetterhead] = useState(true);

  // Data
  const [approvedReports, setApprovedReports] = useState<any[]>([]);
  const [registration, setRegistration] = useState<any>(null);
  const [layoutSettings, setLayoutSettings] = useState({ top_margin_cm: 2.5, bottom_margin_cm: 1.5, letterhead_pdf_path: null as string | null });
  const [letterheadImageUrl, setLetterheadImageUrl] = useState<string | null>(null);
  const [signatureData, setSignatureData] = useState<any>(null);
  const [departments, setDepartments] = useState<any[]>([]);
  const [testsMap, setTestsMap] = useState<Record<string, any>>({});
  const [testParamsMap, setTestParamsMap] = useState<Record<string, any[]>>({});
  const [snipImages, setSnipImages] = useState<SnipPage[]>([]);

  useEffect(() => { if (registrationId) loadAllData(); }, [registrationId]);

  const convertPdfToImage = async (pdfUrl: string) => {
    try {
      const response = await fetch(pdfUrl);
      const arrayBuffer = await response.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      const page = await pdf.getPage(1);
      const viewport = page.getViewport({ scale: 2 });
      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      await page.render({ canvasContext: ctx, viewport }).promise;
      return canvas.toDataURL("image/png");
    } catch (err) {
      console.error("Failed to convert letterhead PDF to image:", err);
      return null;
    }
  };

  const loadAllData = async () => {
    setLoading(true);

    // Parallel fetches
    const [
      { data: reports },
      { data: regData },
      { data: layout },
      { data: depts },
      { data: allTests },
      { data: snips },
      { data: signatures },
    ] = await Promise.all([
      supabase.from("approved_reports").select("*").eq("registration_id", registrationId),
      supabase.from("patient_registrations").select("*").eq("id", registrationId).single(),
      supabase.from("report_layout_settings").select("*").limit(1).single(),
      supabase.from("report_departments").select("*").order("display_order", { ascending: true }),
      supabase.from("tests").select("id, test_name, department_id, instrument_name, method, sample_type, interpretation, is_outsourced, display_name, bold_in_report, show_in_report"),
      supabase.from("outsourced_test_snips").select("*").eq("registration_id", registrationId),
      supabase.from("pathologist_signatures").select("*"),
    ]);

    setApprovedReports(reports || []);
    setRegistration(regData);
    setDepartments(depts || []);

    // Tests map
    const tMap: Record<string, any> = {};
    (allTests || []).forEach((t: any) => { tMap[t.id] = t; });
    setTestsMap(tMap);

    // Layout
    if (layout) {
      const ls = {
        top_margin_cm: Number(layout.top_margin_cm) || 2.5,
        bottom_margin_cm: Number(layout.bottom_margin_cm) || 1.5,
        letterhead_pdf_path: layout.letterhead_pdf_path || null,
      };
      setLayoutSettings(ls);
      if (ls.letterhead_pdf_path) {
        const { data: urlData } = supabase.storage.from("letterheads").getPublicUrl(ls.letterhead_pdf_path);
        const img = await convertPdfToImage(urlData.publicUrl);
        setLetterheadImageUrl(img);
      }
    }

    // Signature - use first approved_by name match
    const approvedBy = reports?.[0]?.approved_by;
    if (approvedBy && signatures) {
      const sig = signatures.find((s: any) => s.pathologist_name.toLowerCase() === approvedBy.toLowerCase());
      if (sig && sig.signature_image_path) {
        const { data: sigUrl } = supabase.storage.from("signatures").getPublicUrl(sig.signature_image_path);
        setSignatureData({ ...sig, signatureUrl: sigUrl.publicUrl });
      } else if (sig) {
        setSignatureData(sig);
      } else {
        setSignatureData(signatures[0] ? { ...signatures[0] } : null);
      }
    } else if (signatures && signatures.length > 0) {
      const first = signatures[0];
      if (first.signature_image_path) {
        const { data: sigUrl } = supabase.storage.from("signatures").getPublicUrl(first.signature_image_path);
        setSignatureData({ ...first, signatureUrl: sigUrl.publicUrl });
      } else {
        setSignatureData(first);
      }
    }

    // Snip images - collect all snip-only tests (tests with snip images)
    const snipPages: SnipPage[] = [];
    (snips || []).forEach((s: any) => {
      const urls = Array.isArray(s.snip_image_urls) ? s.snip_image_urls : [];
      if (s.result_mode === "snip" || urls.length > 0) {
        urls.forEach((url: string) => snipPages.push({ imageUrl: url }));
      }
    });
    setSnipImages(snipPages);

    // Fetch test_parameters for hierarchy
    const uniqueTestIds = [...new Set((reports || []).flatMap((r: any) =>
      ((r.test_results || []) as TestResultEntry[]).map(tr => tr.test_id)
    ))];
    if (uniqueTestIds.length > 0) {
      const { data: tpData } = await supabase
        .from("test_parameters")
        .select("test_id, parameter_id, display_order, is_subheader, subheader_text")
        .in("test_id", uniqueTestIds)
        .order("display_order", { ascending: true });
      const tpMap: Record<string, any[]> = {};
      (tpData || []).forEach((tp: any) => {
        if (!tpMap[tp.test_id]) tpMap[tp.test_id] = [];
        tpMap[tp.test_id].push(tp);
      });
      setTestParamsMap(tpMap);
    }

    setLoading(false);
  };

  // ── Build structured content ──
  const { pages, totalPages } = useMemo(() => {
    if (approvedReports.length === 0) return { pages: [] as PageContent[], totalPages: 0 };

    const topMm = (layoutSettings.top_margin_cm || 2.5) * 10;
    const bottomMm = (layoutSettings.bottom_margin_cm || 1.5) * 10;
    const usableHeight = PAGE_HEIGHT_MM - topMm - bottomMm - HEADER_HEIGHT_MM - SIGNATURE_HEIGHT_MM - PAGE_NUM_HEIGHT_MM;

    // Merge all test_results from all approved reports
    const allResults: TestResultEntry[] = [];
    approvedReports.forEach((report: any) => {
      const results = (report.test_results || []) as TestResultEntry[];
      results.forEach(r => {
        if (r.result_value && r.result_value.toString().trim()) {
          allResults.push(r);
        }
      });
    });

    // Department order map
    const deptOrderMap: Record<string, number> = {};
    const deptNameMap: Record<string, string> = {};
    departments.forEach((d: any) => {
      deptOrderMap[d.id] = d.display_order ?? 999;
      deptNameMap[d.id] = d.department_name;
    });

    // Group by test
    const testGroups: Record<string, TestResultEntry[]> = {};
    allResults.forEach(r => {
      if (!testGroups[r.test_id]) testGroups[r.test_id] = [];
      testGroups[r.test_id].push(r);
    });

    // Build test blocks
    const testBlocks: TestBlock[] = [];
    Object.entries(testGroups).forEach(([testId, params]) => {
      const testInfo = testsMap[testId];
      const deptId = testInfo?.department_id || null;
      const deptName = deptId ? (deptNameMap[deptId] || "Other") : "Other";
      const deptOrder = deptId ? (deptOrderMap[deptId] ?? 999) : 999;

      // Sort params by test_parameters display_order
      const tpOrder = testParamsMap[testId] || [];
      const orderMap: Record<string, number> = {};
      tpOrder.forEach((tp: any) => { orderMap[tp.parameter_id] = tp.display_order; });

      // Insert subheaders
      const sortedParams = [...params].sort((a, b) => {
        return (orderMap[a.parameter_id] ?? 999) - (orderMap[b.parameter_id] ?? 999);
      });

      // Calculate estimated height
      const paramCount = sortedParams.length;
      const subheaderCount = tpOrder.filter((tp: any) => tp.is_subheader).length;
      let heightMm = TEST_HEADER_MM + TABLE_HEADER_MM + (paramCount * ROW_HEIGHT_MM) + (subheaderCount * ROW_HEIGHT_MM) + GAP_MM;
      if (testInfo?.interpretation) heightMm += INTERPRETATION_MM;
      if (testInfo?.instrument_name || testInfo?.method || testInfo?.sample_type) heightMm += META_LINE_MM;

      testBlocks.push({
        testId,
        testName: params[0]?.test_name || testInfo?.test_name || "Unknown Test",
        departmentId: deptId,
        departmentName: deptName,
        departmentOrder: deptOrder,
        params: sortedParams,
        instrument: testInfo?.instrument_name,
        method: testInfo?.method,
        sampleType: testInfo?.sample_type,
        interpretation: testInfo?.interpretation,
        estimatedHeightMm: heightMm,
      });
    });

    // Sort by department order, then test name
    testBlocks.sort((a, b) => {
      if (a.departmentOrder !== b.departmentOrder) return a.departmentOrder - b.departmentOrder;
      return a.testName.localeCompare(b.testName);
    });

    // Group by department
    const deptGroups: Record<string, TestBlock[]> = {};
    testBlocks.forEach(tb => {
      if (!deptGroups[tb.departmentName]) deptGroups[tb.departmentName] = [];
      deptGroups[tb.departmentName].push(tb);
    });

    // Build pages - each department starts a new page
    const allPages: PageContent[] = [];

    Object.entries(deptGroups).forEach(([deptName, blocks]) => {
      let currentPageBlocks: TestBlock[] = [];
      let usedHeight = DEPT_HEADER_MM;

      blocks.forEach(block => {
        if (currentPageBlocks.length > 0 && (usedHeight + block.estimatedHeightMm) > usableHeight) {
          // Flush current page
          allPages.push({ type: "structured", departmentName: deptName, testBlocks: currentPageBlocks });
          currentPageBlocks = [];
          usedHeight = DEPT_HEADER_MM;
        }
        currentPageBlocks.push(block);
        usedHeight += block.estimatedHeightMm;
      });

      if (currentPageBlocks.length > 0) {
        allPages.push({ type: "structured", departmentName: deptName, testBlocks: currentPageBlocks });
      }
    });

    // Add snip pages
    snipImages.forEach(snip => {
      allPages.push({ type: "snip", snipImage: snip.imageUrl });
    });

    return { pages: allPages, totalPages: allPages.length };
  }, [approvedReports, departments, testsMap, testParamsMap, snipImages, layoutSettings]);

  // ── PDF export ──
  const handleDownloadPdf = async () => {
    if (!printRef.current) return;
    setDownloading(true);
    try {
      const pageElements = printRef.current.querySelectorAll("[data-page]");
      if (pageElements.length === 0) { toast.error("No pages to export"); setDownloading(false); return; }

      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      for (let i = 0; i < pageElements.length; i++) {
        if (i > 0) pdf.addPage();
        const el = pageElements[i] as HTMLElement;
        const png = await toPng(el, { quality: 1, pixelRatio: 2, backgroundColor: "#ffffff" });
        pdf.addImage(png, "PNG", 0, 0, PAGE_WIDTH_MM, PAGE_HEIGHT_MM);
      }

      const patientName = approvedReports[0]?.patient_name || "Report";
      const invoiceNum = approvedReports[0]?.invoice_number || "";
      pdf.save(`${patientName}_${invoiceNum}.pdf`);

      // Update print_date
      if (registrationId) {
        await supabase.from("approved_reports").update({ print_date: new Date().toISOString() }).eq("registration_id", registrationId);
      }

      toast.success("PDF downloaded successfully");
    } catch (err: any) {
      toast.error("PDF export failed: " + (err.message || "Unknown error"));
    }
    setDownloading(false);
  };

  const report = approvedReports[0];
  const topMm = (layoutSettings.top_margin_cm || 2.5) * 10;
  const bottomMm = (layoutSettings.bottom_margin_cm || 1.5) * 10;

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <span className="ml-2 text-lg">Loading report...</span>
      </div>
    );
  }

  if (!report) {
    return (
      <div className="p-6 space-y-4">
        <Button variant="outline" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-4 w-4 mr-1" />Back
        </Button>
        <div className="text-center py-12 text-muted-foreground">
          <p className="text-lg font-medium">No approved reports found</p>
          <p className="text-sm">This registration has no approved test results yet.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      {/* Toolbar */}
      <div className="flex items-center gap-3 print:hidden">
        <Button variant="outline" size="sm" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-4 w-4 mr-1" />Back
        </Button>
        <h1 className="text-xl font-bold">
          Report — {report.patient_name} ({report.invoice_number})
        </h1>
        <div className="ml-auto flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Switch id="letterhead-toggle" checked={showLetterhead} onCheckedChange={setShowLetterhead} />
            <Label htmlFor="letterhead-toggle" className="text-sm cursor-pointer">With Letterhead</Label>
          </div>
          <Button size="sm" variant="outline" onClick={() => window.print()}>
            <Printer className="h-4 w-4 mr-1" />Print
          </Button>
          <Button size="sm" onClick={handleDownloadPdf} disabled={downloading}>
            {downloading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Download className="h-4 w-4 mr-1" />}
            Download PDF
          </Button>
        </div>
      </div>

      {/* Rendered Pages */}
      <div ref={printRef} id="print-container" className="flex flex-col items-center gap-4">
        {pages.map((page, pageIdx) => (
          <div
            key={pageIdx}
            data-page={pageIdx}
            className="bg-white shadow-lg relative overflow-hidden"
            style={{
              width: `${PAGE_WIDTH_MM}mm`,
              height: `${PAGE_HEIGHT_MM}mm`,
              minHeight: `${PAGE_HEIGHT_MM}mm`,
              maxHeight: `${PAGE_HEIGHT_MM}mm`,
            }}
          >
            {/* Background letterhead */}
            {letterheadImageUrl && showLetterhead && (
              <img
                src={letterheadImageUrl}
                alt=""
                className="absolute inset-0 w-full h-full object-cover pointer-events-none"
                style={{ zIndex: 0 }}
              />
            )}

            {/* Content layer */}
            <div className="relative" style={{ zIndex: 1, paddingTop: `${topMm}mm`, paddingBottom: `${bottomMm}mm`, paddingLeft: "8mm", paddingRight: "8mm", height: "100%", display: "flex", flexDirection: "column" }}>
              {/* Patient Demographics */}
              <LimsReportHeader
                patientName={report.patient_name}
                title={report.title}
                gender={report.gender}
                dob={report.dob}
                umrNumber={report.umr_number}
                doctorName={report.doctor_name}
                mobileNumber={report.mobile_number}
                email={report.email}
                address={report.address}
                invoiceNumber={report.invoice_number}
                registrationDate={report.registration_date}
                sampleCollectionDate={report.sample_collection_date}
                approvalDate={report.approval_date}
                printDate={report.print_date}
                visitType={report.visit_type}
              />

              {/* Main Content Area */}
              <div className="flex-1 overflow-hidden" style={{ fontSize: "9px" }}>
                {page.type === "structured" && (
                  <div>
                    {/* Department Header */}
                    {page.departmentName && (
                      <div className="text-center font-bold border-b border-t py-1 mb-1" style={{ fontSize: "11px" }}>
                        {page.departmentName}
                      </div>
                    )}

                    {/* Test Blocks */}
                    {page.testBlocks?.map((block, bi) => (
                      <div key={bi} className="mb-2">
                        {/* Test Name Header */}
                        <div className="font-bold py-0.5 border-b" style={{ fontSize: "10px" }}>
                          {block.testName}
                          {block.sampleType && <span className="font-normal text-gray-500 ml-2">(Sample: {block.sampleType})</span>}
                        </div>

                        {/* Metadata */}
                        {(block.instrument || block.method) && (
                          <div className="text-gray-500 py-0.5" style={{ fontSize: "8px" }}>
                            {block.instrument && <span>Instrument: {block.instrument}</span>}
                            {block.instrument && block.method && <span className="mx-2">|</span>}
                            {block.method && <span>Method: {block.method}</span>}
                          </div>
                        )}

                        {/* Parameter Table */}
                        <table className="w-full border-collapse" style={{ fontSize: "9px" }}>
                          <thead>
                            <tr className="border-b" style={{ fontSize: "8px" }}>
                              <th className="text-left py-0.5 font-semibold w-[35%]">Parameter</th>
                              <th className="text-center py-0.5 font-semibold w-[15%]">Result</th>
                              <th className="text-center py-0.5 font-semibold w-[10%]">Unit</th>
                              <th className="text-center py-0.5 font-semibold w-[25%]">Reference Range</th>
                              <th className="text-center py-0.5 font-semibold w-[15%]">Flag</th>
                            </tr>
                          </thead>
                          <tbody>
                            {renderParamsWithSubheaders(block, testParamsMap[block.testId] || [])}
                          </tbody>
                        </table>

                        {/* Interpretation */}
                        {block.interpretation && (
                          <div className="mt-1 p-1 bg-gray-50 border rounded text-gray-700" style={{ fontSize: "8px" }}>
                            <span className="font-semibold">Interpretation: </span>
                            {block.interpretation}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {page.type === "snip" && page.snipImage && (
                  <div className="flex items-start justify-center h-full pt-1">
                    <img
                      src={page.snipImage}
                      alt="Outsourced Report"
                      className="max-w-full object-contain"
                      style={{
                        maxHeight: `${PAGE_HEIGHT_MM - topMm - bottomMm - HEADER_HEIGHT_MM - SIGNATURE_HEIGHT_MM - PAGE_NUM_HEIGHT_MM - 4}mm`,
                      }}
                    />
                  </div>
                )}
              </div>

              {/* Signature */}
              <div className="mt-auto">
                {signatureData && (
                  <ReportSignatureBlock
                    signatureUrl={signatureData.signatureUrl || null}
                    pathologistName={signatureData.pathologist_name}
                    qualification={signatureData.qualification}
                    designation={signatureData.designation}
                  />
                )}
                {/* Page Number */}
                <div className="text-center text-gray-400 mt-0.5" style={{ fontSize: "7px" }}>
                  Page {pageIdx + 1} of {totalPages}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Print styles */}
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #print-container, #print-container * { visibility: visible; }
          #print-container {
            position: absolute;
            left: 0;
            top: 0;
            width: 210mm;
          }
          [data-page] {
            position: relative;
            display: block;
            width: 210mm !important;
            height: 297mm !important;
            page-break-after: always;
            break-after: page;
            margin: 0 !important;
            padding: 0 !important;
            box-shadow: none !important;
            overflow: hidden;
          }
          @page { size: A4; margin: 0; }
          .print\\:hidden { display: none !important; }
        }
      `}</style>
    </div>
  );
};

function renderParamsWithSubheaders(block: TestBlock, tpOrder: any[]) {
  const rows: JSX.Element[] = [];
  const paramById: Record<string, TestResultEntry> = {};
  block.params.forEach(p => { paramById[p.parameter_id] = p; });

  if (tpOrder.length > 0) {
    tpOrder.forEach((tp, i) => {
      if (tp.is_subheader && tp.subheader_text) {
        rows.push(
          <tr key={`sh-${i}`}>
            <td colSpan={5} className="font-semibold pt-1 pb-0.5 text-gray-700 border-b" style={{ fontSize: "9px" }}>
              {tp.subheader_text}
            </td>
          </tr>
        );
      } else {
        const param = paramById[tp.parameter_id];
        if (param) {
          rows.push(renderParamRow(param, `tp-${i}`));
          delete paramById[tp.parameter_id]; // Mark as used
        }
      }
    });
    // Render any remaining params not in test_parameters
    Object.values(paramById).forEach((param, i) => {
      rows.push(renderParamRow(param, `extra-${i}`));
    });
  } else {
    block.params.forEach((param, i) => {
      rows.push(renderParamRow(param, `p-${i}`));
    });
  }

  return rows;
}

function renderParamRow(param: TestResultEntry, key: string) {
  const isAbnormal = param.flag && param.flag !== "N" && param.flag !== "Normal";
  return (
    <tr key={key} className={`border-b border-gray-100 ${isAbnormal ? "font-bold" : ""}`}>
      <td className="py-0.5 pl-1">{param.parameter_name}</td>
      <td className={`text-center py-0.5 ${isAbnormal ? "text-red-600" : ""}`}>
        {param.result_value}
      </td>
      <td className="text-center py-0.5 text-gray-500">{param.unit || ""}</td>
      <td className="text-center py-0.5 text-gray-500">{param.reference_range || ""}</td>
      <td className="text-center py-0.5">
        {param.flag && param.flag !== "N" && param.flag !== "Normal" && (
          <span className={`text-xs font-bold ${param.flag === "H" || param.flag === "High" ? "text-red-600" : "text-blue-600"}`}>
            {param.flag === "H" ? "HIGH" : param.flag === "L" ? "LOW" : param.flag}
          </span>
        )}
      </td>
    </tr>
  );
}

export default LimsReportView;
