import { useState, useEffect, useRef, useMemo } from "react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Loader2, Printer, ArrowLeft, Download } from "lucide-react";
import { toPng } from "html-to-image";
import jsPDF from "jspdf";
import * as pdfjsLib from "pdfjs-dist";
import LimsReportHeader from "@/components/report/LimsReportHeader";
import ReportSignatureBlock from "@/components/report/ReportSignatureBlock";
import ReportResultsSection from "@/components/report/ReportResultsSection";
import type { TestResult, ProfileMeta } from "@/components/report/ReportResultsSection";
import { toast } from "sonner";

pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

// ── Height constants (mm) ──
const PAGE_HEIGHT_MM = 297;
const PAGE_WIDTH_MM = 210;
const HEADER_HEIGHT_MM = 28;
const SIGNATURE_HEIGHT_MM = 16;
const PAGE_NUM_HEIGHT_MM = 6;
const DEPT_HEADER_MM = 10;
const TEST_HEADER_MM = 8;
const TABLE_HEADER_MM = 7;
const ROW_HEIGHT_MM = 5.5;
const INTERPRETATION_MM = 10;
const META_LINE_MM = 5;
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
  fitToPage?: boolean;
  dedicatedPage?: boolean;
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
  const [searchParams] = useSearchParams();
  const selectedTestIdsParam = searchParams.get("tests");
  const selectedTestIds = selectedTestIdsParam ? new Set(selectedTestIdsParam.split(",")) : null;
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
      supabase.from("tests").select("id, test_name, department_id, instrument_name, method, sample_type, interpretation, is_outsourced, display_name, bold_in_report, show_in_report, fit_to_page, dedicated_page"),
      supabase.from("outsourced_test_snips").select("*").eq("registration_id", registrationId),
      supabase.from("pathologist_signatures").select("*"),
    ]);

    // Filter approved reports test_results by selected test IDs if provided
    const filteredReports = (reports || []).map((r: any) => {
      if (!selectedTestIds) return r;
      return {
        ...r,
        test_results: ((r.test_results || []) as any[]).filter((tr: any) => selectedTestIds.has(tr.test_id)),
      };
    });
    setApprovedReports(filteredReports);
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

    // Snip images - collect all snip-only tests (tests with snip images), filtered by selected test IDs
    const snipPages: SnipPage[] = [];
    (snips || []).forEach((s: any) => {
      if (selectedTestIds && !selectedTestIds.has(s.test_id)) return;
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
        fitToPage: testInfo?.fit_to_page ?? false,
        dedicatedPage: testInfo?.dedicated_page ?? false,
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
        // Dedicated page: flush current, put this block alone on its own page
        if (block.dedicatedPage) {
          if (currentPageBlocks.length > 0) {
            allPages.push({ type: "structured", departmentName: deptName, testBlocks: currentPageBlocks });
            currentPageBlocks = [];
            usedHeight = DEPT_HEADER_MM;
          }
          allPages.push({ type: "structured", departmentName: deptName, testBlocks: [block] });
          return;
        }

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

  // ── Image-based Print ──
  const handlePrint = async () => {
    if (!printRef.current) return;
    setDownloading(true);
    try {
      // Always print without letterhead
      const originalLetterhead = showLetterhead;
      setShowLetterhead(false);
      await new Promise(r => setTimeout(r, 150));

      const pageElements = printRef.current.querySelectorAll("[data-page]");
      if (pageElements.length === 0) { toast.error("No pages to print"); setShowLetterhead(originalLetterhead); setDownloading(false); return; }

      const imageUrls: string[] = [];
      for (let i = 0; i < pageElements.length; i++) {
        const el = pageElements[i] as HTMLElement;
        const png = await toPng(el, { quality: 1, pixelRatio: 2, backgroundColor: "#ffffff" });
        imageUrls.push(png);
      }

      // Restore letterhead state after capturing
      setShowLetterhead(originalLetterhead);

      // Create hidden iframe for printing (no new tab)
      const iframe = document.createElement("iframe");
      iframe.style.position = "fixed";
      iframe.style.top = "-10000px";
      iframe.style.left = "-10000px";
      iframe.style.width = "210mm";
      iframe.style.height = "297mm";
      iframe.style.border = "none";
      document.body.appendChild(iframe);

      const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
      if (!iframeDoc || !iframe.contentWindow) {
        toast.error("Print failed");
        document.body.removeChild(iframe);
        setDownloading(false);
        return;
      }

      iframeDoc.open();
      iframeDoc.write(`
        <html>
          <head>
            <style>
              @page { size: A4; margin: 0; }
              * { margin: 0; padding: 0; box-sizing: border-box; }
              body { width: 210mm; }
              .print-page { width: 210mm; height: 297mm; overflow: hidden; page-break-after: always; display: block; }
              .print-page:last-child { page-break-after: auto; }
              .print-page img { display: block; width: 210mm; height: 297mm; }
            </style>
          </head>
          <body>
            ${imageUrls.map(url => `<div class="print-page"><img src="${url}" /></div>`).join("")}
          </body>
        </html>
      `);
      iframeDoc.close();

      const images = iframeDoc.querySelectorAll(".print-page img");
      let loadedCount = 0;
      const onAllLoaded = () => {
        setTimeout(() => {
          iframe.contentWindow!.focus();
          iframe.contentWindow!.print();
          setTimeout(() => { try { document.body.removeChild(iframe); } catch(e) {} }, 1000);
        }, 300);
      };

      if (images.length === 0) { onAllLoaded(); }
      else {
        images.forEach(img => {
          (img as HTMLImageElement).onload = () => { loadedCount++; if (loadedCount === images.length) onAllLoaded(); };
          (img as HTMLImageElement).onerror = () => { loadedCount++; if (loadedCount === images.length) onAllLoaded(); };
        });
      }
    } catch (err: any) {
      toast.error("Print failed: " + (err.message || "Unknown error"));
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
          <Button size="sm" variant="outline" onClick={handlePrint} disabled={downloading}>
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
            <div className="relative" style={{ zIndex: 1, paddingTop: `${topMm}mm`, paddingBottom: `${bottomMm}mm`, paddingLeft: "8mm", paddingRight: "8mm", height: "100%", boxSizing: "border-box", display: "flex", flexDirection: "column" }}>
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
              <div className="flex-1 overflow-hidden">
                {page.type === "structured" && page.testBlocks && (
                  <ReportResultsSection
                    grouped={transformBlocksToGrouped(page.departmentName || "Results", page.testBlocks, testsMap, testParamsMap)}
                    shouldShowProfile={() => true}
                    hideDeptHeader={false}
                    showFlagText={true}
                    profileMetaMap={buildProfileMetaMap(page.testBlocks, testsMap)}
                    fontSize={{
                      department: "15px",
                      profile: "14px",
                      tableHeader: "12px",
                      row: "13px",
                      meta: "11px",
                    }}
                  />
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

      {/* Print styles - minimal since we use image-based printing */}
      <style>{`
        @media print {
          .print\\:hidden { display: none !important; }
        }
      `}</style>
    </div>
  );
};

/** Transform LIMS TestBlock[] into the grouped format for ReportResultsSection */
function transformBlocksToGrouped(
  deptName: string,
  blocks: TestBlock[],
  testsMap: Record<string, any>,
  testParamsMap: Record<string, any[]>
): Record<string, Record<string, TestResult[]>> {
  const profiles: Record<string, TestResult[]> = {};

  blocks.forEach(block => {
    const profName = block.testName;
    const tpOrder = testParamsMap[block.testId] || [];
    const paramById: Record<string, TestResultEntry> = {};
    block.params.forEach(p => { paramById[p.parameter_id] = p; });

    const results: TestResult[] = [];

    if (tpOrder.length > 0) {
      tpOrder.forEach((tp: any) => {
        if (tp.is_subheader && tp.subheader_text) {
          results.push({
            parameter_name: tp.subheader_text,
            result_value: '',
            is_subheader: true,
            subheader_text: tp.subheader_text,
          });
        } else {
          const param = paramById[tp.parameter_id];
          if (param) {
            results.push(mapParamToTestResult(param));
            delete paramById[tp.parameter_id];
          }
        }
      });
      // Remaining params not in test_parameters
      Object.values(paramById).forEach(param => {
        results.push(mapParamToTestResult(param));
      });
    } else {
      block.params.forEach(param => {
        results.push(mapParamToTestResult(param));
      });
    }

    profiles[profName] = results;
  });

  return { [deptName]: profiles };
}

function mapParamToTestResult(param: TestResultEntry): TestResult {
  return {
    parameter_name: param.parameter_name,
    result_value: param.result_value,
    unit: param.unit || undefined,
    normal_range_text: param.reference_range || undefined,
    normal_range_low: param.normal_range_low?.toString() || undefined,
    normal_range_high: param.normal_range_high?.toString() || undefined,
    flag: param.flag || undefined,
    test_name: param.test_name,
  };
}

function buildProfileMetaMap(
  blocks: TestBlock[],
  testsMap: Record<string, any>
): Record<string, ProfileMeta> {
  const map: Record<string, ProfileMeta> = {};
  blocks.forEach(block => {
    map[block.testName] = {
      sample_type: block.sampleType || undefined,
      analyzer: block.instrument || undefined,
      method: block.method || undefined,
      interpretation: block.interpretation || undefined,
    };
  });
  return map;
}

export default LimsReportView;
