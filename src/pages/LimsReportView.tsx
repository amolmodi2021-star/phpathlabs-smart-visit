import { useState, useEffect, useRef, useMemo } from "react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Loader2, Printer, ArrowLeft, Download, Share2 } from "lucide-react";
import { toPng, toJpeg } from "html-to-image";
import jsPDF from "jspdf";
import * as pdfjsLib from "pdfjs-dist";
import LimsReportHeader from "@/components/report/LimsReportHeader";
import ReportSignatureBlock from "@/components/report/ReportSignatureBlock";
import ReportResultsSection from "@/components/report/ReportResultsSection";
import AutoScaleContent from "@/components/report/AutoScaleContent";
import type { TestResult, ProfileMeta } from "@/components/report/ReportResultsSection";
import { toast } from "sonner";
import { logEvent } from "@/lib/reportShareLinks";

pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.2.67/pdf.worker.min.mjs";

// ── Height constants (mm) ──
const PAGE_HEIGHT_MM = 297;
const PAGE_WIDTH_MM = 210;
const HEADER_HEIGHT_MM = 28;
const SIGNATURE_HEIGHT_MM = 16;
const PAGE_NUM_HEIGHT_MM = 6;
const DEPT_HEADER_MM = 10;
const TEST_HEADER_MM = 8;
const TABLE_HEADER_MM = 7;
const ROW_HEIGHT_MM = 6;            // raised from 5.5 — single-line row floor
const INTERPRETATION_MM = 10;
const META_LINE_MM = 5;
const GAP_MM = 3;
// ── New conservative pagination constants (mm) ──
const PROFILE_HEADER_MM = 9;        // blue "PROFILE NAME (Sample: ...)" bar
const INSTRUMENT_LINE_MM = 7;       // Instrument/Method line, allows 2 wraps
const SUBHEADER_MM = 6;             // sub-header row inside a profile
const TEST_NOTE_MM = 6;             // italic test_note row at bottom of profile
const OUTSOURCED_MM = 6;            // outsourced caption row
const INTER_PROFILE_GAP_MM = 4;     // 1mm + 2mm spacers between profiles
const SAFETY_PAD_MM = 5;            // cushion for minor wrap differences
const FIT_TOLERANCE_MM = 2;         // never let estimate spill onto signature

// Compute a single parameter row's height accounting for wrapped reference range
const rowHeightMm = (p: any): number => {
  const refText: string = ((p?.reference_range as string) || "").trim();
  // ~38 chars per line in the Reference Range column at 13px
  const refLines = Math.max(
    1,
    Math.ceil((refText.length || 1) / 38),
    refText ? refText.split(/\r?\n/).length : 1,
  );
  const remarkLines = p?.note ? 1 : 0;
  const descLines = (p as any)?.parameter_description ? 1 : 0;
  return Math.max(ROW_HEIGHT_MM, refLines * 5 + remarkLines * 5 + descLines * 4);
};

// Length-aware interpretation height
const interpretationMm = (html?: string | null): number => {
  if (!html) return 0;
  const text = String(html).replace(/<[^>]*>/g, "").trim();
  if (!text) return 0;
  const lines = Math.max(text.split(/\r?\n/).length, Math.ceil(text.length / 95));
  return 6 /* "Interpretation:" label */ + lines * 4 + 2 /* padding */;
};

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
  approved_by?: string;
  approved_by_qualification?: string | null;
  approved_by_designation?: string | null;
  approved_by_signature_url?: string | null;
  note?: string | null;
  test_note?: string | null;
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
  testNote?: string | null;
  estimatedHeightMm: number;
  fitToPage?: boolean;
  dedicatedPage?: boolean;
  isSingleParameter?: boolean;
  approvers?: string[];
}

interface SnipPage {
  imageUrl: string;
}

interface PageContent {
  type: "structured" | "snip";
  departmentName?: string;
  testBlocks?: TestBlock[];
  snipImage?: string;
  approvers?: string[];
}

interface SignatureInfo {
  pathologist_name: string;
  qualification: string | null;
  designation: string | null;
  signatureUrl: string | null;
}

const LimsReportView = () => {
  const { registrationId } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const selectedTestIdsParam = searchParams.get("tests");
  const selectedTestIds = selectedTestIdsParam ? new Set(selectedTestIdsParam.split(",")) : null;
  const publicToken = searchParams.get("public");
  const isPublic = !!publicToken;
  const autoShareRequested = searchParams.get("share") === "1";
  const printRef = useRef<HTMLDivElement>(null);
  const previewWrapRef = useRef<HTMLDivElement>(null);
  const autoDownloadStartedRef = useRef(false);
  const autoShareStartedRef = useRef(false);
  const cachedPdfRef = useRef<{ blob: Blob; filename: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [hasDownloadedOnce, setHasDownloadedOnce] = useState(false);
  const [sharingWa, setSharingWa] = useState(false);
  const [showLetterhead, setShowLetterhead] = useState(true);
  const [previewScale, setPreviewScale] = useState(1);

  // A4 width at 96dpi ≈ 794px. Recompute scale on resize so the page fits the viewport on mobile.
  useEffect(() => {
    const A4_WIDTH_PX = (PAGE_WIDTH_MM / 25.4) * 96; // ~794
    const compute = () => {
      const wrap = previewWrapRef.current;
      if (!wrap) return;
      const available = wrap.clientWidth;
      if (!available) return;
      const next = Math.min(1, available / A4_WIDTH_PX);
      setPreviewScale(next);
    };
    compute();
    const ro = new ResizeObserver(compute);
    if (previewWrapRef.current) ro.observe(previewWrapRef.current);
    window.addEventListener("resize", compute);
    window.addEventListener("orientationchange", compute);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", compute);
      window.removeEventListener("orientationchange", compute);
    };
  }, [loading]);

  // Data
  const [approvedReports, setApprovedReports] = useState<any[]>([]);
  const [registration, setRegistration] = useState<any>(null);
  const [layoutSettings, setLayoutSettings] = useState({ top_margin_cm: 2.5, bottom_margin_cm: 1.5, letterhead_pdf_path: null as string | null });
  const [letterheadImageUrl, setLetterheadImageUrl] = useState<string | null>(null);
  const [signatureMap, setSignatureMap] = useState<Record<string, SignatureInfo>>({});
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
    try {

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
      supabase.from("tests").select("id, test_name, department_id, instrument_name, method, sample_type, interpretation, is_outsourced, display_name, bold_in_report, show_in_report, fit_to_page, dedicated_page, is_single_parameter"),
      supabase.from("outsourced_test_snips").select("*").eq("registration_id", registrationId),
      supabase.from("pathologist_signatures").select("*"),
    ]);

    // Fallback: if any report is missing sample_collection_date (legacy approvals before
    // collection-date capture), derive it from MIN(sample_tubes.collected_at) for this registration.
    const reportsArr = reports || [];
    const needsCollectionFallback = reportsArr.some((r: any) => !r.sample_collection_date);
    let fallbackCollectionDate: string | null = null;
    if (needsCollectionFallback) {
      const { data: tubes } = await supabase
        .from("sample_tubes")
        .select("collected_at")
        .eq("registration_id", registrationId)
        .not("collected_at", "is", null);
      if (tubes && tubes.length > 0) {
        fallbackCollectionDate = tubes.map((t: any) => t.collected_at).sort()[0];
      }
    }

    // Filter approved reports test_results by selected test IDs if provided
    const filteredReports = reportsArr.map((r: any) => {
      const patched = r.sample_collection_date ? r : { ...r, sample_collection_date: fallbackCollectionDate };
      if (!selectedTestIds) return patched;
      return {
        ...patched,
        test_results: ((patched.test_results || []) as any[]).filter((tr: any) => selectedTestIds.has(tr.test_id)),
      };
    });

    // Tests map
    const tMap: Record<string, any> = {};
    (allTests || []).forEach((t: any) => { tMap[t.id] = t; });

    // Layout
    let computedLayout = { top_margin_cm: 2.5, bottom_margin_cm: 1.5, letterhead_pdf_path: null as string | null };
    let computedLetterhead: string | null = null;
    if (layout) {
      computedLayout = {
        top_margin_cm: Number(layout.top_margin_cm) || 2.5,
        bottom_margin_cm: Number(layout.bottom_margin_cm) || 1.5,
        letterhead_pdf_path: layout.letterhead_pdf_path || null,
      };
      if (computedLayout.letterhead_pdf_path) {
        const { data: urlData } = supabase.storage.from("letterheads").getPublicUrl(computedLayout.letterhead_pdf_path);
        computedLetterhead = await convertPdfToImage(urlData.publicUrl);
      }
    }

    // Helper: convert cross-origin image URL to inline data URL so html-to-image can rasterize reliably
    const urlToDataUrl = async (url: string): Promise<string | null> => {
      try {
        const res = await fetch(url, { mode: "cors", cache: "no-cache" });
        if (!res.ok) return null;
        const blob = await res.blob();
        return await new Promise((resolve) => {
          const r = new FileReader();
          r.onloadend = () => resolve(r.result as string);
          r.onerror = () => resolve(null);
          r.readAsDataURL(blob);
        });
      } catch { return null; }
    };

    // Build signature map: approver display_name → signature info
    const sigMap: Record<string, SignatureInfo> = {};
    if (signatures && signatures.length > 0) {
      // Build mapped user lookup
      const mappedSigs = signatures.filter((s: any) => s.mapped_user_id);
      let userDisplayMap: Record<string, string> = {};
      if (mappedSigs.length > 0) {
        const { data: mappedUsers } = await supabase
          .from("app_users")
          .select("id, display_name")
          .in("id", mappedSigs.map((s: any) => s.mapped_user_id));
        if (mappedUsers) {
          userDisplayMap = Object.fromEntries(mappedUsers.map((u: any) => [u.id, u.display_name]));
        }
      }

      for (const sig of signatures) {
        let sigUrl: string | null = null;
        if (sig.signature_image_path) {
          const { data: sigUrlData } = supabase.storage.from("signatures").getPublicUrl(sig.signature_image_path);
          // Inline as data URL for reliable canvas rasterization in PDF/print capture
          sigUrl = await urlToDataUrl(sigUrlData.publicUrl) || sigUrlData.publicUrl;
        }
        const info: SignatureInfo = {
          pathologist_name: sig.pathologist_name,
          qualification: sig.qualification,
          designation: sig.designation,
          signatureUrl: sigUrl,
        };
        // Index by pathologist_name
        sigMap[sig.pathologist_name.toLowerCase()] = info;
        // Also index by mapped user's display_name
        if (sig.mapped_user_id && userDisplayMap[sig.mapped_user_id]) {
          sigMap[userDisplayMap[sig.mapped_user_id].toLowerCase()] = info;
        }
      }
    }

    // Snip images — inline as data URLs for reliable PDF/print capture
    const snipPages: SnipPage[] = [];
    const rawSnipUrls: string[] = [];
    (snips || []).forEach((s: any) => {
      if (selectedTestIds && !selectedTestIds.has(s.test_id)) return;
      const urls = Array.isArray(s.snip_image_urls) ? s.snip_image_urls : [];
      if (s.result_mode === "snip" || urls.length > 0) {
        urls.forEach((url: string) => rawSnipUrls.push(url));
      }
    });
    const inlinedSnipUrls = await Promise.all(rawSnipUrls.map(async (u) => (await urlToDataUrl(u)) || u));
    inlinedSnipUrls.forEach((url) => snipPages.push({ imageUrl: url }));

    // Inline snapshot signature URLs embedded in approved_reports.test_results JSONB
    for (const r of filteredReports) {
      const trs = (r.test_results || []) as any[];
      for (const tr of trs) {
        const params = (tr.parameters || []) as any[];
        for (const p of params) {
          if (p.approved_by_signature_url && typeof p.approved_by_signature_url === "string" && !p.approved_by_signature_url.startsWith("data:")) {
            const dataUrl = await urlToDataUrl(p.approved_by_signature_url);
            if (dataUrl) p.approved_by_signature_url = dataUrl;
          }
        }
      }
    }

    // Fetch test_parameters for hierarchy
    let computedTpMap: Record<string, any[]> = {};
    const uniqueTestIds = [...new Set((reports || []).flatMap((r: any) =>
      ((r.test_results || []) as TestResultEntry[]).map(tr => tr.test_id)
    ))];
    if (uniqueTestIds.length > 0) {
      const { data: tpData } = await supabase
        .from("test_parameters")
        .select("test_id, parameter_id, display_order, is_subheader, subheader_text, report_test_parameters(parameter_description)")
        .in("test_id", uniqueTestIds)
        .order("display_order", { ascending: true });
      (tpData || []).forEach((tp: any) => {
        if (!computedTpMap[tp.test_id]) computedTpMap[tp.test_id] = [];
        computedTpMap[tp.test_id].push({
          ...tp,
          parameter_description: tp.report_test_parameters?.parameter_description ?? null,
        });
      });
    }

    // Batch all state updates together to prevent intermediate renders
    setApprovedReports(filteredReports);
    setRegistration(regData);
    setDepartments(depts || []);
    setTestsMap(tMap);
    setLayoutSettings(computedLayout);
    setLetterheadImageUrl(computedLetterhead);
    setSignatureMap(sigMap);
    setSnipImages(snipPages);
    setTestParamsMap(computedTpMap);
    setLoading(false);

    } catch (err: any) {
      console.error("Failed to load report data:", err);
      toast.error("Failed to load report data");
      setLoading(false);
    }
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

      // First non-null test_note across this test's params (denormalised across rows)
      const blockTestNoteEarly = sortedParams.find(p => p.test_note && String(p.test_note).trim())?.test_note || null;
      const hasOutsourcedCaption = !!(testInfo?.is_outsourced && (testInfo as any)?.outsourced_caption);

      // ── Conservative per-test height estimate ──
      // Account for every visual element a profile renders so RFT-style tests
      // never overflow into the signature band (which would clip rows silently).
      const subheaderCount = tpOrder.filter((tp: any) => tp.is_subheader).length;
      const paramRowsHeight = sortedParams.reduce((sum, p) => sum + rowHeightMm(p), 0);
      let heightMm =
        PROFILE_HEADER_MM +                                         // blue profile bar
        ((testInfo?.instrument_name || testInfo?.method) ? INSTRUMENT_LINE_MM : 0) +
        TABLE_HEADER_MM +
        paramRowsHeight +
        subheaderCount * SUBHEADER_MM +
        (blockTestNoteEarly ? TEST_NOTE_MM : 0) +
        (hasOutsourcedCaption ? OUTSOURCED_MM : 0) +
        interpretationMm(testInfo?.interpretation) +
        INTER_PROFILE_GAP_MM +
        SAFETY_PAD_MM;

      // Collect unique approvers for this test block
      const blockApprovers = [...new Set(sortedParams.map(p => p.approved_by).filter(Boolean))] as string[];

      testBlocks.push({
        testId,
        testName: testInfo?.display_name || params[0]?.test_name || testInfo?.test_name || "Unknown Test",
        departmentId: deptId,
        departmentName: deptName,
        departmentOrder: deptOrder,
        params: sortedParams,
        instrument: testInfo?.instrument_name,
        method: testInfo?.method,
        sampleType: testInfo?.sample_type,
        interpretation: testInfo?.interpretation,
        testNote: blockTestNoteEarly,
        estimatedHeightMm: heightMm,
        fitToPage: testInfo?.fit_to_page ?? false,
        dedicatedPage: testInfo?.dedicated_page ?? false,
        isSingleParameter: testInfo?.is_single_parameter ?? false,
        approvers: blockApprovers,
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

      const collectApprovers = (blocks: TestBlock[]) => [...new Set(blocks.flatMap(b => b.approvers || []))];

      blocks.forEach(block => {
        // Dedicated page: flush current, put this block alone on its own page
        if (block.dedicatedPage) {
          if (currentPageBlocks.length > 0) {
            allPages.push({ type: "structured", departmentName: deptName, testBlocks: currentPageBlocks, approvers: collectApprovers(currentPageBlocks) });
            currentPageBlocks = [];
            usedHeight = DEPT_HEADER_MM;
          }
          allPages.push({ type: "structured", departmentName: deptName, testBlocks: [block], approvers: collectApprovers([block]) });
          return;
        }

        if (currentPageBlocks.length > 0 && (usedHeight + block.estimatedHeightMm) > (usableHeight - FIT_TOLERANCE_MM)) {
          // Flush current page
          allPages.push({ type: "structured", departmentName: deptName, testBlocks: currentPageBlocks, approvers: collectApprovers(currentPageBlocks) });
          currentPageBlocks = [];
          usedHeight = DEPT_HEADER_MM;
        }
        currentPageBlocks.push(block);
        usedHeight += block.estimatedHeightMm;
      });

      if (currentPageBlocks.length > 0) {
        allPages.push({ type: "structured", departmentName: deptName, testBlocks: currentPageBlocks, approvers: collectApprovers(currentPageBlocks) });
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
      const NATIVE_W = Math.round((PAGE_WIDTH_MM / 25.4) * 96);
      const NATIVE_H = Math.round((PAGE_HEIGHT_MM / 25.4) * 96);
      for (let i = 0; i < pageElements.length; i++) {
        if (i > 0) pdf.addPage();
        const el = pageElements[i] as HTMLElement;
        const isSnipPage = !!el.querySelector('img[data-snip-image]');
        if (isSnipPage) {
          const png = await toPng(el, {
            quality: 1,
            pixelRatio: 2,
            backgroundColor: "#ffffff",
            width: NATIVE_W,
            height: NATIVE_H,
            style: { transform: "none", transformOrigin: "top left" },
          });
          pdf.addImage(png, "PNG", 0, 0, PAGE_WIDTH_MM, PAGE_HEIGHT_MM);
        } else {
          const jpeg = await toJpeg(el, {
            quality: 0.92,
            pixelRatio: 2,
            backgroundColor: "#ffffff",
            width: NATIVE_W,
            height: NATIVE_H,
            style: { transform: "none", transformOrigin: "top left" },
          });
          pdf.addImage(jpeg, "JPEG", 0, 0, PAGE_WIDTH_MM, PAGE_HEIGHT_MM, undefined, "FAST");
        }
      }

      const patientName = approvedReports[0]?.patient_name || "Report";
      const invoiceNum = approvedReports[0]?.invoice_number || "";
      const filename = `${patientName}_${invoiceNum}.pdf`;
      pdf.save(filename);

      // Cache blob for share + open-in-new-tab in public mode
      const blob = pdf.output("blob") as Blob;
      cachedPdfRef.current = { blob, filename };

      if (isPublic) {
        try {
          const blobUrl = URL.createObjectURL(blob);
          window.open(blobUrl, "_blank");
          // Revoke after a delay so the new tab can load it
          setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
        } catch (e) {
          console.warn("Could not open PDF in new tab:", e);
        }
        if (publicToken) {
          logEvent(publicToken, "downloaded", undefined, { mode: "public", invoice: invoiceNum });
        }
      }

      // Update print_date
      if (registrationId) {
        await supabase.from("approved_reports").update({ print_date: new Date().toISOString() }).eq("registration_id", registrationId);
      }

      setHasDownloadedOnce(true);
      toast.success("PDF downloaded successfully");
    } catch (err: any) {
      toast.error("PDF export failed: " + (err.message || "Unknown error"));
    }
    setDownloading(false);
  };

  // ── Auto-download once in public mode ──
  useEffect(() => {
    if (!isPublic) return;
    if (loading) return;
    if (pages.length === 0) return;
    if (autoDownloadStartedRef.current) return;
    autoDownloadStartedRef.current = true;
    // Small delay to let layout settle (images, fonts)
    const t = setTimeout(() => { handleDownloadPdf(); }, 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPublic, loading, pages.length]);

  // ── Auto-share once PDF is ready (when share=1 in URL) ──
  useEffect(() => {
    if (!autoShareRequested) return;
    if (!hasDownloadedOnce) return;
    if (autoShareStartedRef.current) return;
    if (!cachedPdfRef.current) return;
    autoShareStartedRef.current = true;
    const t = setTimeout(() => { handleShareWhatsApp(); }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoShareRequested, hasDownloadedOnce]);

  // ── Share on WhatsApp ──
  const handleShareWhatsApp = async () => {
    setSharingWa(true);
    try {
      const cached = cachedPdfRef.current;
      const invoiceNum = approvedReports[0]?.invoice_number || "";
      const portalUrl = typeof window !== "undefined" ? window.location.href : "";
      const text = `My PH PathLabs report — Invoice ${invoiceNum}\n${portalUrl}`;

      // Try Web Share API with file when supported
      if (cached && typeof navigator !== "undefined" && (navigator as any).canShare) {
        try {
          const file = new File([cached.blob], cached.filename, { type: "application/pdf" });
          const shareData: any = { files: [file], title: "PH PathLabs Report", text };
          if ((navigator as any).canShare(shareData)) {
            await (navigator as any).share(shareData);
            if (publicToken) logEvent(publicToken, "shared_whatsapp", undefined, { mode: "file", invoice: invoiceNum });
            setSharingWa(false);
            return;
          }
        } catch (e: any) {
          // user-cancel or unsupported → fall through to wa.me
          if (e?.name === "AbortError") { setSharingWa(false); return; }
          console.warn("Web Share with file failed, falling back:", e);
        }
      }

      // Fallback: wa.me text link
      const waUrl = `https://wa.me/?text=${encodeURIComponent(text)}`;
      window.open(waUrl, "_blank");
      if (publicToken) logEvent(publicToken, "shared_whatsapp", undefined, { mode: "link", invoice: invoiceNum });
    } catch (err: any) {
      toast.error("Share failed: " + (err.message || "Unknown error"));
    }
    setSharingWa(false);
  };

  // ── Image-based Print ──
  const handlePrint = async () => {
    if (!printRef.current) return;
    setDownloading(true);
    try {
      // Always print without letterhead
      const originalLetterhead = showLetterhead;
      setShowLetterhead(false);
      printRef.current.classList.add("print-strip-colors");
      await new Promise(r => setTimeout(r, 150));

      const pageElements = printRef.current.querySelectorAll("[data-page]");
      if (pageElements.length === 0) { toast.error("No pages to print"); setShowLetterhead(originalLetterhead); setDownloading(false); return; }

      const imageUrls: string[] = [];
      const NATIVE_W = Math.round((PAGE_WIDTH_MM / 25.4) * 96);
      const NATIVE_H = Math.round((PAGE_HEIGHT_MM / 25.4) * 96);
      for (let i = 0; i < pageElements.length; i++) {
        const el = pageElements[i] as HTMLElement;
        const isSnipPage = !!el.querySelector('img[data-snip-image]');
        if (isSnipPage) {
          const png = await toPng(el, {
            quality: 1,
            pixelRatio: 2,
            backgroundColor: "#ffffff",
            width: NATIVE_W,
            height: NATIVE_H,
            style: { transform: "none", transformOrigin: "top left" },
          });
          imageUrls.push(png);
        } else {
          const jpeg = await toJpeg(el, {
            quality: 0.92,
            pixelRatio: 2,
            backgroundColor: "#ffffff",
            width: NATIVE_W,
            height: NATIVE_H,
            style: { transform: "none", transformOrigin: "top left" },
          });
          imageUrls.push(jpeg);
        }
      }

      // Restore styles after capturing
      printRef.current.classList.remove("print-strip-colors");
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
        <Button variant="outline" onClick={() => navigate("/lims?tab=dispatch")}>
          <ArrowLeft className="h-4 w-4 mr-1" />Back
        </Button>
        <div className="text-center py-12 text-muted-foreground">
          <p className="text-lg font-medium">No approved reports found</p>
          <p className="text-sm">This registration has no approved test results yet.</p>
        </div>
      </div>
    );
  }

  const NATIVE_W_PX = (PAGE_WIDTH_MM / 25.4) * 96;
  const NATIVE_H_PX = (PAGE_HEIGHT_MM / 25.4) * 96;
  const scaledHeight = NATIVE_H_PX * previewScale;

  return (
    <div className="p-2 sm:p-4 space-y-3 sm:space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 sm:gap-3 print:hidden">
        {!isPublic && (
          <Button variant="outline" size="sm" onClick={() => navigate("/lims?tab=dispatch")}>
            <ArrowLeft className="h-4 w-4 sm:mr-1" />
            <span className="hidden sm:inline">Back</span>
          </Button>
        )}
        <h1 className="text-sm sm:text-xl font-bold truncate flex-1 min-w-0">
          <span className="hidden sm:inline">{isPublic ? "PH PathLabs · " : "Report — "}</span>
          {report.patient_name} ({report.invoice_number})
        </h1>
        <div className="flex items-center gap-2 sm:gap-4 ml-auto flex-wrap">
          {!isPublic && (
            <>
              <div className="flex items-center gap-2">
                <Switch id="letterhead-toggle" checked={showLetterhead} onCheckedChange={setShowLetterhead} />
                <Label htmlFor="letterhead-toggle" className="text-xs sm:text-sm cursor-pointer whitespace-nowrap">
                  <span className="hidden sm:inline">With </span>Letterhead
                </Label>
              </div>
              <Button size="sm" variant="outline" onClick={handlePrint} disabled={downloading} aria-label="Print">
                <Printer className="h-4 w-4 sm:mr-1" />
                <span className="hidden sm:inline">Print</span>
              </Button>
            </>
          )}
          <Button size="sm" onClick={handleDownloadPdf} disabled={downloading} aria-label="Download PDF">
            {downloading ? <Loader2 className="h-4 w-4 sm:mr-1 animate-spin" /> : <Download className="h-4 w-4 sm:mr-1" />}
            {isPublic ? (
              <span>{downloading ? "Downloading…" : hasDownloadedOnce ? "Re-download PDF" : "Preparing report…"}</span>
            ) : (
              <>
                <span className="hidden sm:inline">Download PDF</span>
                <span className="sm:hidden">PDF</span>
              </>
            )}
          </Button>
          {isPublic && hasDownloadedOnce && (
            <Button
              size="sm"
              variant="default"
              onClick={handleShareWhatsApp}
              disabled={sharingWa}
              className="bg-[#25D366] hover:bg-[#1ebe57] text-white"
              aria-label="Share on WhatsApp"
            >
              {sharingWa ? <Loader2 className="h-4 w-4 sm:mr-1 animate-spin" /> : <Share2 className="h-4 w-4 sm:mr-1" />}
              <span>Share on WhatsApp</span>
            </Button>
          )}
        </div>
      </div>

      {/* Rendered Pages — wrapper measures available width and applies CSS scale on mobile */}
      <div ref={previewWrapRef} className="w-full overflow-hidden">
        <div ref={printRef} id="print-container" className="flex flex-col items-center gap-4 mx-auto" style={{ width: `${NATIVE_W_PX}px` }}>
          {pages.map((page, pageIdx) => (
            <div
              key={pageIdx}
              style={{
                width: `${NATIVE_W_PX}px`,
                height: `${scaledHeight}px`,
              }}
            >
            <div
              data-page={pageIdx}
              className="bg-white shadow-lg relative overflow-hidden"
              style={{
                width: `${PAGE_WIDTH_MM}mm`,
                height: `${PAGE_HEIGHT_MM}mm`,
                minHeight: `${PAGE_HEIGHT_MM}mm`,
                maxHeight: `${PAGE_HEIGHT_MM}mm`,
                transform: previewScale < 1 ? `scale(${previewScale})` : undefined,
                transformOrigin: "top left",
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
              <div className="flex-1 overflow-visible">{/* overflow-visible: surfaces any pagination-estimate regression instead of silently clipping rows (e.g. RFT being truncated). The outer data-page wrapper still clips for capture. */}
                {page.type === "structured" && page.testBlocks && (() => {
                  const hasFitToPage = page.testBlocks.some(b => b.fitToPage);
                  const resultsContent = (
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
                  );
                  if (hasFitToPage) {
                    const availableHeight = PAGE_HEIGHT_MM - topMm - bottomMm - HEADER_HEIGHT_MM - SIGNATURE_HEIGHT_MM - PAGE_NUM_HEIGHT_MM;
                    return <AutoScaleContent maxHeightMm={availableHeight}>{resultsContent}</AutoScaleContent>;
                  }
                  return resultsContent;
                })()}

                {page.type === "snip" && page.snipImage && (
                  <div className="flex items-start justify-center h-full pt-1 overflow-hidden">
                    <img
                      data-snip-image="true"
                      src={page.snipImage}
                      crossOrigin="anonymous"
                      alt="Outsourced Report"
                      className="max-w-full object-contain"
                      style={{
                        // Reserve full margins + header + signature band + page number + safety gap so snip never overlaps signature.
                        maxHeight: `${PAGE_HEIGHT_MM - topMm - bottomMm - HEADER_HEIGHT_MM - SIGNATURE_HEIGHT_MM - PAGE_NUM_HEIGHT_MM - 6}mm`,
                      }}
                    />
                  </div>
                )}
              </div>

              {/* Signature */}
              <div className="mt-auto">
                {(() => {
                  const pageApprovers = page.approvers && page.approvers.length > 0
                    ? page.approvers
                    : Object.keys(signatureMap).length > 0 ? [Object.keys(signatureMap)[0]] : [];
                  
                  // Collect snapshot signature data from test results on this page
                  const snapshotSigMap: Record<string, SignatureInfo> = {};
                  if (page.testBlocks) {
                    page.testBlocks.forEach(block => {
                      block.params.forEach(p => {
                        if (p.approved_by && p.approved_by_qualification !== undefined) {
                          snapshotSigMap[p.approved_by.toLowerCase()] = {
                            pathologist_name: p.approved_by,
                            qualification: p.approved_by_qualification || null,
                            designation: p.approved_by_designation || null,
                            signatureUrl: p.approved_by_signature_url || null,
                          };
                        }
                      });
                    });
                  }

                  const resolvedSigs = pageApprovers
                    .map(name => {
                      const key = name.toLowerCase();
                      // Prefer immutable snapshot data, fall back to live lookup
                      return snapshotSigMap[key] || signatureMap[key];
                    })
                    .filter(Boolean);
                  // Deduplicate by pathologist_name
                  const uniqueSigs = resolvedSigs.filter((s, i, arr) => arr.findIndex(x => x.pathologist_name === s.pathologist_name) === i);
                  if (uniqueSigs.length === 0 && Object.keys(signatureMap).length > 0) {
                    // Fallback: show first signature
                    const fallback = Object.values(signatureMap)[0];
                    return (
                      <ReportSignatureBlock
                        signatureUrl={fallback.signatureUrl}
                        pathologistName={fallback.pathologist_name}
                        qualification={fallback.qualification || undefined}
                        designation={fallback.designation || undefined}
                      />
                    );
                  }
                  return (
                    <div className="pt-1 border-t flex justify-end gap-8 print:break-inside-avoid">
                      {uniqueSigs.map((sig, idx) => (
                        <div key={idx} className="text-center">
                          {sig.signatureUrl && <img src={sig.signatureUrl} crossOrigin="anonymous" alt="Signature" className="h-8 mx-auto mb-0" />}
                          <p className="font-semibold text-[10px] leading-tight">{sig.pathologist_name}</p>
                          {sig.qualification && <p className="text-[9px] leading-tight" style={{ color: "hsl(var(--muted-foreground))" }}>{sig.qualification}</p>}
                          {sig.designation && <p className="text-[9px] leading-tight" style={{ color: "hsl(var(--muted-foreground))" }}>{sig.designation}</p>}
                        </div>
                      ))}
                    </div>
                  );
                })()}
                {/* Page Number */}
                <div className="text-center mt-0.5" style={{ fontSize: "7px", color: "hsl(var(--muted-foreground))" }}>
                  Page {pageIdx + 1} of {totalPages}
                </div>
              </div>
            </div>
            </div>
          </div>
          ))}
        </div>
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

    // Build parameter_id -> description lookup from the live param map
    const descById: Record<string, string | null> = {};
    tpOrder.forEach((tp: any) => {
      if (tp.parameter_id && tp.parameter_description) {
        descById[tp.parameter_id] = tp.parameter_description;
      }
    });

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
            results.push(mapParamToTestResult(param, descById[param.parameter_id] || null));
            delete paramById[tp.parameter_id];
          }
        }
      });
      // Remaining params not in test_parameters
      Object.values(paramById).forEach(param => {
        results.push(mapParamToTestResult(param, descById[param.parameter_id] || null));
      });
    } else {
      block.params.forEach(param => {
        results.push(mapParamToTestResult(param, descById[param.parameter_id] || null));
      });
    }

    // Single parameter test: override parameter name with test display name and drop description
    if (block.isSingleParameter && results.length === 1 && !results[0].is_subheader) {
      results[0] = { ...results[0], parameter_name: block.testName, parameter_description: undefined };
    }

    profiles[profName] = results;
  });

  return { [deptName]: profiles };
}

function mapParamToTestResult(param: TestResultEntry, parameterDescription: string | null = null): TestResult {
  return {
    parameter_name: param.parameter_name,
    parameter_description: parameterDescription || undefined,
    result_value: param.result_value,
    unit: param.unit || undefined,
    normal_range_text: param.reference_range || undefined,
    normal_range_low: param.normal_range_low?.toString() || undefined,
    normal_range_high: param.normal_range_high?.toString() || undefined,
    flag: param.flag || undefined,
    test_name: param.test_name,
    remark: (param as any).note || undefined,
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
      test_note: block.testNote || undefined,
    };
  });
  return map;
}

export default LimsReportView;
