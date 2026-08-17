import { useState, useEffect, useRef, useMemo } from "react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useParams, useNavigate, useSearchParams, useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Loader2, Printer, ArrowLeft, Download, Share2 } from "lucide-react";
import { toPng, toJpeg } from "html-to-image";
import jsPDF from "jspdf";
import * as pdfjsLib from "pdfjs-dist";
import LimsReportHeader from "@/components/report/LimsReportHeader";
import ReportSignatureBlock from "@/components/report/ReportSignatureBlock";
import ReportInvoiceBarcode from "@/components/report/ReportInvoiceBarcode";
import ReportResultsSection from "@/components/report/ReportResultsSection";
import AutoScaleContent from "@/components/report/AutoScaleContent";
import type { TestResult, ProfileMeta } from "@/components/report/ReportResultsSection";
import { toast } from "sonner";
import { format } from "date-fns";
import { logEvent, createShareLink } from "@/lib/reportShareLinks";
import { patientDisplayName } from "@/lib/patientDisplayName";
import { enqueueReportForWhatsAppConsole } from "@/lib/whatsappConsoleBridge";
import { resolveNormalRangeDisplay } from "@/lib/parameterNormalRange";
import { resolveReportAgeText } from "@/lib/patientAge";
import { renderCode128Png, replaceCanvasesWithPngImages } from "@/lib/code128Png";
import {
  getCachedLetterheadPng,
  getCachedSignatureDataUrl,
  getOrFetchUrlAsDataUrl,
  reportAssetCacheKey,
} from "@/lib/reportAssetCache";
import { isSnipResultRow, snipImageUrlsFromRow } from "@/lib/outsourcedResultMode";
import { healApprovedReportSnapshotFromLive } from "@/lib/patientResultLookup";

pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.2.67/pdf.worker.min.mjs";

// ── Capture helpers ──────────────────────────────────────────────
// Wait until web fonts are ready and every <img> inside a container has
// finished loading. Without this, html-to-image can occasionally produce
// blank pages because the DOM is captured before resources resolve.
const withTimeout = <T,>(promise: Promise<T>, ms: number, label: string): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const t = window.setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)), ms);
    promise.then(
      (v) => { window.clearTimeout(t); resolve(v); },
      (e) => { window.clearTimeout(t); reject(e); },
    );
  });

const waitForCaptureReady = async (root: HTMLElement) => {
  // Canvas pixels do not survive html-to-image (SVG foreignObject). Same fix as invoice WhatsApp.
  replaceCanvasesWithPngImages(root);
  try {
    if ((document as any).fonts?.ready) {
      await (document as any).fonts.ready;
    }
  } catch {}
  const imgs = Array.from(root.querySelectorAll("img")) as HTMLImageElement[];
  await Promise.all(
    imgs.map((img) => {
      if (img.complete && img.naturalWidth > 0) return Promise.resolve();
      return new Promise<void>((resolve) => {
        const done = () => resolve();
        img.addEventListener("load", done, { once: true });
        img.addEventListener("error", done, { once: true });
        // Hard timeout so a single broken image cannot stall export
        setTimeout(done, 4000);
      });
    })
  );
  // Two RAFs to let layout/paint settle after fonts/images load
  await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
};

// Detect a near-blank capture by sampling pixels from a downscaled copy.
const isBlankDataUrl = async (dataUrl: string): Promise<boolean> => {
  if (!dataUrl) return true;
  try {
    const img = new Image();
    img.src = dataUrl;
    await withTimeout(
      new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error("img")); }),
      8000,
      "blank-check decode",
    );
    const w = 64, h = Math.max(1, Math.round((img.height / img.width) * 64));
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const ctx = c.getContext("2d");
    if (!ctx) return false;
    ctx.drawImage(img, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;
    let nonWhite = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      if (r < 245 || g < 245 || b < 245) nonWhite++;
    }
    return (nonWhite / (w * h)) < 0.005;
  } catch {
    return false;
  }
};

// Capture a page with retries (handles intermittent blank captures from html-to-image).
// Structured pages: pixelRatio 3 for sharp text.
// Snip pages: lower pixelRatio — full-page photo captures at PR3 hang / OOM and stuck the
// WhatsApp popup on "Downloading…".
const captureWithRetry = async (
  el: HTMLElement,
  width: number,
  height: number,
  format: "png" | "jpeg",
): Promise<string> => {
  const isSnipPage = !!el.querySelector("img[data-snip-image]");
  const pixelRatio = isSnipPage ? 1.5 : 3;
  const attempts = isSnipPage ? 2 : 3;
  const captureMs = isSnipPage ? 20_000 : 25_000;
  const opts = {
    pixelRatio,
    backgroundColor: "#ffffff",
    width,
    height,
    // data: URLs + cacheBust re-fetch loops can stall snip captures
    cacheBust: !isSnipPage,
    style: { transform: "none", transformOrigin: "top left" } as Record<string, string>,
  };
  let lastUrl = "";
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      lastUrl = format === "png"
        ? await withTimeout(toPng(el, { ...opts, quality: 1 }), captureMs, "snip/page PNG capture")
        : await withTimeout(toJpeg(el, { ...opts, quality: 0.92 }), captureMs, "page JPEG capture");
      const blank = await isBlankDataUrl(lastUrl);
      if (!blank) return lastUrl;
    } catch (e) {
      lastErr = e;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  if (!lastUrl) {
    throw (lastErr instanceof Error ? lastErr : new Error("Page capture failed"));
  }
  return lastUrl;
};

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
const SAFETY_PAD_MM = 6;            // cushion for minor wrap differences (raised 5→6)
const FIT_TOLERANCE_MM = 2;         // never let estimate spill onto signature
const STANDALONE_DIVIDER_MM = 3;    // border-t-2 + 3mm gap between standalone params

// Compute a single parameter row's height accounting for every visual element
// the renderer adds to a row: wrapped result value, wrapped reference range,
// italic parameter description (under name), and remark/note row.
const rowHeightMm = (p: any, descriptionText?: string | null): number => {
  // Keep spaces for wrap estimate — Display Text spacing is intentional on advisory ranges.
  const refText: string = String(p?.reference_range ?? "");
  const resultText: string = String(p?.result_value ?? "").trim();
  const description: string = String(descriptionText ?? "").trim();
  const note: string = String(p?.note ?? "").trim();

  // Reference Range col ~30% width => ~38 chars/line at 13px
  const refLines = Math.max(
    1,
    Math.ceil((refText.length || 1) / 38),
    refText.trim() ? refText.split(/\r?\n/).length : 1,
  );
  // Result col ~20% width (~22 chars). Blank Display Text → Result spans Ref (~55 chars/line).
  const isDescriptive = !refText;
  const resultPerLine = isDescriptive ? 55 : 22;
  const resultLines = resultText
    ? Math.max(Math.ceil(resultText.length / resultPerLine), resultText.split(/\r?\n/).length)
    : 1;
  // Italic description under parameter name (~75% font ≈ 3.5mm/line, ~52 chars/line in Parameter col)
  const descLines = description
    ? Math.max(1, Math.ceil(description.length / 52), description.split(/\r?\n/).length)
    : 0;
  // Remark/note row: full-width row below param row, wraps freely (~110 chars/line)
  const noteLines = note ? Math.max(1, Math.ceil(note.length / 110)) : 0;

  const baseMm = Math.max(refLines, resultLines) * 5;       // tallest of result/range columns
  const descMm = descLines * 3.5;                            // italic 75% font
  const noteMm = noteLines * 5;                              // full-width note row
  const padMm  = noteLines > 0 ? 1.5 : 0;
  return Math.max(ROW_HEIGHT_MM, baseMm + descMm + noteMm + padMm);
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
  testOrder: number;
  /** yyyy-MM-dd HH:mm of sample_tubes.collected_at for this test; drives page breaks */
  collectionDateKey: string;
  collectionDateIso: string | null;
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
  /** Per-page sample collection datetime (ISO) — different date/time never share a page */
  sampleCollectionDate?: string | null;
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
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const selectedTestIdsParam = searchParams.get("tests");
  const selectedTestIds = selectedTestIdsParam ? new Set(selectedTestIdsParam.split(",")) : null;
  const publicToken = searchParams.get("public");
  const isPublic = !!publicToken;
  const isProvisional = searchParams.get("provisional") === "1";
  const autoShareRequested = searchParams.get("share") === "1";
  const queueWaRequested = searchParams.get("queueWa") === "1";
  const manualWaRequested = searchParams.get("manualWa") === "1";
  const printRef = useRef<HTMLDivElement>(null);
  const previewWrapRef = useRef<HTMLDivElement>(null);
  const autoDownloadStartedRef = useRef(false);
  const autoShareStartedRef = useRef(false);
  const autoQueueWaStartedRef = useRef(false);
  const autoManualWaStartedRef = useRef(false);
  const cachedPdfRef = useRef<{ blob: Blob; filename: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [hasDownloadedOnce, setHasDownloadedOnce] = useState(false);
  const [sharingWa, setSharingWa] = useState(false);
  const [showLetterhead, setShowLetterhead] = useState(!isProvisional);
  const [previewScale, setPreviewScale] = useState(1);

  const goBackFromReport = () => {
    const from = (location.state as { from?: string } | null)?.from;
    if (from === "dispatch" || from === "verification") {
      navigate(-1);
      return;
    }
    navigate(isProvisional ? "/lims?tab=verification" : "/lims?tab=dispatch");
  };

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
  /** test_id → earliest collected_at ISO for that leaf test's tube */
  const [collectionDateByTestId, setCollectionDateByTestId] = useState<Record<string, string>>({});
  const [layoutSettings, setLayoutSettings] = useState({ top_margin_cm: 2.5, bottom_margin_cm: 1.5, letterhead_pdf_path: null as string | null });
  const [letterheadImageUrl, setLetterheadImageUrl] = useState<string | null>(null);
  const [signatureMap, setSignatureMap] = useState<Record<string, SignatureInfo>>({});
  const [departments, setDepartments] = useState<any[]>([]);
  const [testsMap, setTestsMap] = useState<Record<string, any>>({});
  const [testParamsMap, setTestParamsMap] = useState<Record<string, any[]>>({});
  const [snipImages, setSnipImages] = useState<SnipPage[]>([]);
  const [snipModeTestIds, setSnipModeTestIds] = useState<Set<string>>(new Set());
  const [pickupFooterNote, setPickupFooterNote] = useState<string>("");

  const invoiceNumberForBarcode =
    approvedReports[0]?.invoice_number || registration?.invoice_number || "";
  const [invoiceBarcodePng, setInvoiceBarcodePng] = useState<string | null>(null);
  useEffect(() => {
    setInvoiceBarcodePng(renderCode128Png(invoiceNumberForBarcode));
  }, [invoiceNumberForBarcode]);

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
    const reportsFetch = isProvisional
      ? Promise.resolve({ data: [] as any[] })
      : supabase.from("approved_reports").select("*").eq("registration_id", registrationId);
    const [
      { data: reports },
      { data: regData },
      { data: layout },
      { data: depts },
      { data: allTests },
      { data: snips },
      { data: signatures },
    ] = await Promise.all([
      reportsFetch as any,
      supabase.from("patient_registrations").select("*").eq("id", registrationId).single(),
      supabase.from("report_layout_settings").select("*").limit(1).single(),
      supabase.from("report_departments").select("*").order("display_order", { ascending: true }),
      supabase.from("tests").select("id, test_name, department_id, instrument_name, method, sample_type, interpretation, is_outsourced, display_name, bold_in_report, show_in_report, fit_to_page, dedicated_page, is_single_parameter, report_display_order"),
      supabase.from("outsourced_test_snips").select("*").eq("registration_id", registrationId),
      isProvisional
        ? Promise.resolve({ data: [] as any[] })
        : supabase.from("pathologist_signatures").select("*"),
    ]);

    // Pickup point footer note (printed on every report page)
    let computedFooterNote = "";
    if (regData?.pickup_point_id) {
      const { data: pp } = await supabase
        .from("pickup_points")
        .select("report_footer_note")
        .eq("id", regData.pickup_point_id)
        .maybeSingle();
      computedFooterNote = (pp as any)?.report_footer_note || "";
    }

    let reportsArr = reports || [];

    // Provisional: synthesize an approved_reports-shaped record from live patient_results
    if (isProvisional && regData) {
      const { data: liveResults } = await supabase
        .from("patient_results")
        .select("test_id, parameter_id, param_code, parameter_name, result_value, unit, reference_range, normal_range_low, normal_range_high, flag, is_calculated, note, test_note, status")
        .eq("registration_id", registrationId)
        .in("status", ["entered", "pending", "verified", "approved", "dispatched"]);
      // Pull test_name for each test_id from the loaded tests master
      const testNameById: Record<string, string> = {};
      (allTests || []).forEach((t: any) => { testNameById[t.id] = t.test_name; });
      const synthResults = (liveResults || []).map((r: any) => ({
        ...r,
        test_name: testNameById[r.test_id] || "",
      }));
      reportsArr = [{
        registration_id: registrationId,
        invoice_number: regData.invoice_number,
        umr_number: regData.umr_number,
        patient_name: regData.patient_name,
        title: regData.title,
        gender: regData.gender,
        dob: regData.dob,
        age_text: resolveReportAgeText(null, regData.age_text),
        mobile_number: regData.mobile_number,
        email: regData.email,
        address: regData.address,
        doctor_name: regData.doctor_name,
        visit_type: regData.visit_type,
        is_stat: regData.is_stat,
        registration_date: regData.created_at,
        approval_date: null,
        sample_collection_date: null,
        approved_by: null,
        test_results: synthResults,
        outsourced_snip_urls: [],
      }];
    }

    // Final reports: backfill approved/dispatched live rows missing from the snapshot
    // (e.g. concurrent Doctor Approval upserts dropping CBC from approved_reports).
    if (!isProvisional && registrationId && reportsArr.length > 0) {
      const testNameById: Record<string, string> = {};
      (allTests || []).forEach((t: any) => { testNameById[t.id] = t.test_name; });
      const healed = await healApprovedReportSnapshotFromLive(
        supabase,
        registrationId,
        reportsArr,
        testNameById,
      );
      reportsArr = healed.reportsArr;
    }

    // Reference Range patch from parameter_normal_ranges:
    // - Descriptive: always use Display Text (never Normal Findings / stale findings text).
    // - Numeric (etc.): fill blank patient_results.reference_range by age/gender
    //   (interface often stores empty text when master param.normal_range_text is null).
    {
      const allParamIds = Array.from(new Set(
        reportsArr.flatMap((r: any) => ((r.test_results || []) as any[]).map((tr: any) => tr.parameter_id).filter(Boolean)),
      ));
      if (allParamIds.length > 0) {
        const { data: allRanges } = await supabase
          .from("parameter_normal_ranges")
          .select("parameter_id, gender, age_min, age_max, range_type, normal_range_text, normal_range_low, normal_range_high")
          .in("parameter_id", allParamIds);
        const rangesByParam: Record<string, any[]> = {};
        for (const row of allRanges || []) {
          if (!rangesByParam[row.parameter_id]) rangesByParam[row.parameter_id] = [];
          rangesByParam[row.parameter_id].push(row);
        }
        if (Object.keys(rangesByParam).length > 0) {
          reportsArr = reportsArr.map((r: any) => {
            const gender = r.gender || regData?.gender || null;
            const dob = r.dob || regData?.dob || null;
            return {
              ...r,
              test_results: ((r.test_results || []) as any[]).map((tr: any) => {
                const rows = rangesByParam[tr.parameter_id];
                if (!rows || rows.length === 0) return tr;
                const isDescriptive = rows.some((row: any) => (row.range_type || "numeric") === "descriptive");
                if (isDescriptive) {
                  const desc = rows.find((row: any) => (row.range_type || "") === "descriptive") || rows[0];
                  return { ...tr, reference_range: desc?.normal_range_text || null };
                }
                const existing = String(tr.reference_range ?? "").trim();
                if (existing) return tr;
                const resolved = resolveNormalRangeDisplay(rows, { gender, dob, unit: tr.unit });
                if (!resolved.text) return tr;
                return {
                  ...tr,
                  reference_range: resolved.text,
                  normal_range_low: tr.normal_range_low ?? resolved.low,
                  normal_range_high: tr.normal_range_high ?? resolved.high,
                };
              }),
            };
          });
        }
      }
    }

    // Prefer live registration demographics when approved snapshot is missing title
    // (older approvals omitted title from the doctor-approval query).
    if (regData && reportsArr.length > 0) {
      reportsArr = reportsArr.map((r: any) => ({
        ...r,
        title: r.title || regData.title || null,
        patient_name: r.patient_name || regData.patient_name || null,
        gender: r.gender || regData.gender || null,
        // Frozen snapshot first; fall back to live registration when the
        // snapshot never stored pickup free-text age (approval query omitted it).
        age_text: resolveReportAgeText(r.age_text, regData.age_text),
        dob: r.dob || regData.dob || null,
      }));
    }

    // Fallback: if any report is missing sample_collection_date (legacy approvals before
    // collection-date capture), derive it from MIN(sample_tubes.collected_at) for this registration.
    // Also build per-test collection datetimes so multi-visit samples page-break correctly.
    const { data: tubesForDates } = await supabase
      .from("sample_tubes")
      .select("test_ids, collected_at")
      .eq("registration_id", registrationId)
      .not("collected_at", "is", null);
    const byTest: Record<string, string> = {};
    for (const tube of tubesForDates || []) {
      const at = tube.collected_at as string;
      if (!at) continue;
      for (const tid of (Array.isArray(tube.test_ids) ? tube.test_ids : [])) {
        if (!tid) continue;
        if (!byTest[tid] || at < byTest[tid]) byTest[tid] = at;
      }
    }
    setCollectionDateByTestId(byTest);

    const needsCollectionFallback = reportsArr.some((r: any) => !r.sample_collection_date);
    let fallbackCollectionDate: string | null = null;
    if (needsCollectionFallback) {
      const times = Object.values(byTest).sort();
      fallbackCollectionDate = times[0] || null;
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
        computedLetterhead = await getCachedLetterheadPng(
          computedLayout.letterhead_pdf_path,
          urlData.publicUrl,
          convertPdfToImage,
        );
      }
    }

    // Helper: convert cross-origin image URL to inline data URL (IndexedDB-cached when possible)
    const urlToDataUrl = async (url: string, cacheKey?: string | null): Promise<string | null> => {
      return getOrFetchUrlAsDataUrl(url, cacheKey);
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
          sigUrl =
            (await getCachedSignatureDataUrl(sig.signature_image_path, sigUrlData.publicUrl)) ||
            sigUrlData.publicUrl;
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

    // Snip images — MUST be inlined as data URLs. Remote storage URLs +
    // html-to-image (esp. with cacheBust) hang the WhatsApp popup on "Downloading…".
    const snipPages: SnipPage[] = [];
    const rawSnipUrls: string[] = [];
    const snipIds = new Set<string>();
    (snips || []).forEach((s: any) => {
      if (selectedTestIds && !selectedTestIds.has(s.test_id)) return;
      if (!isSnipResultRow(s)) return;
      snipIds.add(s.test_id);
      snipImageUrlsFromRow(s).forEach((url: string) => rawSnipUrls.push(url));
    });
    const inlinedSnipUrls = await Promise.all(rawSnipUrls.map(async (u) => {
      const marker = "/outsourced-snips/";
      const idx = u.indexOf(marker);
      const path = idx >= 0
        ? decodeURIComponent(u.slice(idx + marker.length).split("?")[0] || "")
        : "";
      const cacheKey = path
        ? reportAssetCacheKey("outsourced-snips", path)
        : `url:${u}`;
      try {
        return await withTimeout(urlToDataUrl(u, cacheKey), 30_000, "snip image download");
      } catch (e) {
        console.error("Failed to inline snip image:", u, e);
        return null;
      }
    }));
    const failedSnips = inlinedSnipUrls.filter((u) => !u).length;
    if (failedSnips > 0) {
      toast.error(`Could not load ${failedSnips} snipped report image(s) for PDF`);
    }
    inlinedSnipUrls.forEach((url) => {
      if (url) snipPages.push({ imageUrl: url });
    });

    // Inline snapshot signature URLs embedded in approved_reports.test_results JSONB
    for (const r of filteredReports) {
      const trs = (r.test_results || []) as any[];
      for (const tr of trs) {
        const params = (tr.parameters || []) as any[];
        for (const p of params) {
          if (p.approved_by_signature_url && typeof p.approved_by_signature_url === "string" && !p.approved_by_signature_url.startsWith("data:")) {
            const sigUrl = String(p.approved_by_signature_url);
            const marker = "/signatures/";
            const idx = sigUrl.indexOf(marker);
            const sigPath = idx >= 0 ? decodeURIComponent(sigUrl.slice(idx + marker.length).split("?")[0] || "") : "";
            const cacheKey = sigPath ? reportAssetCacheKey("signatures", sigPath) : `url:${sigUrl}`;
            const dataUrl = await urlToDataUrl(sigUrl, cacheKey);
            if (dataUrl) p.approved_by_signature_url = dataUrl;
          }
        }
      }
    }

    // Fetch test_parameters for hierarchy
    let computedTpMap: Record<string, any[]> = {};
    const uniqueTestIds: string[] = [...new Set(filteredReports.flatMap((r: any) =>
      ((r.test_results || []) as TestResultEntry[]).map(tr => tr.test_id)
    ))] as string[];
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
    setSnipModeTestIds(snipIds);
    setTestParamsMap(computedTpMap);
    setPickupFooterNote(computedFooterNote);
    setLoading(false);

    } catch (err: any) {
      console.error("Failed to load report data:", err);
      toast.error("Failed to load report data");
      setLoading(false);
    }
  };

  // ── Build structured content ──
  const { pages, totalPages } = useMemo(() => {
    if (approvedReports.length === 0 && snipImages.length === 0) {
      return { pages: [] as PageContent[], totalPages: 0 };
    }

    // Snip-only reports still need a demography shell for header rendering.
    // Pagination below tolerates empty structured results.

    const topMm = (layoutSettings.top_margin_cm || 2.5) * 10;
    const bottomMm = (layoutSettings.bottom_margin_cm || 1.5) * 10;
    const footerNoteMm = pickupFooterNote
      ? 4 + Math.max(
          1,
          Math.ceil(pickupFooterNote.length / 110),
          pickupFooterNote.split(/\r?\n/).length,
        ) * 4
      : 0;
    const usableHeight = PAGE_HEIGHT_MM - topMm - bottomMm - HEADER_HEIGHT_MM - SIGNATURE_HEIGHT_MM - PAGE_NUM_HEIGHT_MM - footerNoteMm;

    // Merge all test_results from all approved reports
    const allResults: TestResultEntry[] = [];
    approvedReports.forEach((report: any) => {
      const results = (report.test_results || []) as TestResultEntry[];
      results.forEach(r => {
        if (snipModeTestIds.has(r.test_id)) return;
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

      // Build description lookup so the renderer's italic line under each parameter name is budgeted
      const descByParamId: Record<string, string | null> = {};
      tpOrder.forEach((tp: any) => {
        if (tp.parameter_id) descByParamId[tp.parameter_id] = tp.parameter_description ?? null;
      });

      const paramRowsHeight = sortedParams.reduce(
        (sum, p) => sum + rowHeightMm(p, descByParamId[p.parameter_id]),
        0,
      );

      // Profile sample-type chip can wrap when long
      const sampleHeaderExtraMm = (testInfo?.sample_type && String(testInfo.sample_type).length > 18) ? 3 : 0;

      // Standalone profiles draw a 2px divider + ~3mm gap between every parameter
      const standaloneAdjMm = (testInfo?.is_single_parameter)
        ? Math.max(0, sortedParams.length - 1) * STANDALONE_DIVIDER_MM
        : 0;

      let heightMm =
        PROFILE_HEADER_MM + sampleHeaderExtraMm +                   // blue profile bar (+ wrap)
        ((testInfo?.instrument_name || testInfo?.method) ? INSTRUMENT_LINE_MM : 0) +
        TABLE_HEADER_MM +
        paramRowsHeight +
        subheaderCount * SUBHEADER_MM +
        standaloneAdjMm +                                           // dividers between standalone params
        (blockTestNoteEarly ? TEST_NOTE_MM : 0) +
        (hasOutsourcedCaption ? OUTSOURCED_MM : 0) +
        interpretationMm(testInfo?.interpretation) +
        INTER_PROFILE_GAP_MM +
        SAFETY_PAD_MM;

      // Collect unique approvers for this test block
      const blockApprovers = [...new Set(sortedParams.map(p => p.approved_by).filter(Boolean))] as string[];

      const collectionDateIso = collectionDateByTestId[testId]
        || approvedReports[0]?.sample_collection_date
        || null;
      // Minute precision matches header "Collection:" display; same Print & Collect batch
      // shares one ISO timestamp so those tests stay on the same page.
      const collectionDateKey = collectionDateIso
        ? format(new Date(collectionDateIso), "yyyy-MM-dd HH:mm")
        : "unknown";

      const explicitDisplay = String(testInfo?.display_name || "").trim();
      // Single-param tests: prefer parameter name (e.g. "SGOT (AST)") over short test_name ("SGOT")
      // unless an explicit report display_name is configured on the test.
      let reportTestName = explicitDisplay || params[0]?.test_name || testInfo?.test_name || "Unknown Test";
      if (!explicitDisplay && testInfo?.is_single_parameter) {
        const leaf = sortedParams.find((p: any) => !p.is_subheader);
        const paramLabel = String(leaf?.parameter_name || "").trim();
        if (paramLabel) reportTestName = paramLabel;
      }

      testBlocks.push({
        testId,
        testName: reportTestName,
        departmentId: deptId,
        departmentName: deptName,
        departmentOrder: deptOrder,
        testOrder: (testInfo?.report_display_order ?? 9999),
        collectionDateKey,
        collectionDateIso,
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

    // Department hierarchy first (Haematology → Biochemistry → …), then collection
    // date/time so different timestamps still page-break without jumping to the PDF end.
    testBlocks.sort((a, b) => {
      if (a.departmentOrder !== b.departmentOrder) return a.departmentOrder - b.departmentOrder;
      if (a.collectionDateKey !== b.collectionDateKey) return a.collectionDateKey.localeCompare(b.collectionDateKey);
      if (a.testOrder !== b.testOrder) return a.testOrder - b.testOrder;
      return a.testName.localeCompare(b.testName);
    });

    // Build pages — new page when department changes OR collection date/time changes
    const allPages: PageContent[] = [];
    let currentPageBlocks: TestBlock[] = [];
    let usedHeight = DEPT_HEADER_MM;
    let currentDeptName: string | null = null;
    let currentDateKey: string | null = null;

    const collectApprovers = (blocks: TestBlock[]) => [...new Set(blocks.flatMap(b => b.approvers || []))];
    const flushPage = () => {
      if (currentPageBlocks.length === 0) return;
      allPages.push({
        type: "structured",
        departmentName: currentDeptName || "Results",
        testBlocks: currentPageBlocks,
        approvers: collectApprovers(currentPageBlocks),
        sampleCollectionDate: currentPageBlocks[0]?.collectionDateIso || null,
      });
      currentPageBlocks = [];
      usedHeight = DEPT_HEADER_MM;
    };

    testBlocks.forEach(block => {
      const dateChanged = currentDateKey != null && block.collectionDateKey !== currentDateKey;
      const deptChanged = currentDeptName != null && block.departmentName !== currentDeptName;

      if (block.dedicatedPage) {
        flushPage();
        currentDeptName = block.departmentName;
        currentDateKey = block.collectionDateKey;
        allPages.push({
          type: "structured",
          departmentName: block.departmentName,
          testBlocks: [block],
          approvers: collectApprovers([block]),
          sampleCollectionDate: block.collectionDateIso,
        });
        currentDeptName = null;
        currentDateKey = null;
        usedHeight = DEPT_HEADER_MM;
        return;
      }

      if (dateChanged || deptChanged) {
        flushPage();
      }

      if (currentPageBlocks.length > 0 && (usedHeight + block.estimatedHeightMm) > (usableHeight - FIT_TOLERANCE_MM)) {
        flushPage();
      }

      if (currentPageBlocks.length === 0) {
        currentDeptName = block.departmentName;
        currentDateKey = block.collectionDateKey;
        usedHeight = DEPT_HEADER_MM;
      }

      currentPageBlocks.push(block);
      usedHeight += block.estimatedHeightMm;
    });
    flushPage();

    // Add snip pages
    snipImages.forEach(snip => {
      allPages.push({ type: "snip", snipImage: snip.imageUrl });
    });

    return { pages: allPages, totalPages: allPages.length };
  }, [approvedReports, departments, testsMap, testParamsMap, snipImages, snipModeTestIds, layoutSettings, pickupFooterNote, collectionDateByTestId]);

  // ── PDF export ──
  const buildPdfBlob = async (): Promise<{ blob: Blob; filename: string } | null> => {
    if (!printRef.current) return null;
    const pageElements = printRef.current.querySelectorAll("[data-page]");
    if (pageElements.length === 0) return null;

    await waitForCaptureReady(printRef.current);

    const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const NATIVE_W = Math.round((PAGE_WIDTH_MM / 25.4) * 96);
    const NATIVE_H = Math.round((PAGE_HEIGHT_MM / 25.4) * 96);
    for (let i = 0; i < pageElements.length; i++) {
      if (i > 0) pdf.addPage();
      const el = pageElements[i] as HTMLElement;
      // Snip pages use lower pixelRatio inside captureWithRetry (photos hang at PR3).
      const jpeg = await captureWithRetry(el, NATIVE_W, NATIVE_H, "jpeg");
      pdf.addImage(jpeg, "JPEG", 0, 0, PAGE_WIDTH_MM, PAGE_HEIGHT_MM, undefined, "FAST");
    }

    const patientNameRaw = patientDisplayName(approvedReports[0]);
    const patientName = !approvedReports[0] || patientNameRaw === "—" ? "Report" : patientNameRaw;
    const invoiceNum = approvedReports[0]?.invoice_number || "";
    const filename = [patientName, invoiceNum].filter(Boolean).join(" ").replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim() + ".pdf";
    const blob = pdf.output("blob") as Blob;
    cachedPdfRef.current = { blob, filename };
    return { blob, filename };
  };

  const notifyQueueWa = (ok: boolean, error?: string) => {
    const payload = {
      type: "lims-report-wa-queue",
      registrationId,
      ok,
      error: error || null,
    };
    try {
      if (window.opener && !window.opener.closed) {
        window.opener.postMessage(payload, window.location.origin);
      }
    } catch (e) {
      console.warn("queueWa postMessage failed", e);
    }
    try {
      window.postMessage(payload, window.location.origin);
    } catch {
      // ignore
    }
  };

  const handleDownloadPdf = async () => {
    if (!printRef.current) return;
    setDownloading(true);
    try {
      const built = await buildPdfBlob();
      if (!built) { toast.error("No pages to export"); setDownloading(false); return; }

      const { blob, filename } = built;
      const invoiceNum = approvedReports[0]?.invoice_number || "";
      // Trigger browser download
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);

      if (isPublic) {
        try {
          const blobUrl = URL.createObjectURL(blob);
          window.open(blobUrl, "_blank");
          setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
        } catch (e) {
          console.warn("Could not open PDF in new tab:", e);
        }
        if (publicToken) {
          logEvent(publicToken, "downloaded", undefined, { mode: "public", invoice: invoiceNum });
        }
      }

      // Update print_date (skip for provisional preview — no approved_reports row)
      if (registrationId && !isProvisional) {
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
    if (invoiceNumberForBarcode && !invoiceBarcodePng) return;
    if (autoDownloadStartedRef.current) return;
    autoDownloadStartedRef.current = true;
    // Small delay to let layout settle (images, fonts)
    const t = setTimeout(() => { handleDownloadPdf(); }, 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPublic, loading, pages.length, invoiceBarcodePng]);

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

  // ── Auto-queue report PDF to WhatsApp Console (when queueWa=1) ──
  useEffect(() => {
    if (!queueWaRequested) return;
    if (loading) return;
    if (pages.length === 0) {
      if (autoQueueWaStartedRef.current) return;
      autoQueueWaStartedRef.current = true;
      const msg = "No report pages to export — snipped images may have failed to load";
      toast.error(msg);
      notifyQueueWa(false, msg);
      return;
    }
    if (invoiceNumberForBarcode && !invoiceBarcodePng) return;
    if (autoQueueWaStartedRef.current) return;
    autoQueueWaStartedRef.current = true;
    const t = setTimeout(async () => {
      setDownloading(true);
      try {
        const built = await buildPdfBlob();
        if (!built) throw new Error("No pages to export");
        const report = approvedReports[0];
        const phone = report?.mobile_number || registration?.mobile_number || "";
        if (!String(phone).replace(/\D/g, "").slice(-10)) {
          throw new Error("No mobile number available");
        }
        const invoiceNum = report?.invoice_number || registration?.invoice_number || "";
        const patientName = patientDisplayName(report || registration);
        const pendingRaw = (searchParams.get("pendingReports") || "").trim();
        const pendingLine = pendingRaw
          ? `Pending Reports : ${pendingRaw}`
          : "No Reports Pending";
        let portalLine = "";
        try {
          if (registrationId) {
            const created = await createShareLink(registrationId, invoiceNum, "dispatch");
            portalLine = `\nView online: ${created.url}`;
          }
        } catch (e) {
          console.warn("share link for report caption failed", e);
        }
        const caption =
          `*PH PathLabs — Lab Report*\n` +
          `Invoice No: ${invoiceNum}\n` +
          `Patient: ${patientName}\n` +
          `Your lab reports are ready.\n` +
          `${pendingLine}` +
          portalLine +
          `\n\nThank you for choosing PH PathLabs.\nLabLine: 6356 55 66 99`;
        const res = await enqueueReportForWhatsAppConsole({
          phone,
          patient_name: report?.patient_name || registration?.patient_name,
          registration_id: registrationId || null,
          invoice_number: String(invoiceNum || "report"),
          caption,
          blob: built.blob,
          filename: built.filename,
        });
        if (!res.ok) throw new Error(res.error || "Failed to queue report WhatsApp");
        if (registrationId && !isProvisional) {
          await supabase.from("approved_reports").update({ print_date: new Date().toISOString() }).eq("registration_id", registrationId);
        }
        setHasDownloadedOnce(true);
        toast.success("Report queued for WhatsApp (WA API)");
        notifyQueueWa(true);
        setTimeout(() => {
          try { window.close(); } catch { /* ignore */ }
        }, 600);
      } catch (err: any) {
        const msg = err?.message || "Failed to queue report WhatsApp";
        toast.error(msg);
        notifyQueueWa(false, msg);
      } finally {
        setDownloading(false);
      }
    }, 800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queueWaRequested, loading, pages.length, invoiceBarcodePng]);

  // ── Failed Console send: download PDF only (staff send manually) ──
  useEffect(() => {
    if (!manualWaRequested) return;
    if (loading) return;
    if (pages.length === 0) return;
    if (invoiceNumberForBarcode && !invoiceBarcodePng) return;
    if (autoManualWaStartedRef.current) return;
    autoManualWaStartedRef.current = true;
    const t = setTimeout(async () => {
      setDownloading(true);
      try {
        const built = await buildPdfBlob();
        if (!built) throw new Error("No pages to export");
        const url = URL.createObjectURL(built.blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = built.filename;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
        if (registrationId && !isProvisional) {
          await supabase.from("approved_reports").update({ print_date: new Date().toISOString() }).eq("registration_id", registrationId);
        }
        setHasDownloadedOnce(true);
        toast.success("PDF downloaded");
      } catch (err: any) {
        toast.error(err?.message || "Download failed");
      } finally {
        setDownloading(false);
      }
    }, 800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manualWaRequested, loading, pages.length, invoiceBarcodePng]);

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

      await waitForCaptureReady(printRef.current);

      const pageElements = printRef.current.querySelectorAll("[data-page]");
      if (pageElements.length === 0) { toast.error("No pages to print"); setShowLetterhead(originalLetterhead); setDownloading(false); return; }

      const imageUrls: string[] = [];
      const NATIVE_W = Math.round((PAGE_WIDTH_MM / 25.4) * 96);
      const NATIVE_H = Math.round((PAGE_HEIGHT_MM / 25.4) * 96);
      for (let i = 0; i < pageElements.length; i++) {
        const el = pageElements[i] as HTMLElement;
        imageUrls.push(await captureWithRetry(el, NATIVE_W, NATIVE_H, "jpeg"));
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
  const footerNoteMm = pickupFooterNote
    ? 4 + Math.max(
        1,
        Math.ceil(pickupFooterNote.length / 110),
        pickupFooterNote.split(/\r?\n/).length,
      ) * 4
    : 0;

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
        <Button variant="outline" onClick={goBackFromReport}>
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
          <Button variant="outline" size="sm" onClick={goBackFromReport}>
            <ArrowLeft className="h-4 w-4 sm:mr-1" />
            <span className="hidden sm:inline">Back</span>
          </Button>
        )}
        <h1 className="text-sm sm:text-xl font-bold truncate flex-1 min-w-0">
          <span className="hidden sm:inline">{isPublic ? "PH PathLabs · " : isProvisional ? "Provisional Report — " : "Report — "}</span>
          {patientDisplayName(report)} ({report.invoice_number})
        </h1>
        <div className="flex items-center gap-2 sm:gap-4 ml-auto flex-wrap">
          {!isPublic && (
            <>
              {!isProvisional && (
                <div className="flex items-center gap-2">
                  <Switch id="letterhead-toggle" checked={showLetterhead} onCheckedChange={setShowLetterhead} />
                  <Label htmlFor="letterhead-toggle" className="text-xs sm:text-sm cursor-pointer whitespace-nowrap">
                    <span className="hidden sm:inline">With </span>Letterhead
                  </Label>
                </div>
              )}
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

            {/* Provisional watermark */}
            {isProvisional && (
              <div
                className="absolute inset-0 flex items-center justify-center pointer-events-none"
                style={{ zIndex: 2, padding: "0 20mm", overflow: "hidden" }}
                aria-hidden="true"
              >
                <span
                  style={{
                    transform: "rotate(-35deg)",
                    fontSize: "64px",
                    fontWeight: 800,
                    color: "rgba(120,120,120,0.13)",
                    letterSpacing: "6px",
                    whiteSpace: "nowrap",
                    fontFamily: "Arial, sans-serif",
                  }}
                >
                  PROVISIONAL REPORT
                </span>
              </div>
            )}

            {/* Content layer */}
            <div className="relative" style={{ zIndex: 1, paddingTop: `${topMm}mm`, paddingBottom: `${bottomMm}mm`, paddingLeft: "8mm", paddingRight: "8mm", height: "100%", boxSizing: "border-box", display: "flex", flexDirection: "column" }}>
              {/* Patient Demographics */}
              <LimsReportHeader
                patientName={report.patient_name}
                title={report.title}
                gender={report.gender}
                dob={report.dob}
                ageText={report.age_text ?? null}
                umrNumber={report.umr_number}
                doctorName={report.doctor_name}
                mobileNumber={report.mobile_number}
                email={report.email}
                address={report.address}
                invoiceNumber={report.invoice_number}
                registrationDate={report.registration_date}
                sampleCollectionDate={page.sampleCollectionDate || report.sample_collection_date}
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
                    const availableHeight = PAGE_HEIGHT_MM - topMm - bottomMm - HEADER_HEIGHT_MM - SIGNATURE_HEIGHT_MM - PAGE_NUM_HEIGHT_MM - footerNoteMm;
                    return <AutoScaleContent maxHeightMm={availableHeight}>{resultsContent}</AutoScaleContent>;
                  }
                  return resultsContent;
                })()}

                {page.type === "snip" && page.snipImage && (
                  <div className="flex items-start justify-center h-full pt-1 overflow-hidden">
                    <img
                      data-snip-image="true"
                      src={page.snipImage}
                      alt="Outsourced Report"
                      className="max-w-full object-contain"
                      style={{
                        // Reserve full margins + header + signature band + page number + safety gap so snip never overlaps signature.
                        maxHeight: `${PAGE_HEIGHT_MM - topMm - bottomMm - HEADER_HEIGHT_MM - SIGNATURE_HEIGHT_MM - PAGE_NUM_HEIGHT_MM - footerNoteMm - 6}mm`,
                      }}
                    />
                  </div>
                )}
              </div>

              {/* Pickup point footer note (every page) */}
              {pickupFooterNote && (
                <div
                  className="mt-auto"
                  style={{
                    fontSize: "10px",
                    lineHeight: 1.35,
                    padding: "2mm 0 1mm",
                    borderTop: "1px solid #e5e5e5",
                    whiteSpace: "pre-wrap",
                    color: "#333",
                  }}
                >
                  {pickupFooterNote}
                </div>
              )}

              {/* Footer: invoice barcode (left) + doctor signatures (right) */}
              <div className={pickupFooterNote ? "" : "mt-auto"}>
                <div className="pt-1 border-t flex justify-between items-end gap-3 print:break-inside-avoid">
                  <ReportInvoiceBarcode
                    invoiceNumber={invoiceNumberForBarcode}
                    barcodePng={invoiceBarcodePng}
                  />
                  {!isProvisional && (() => {
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
                      <div className="ml-auto">
                        <ReportSignatureBlock
                          embedded
                          signatureUrl={fallback.signatureUrl}
                          pathologistName={fallback.pathologist_name}
                          qualification={fallback.qualification || undefined}
                          designation={fallback.designation || undefined}
                        />
                      </div>
                    );
                  }
                  return (
                    <div className="flex justify-end items-start gap-6 flex-nowrap ml-auto">
                      {uniqueSigs.map((sig, idx) => (
                        <div key={idx} className="text-center" style={{ minWidth: 0, flexShrink: 0 }}>
                          {sig.signatureUrl && <img src={sig.signatureUrl} crossOrigin="anonymous" alt="Signature" className="h-8 mx-auto mb-0" />}
                          <p className="font-semibold text-[10px] leading-tight" style={{ whiteSpace: "nowrap" }}>{sig.pathologist_name}</p>
                          {sig.qualification && <p className="text-[9px] leading-tight" style={{ color: "hsl(var(--muted-foreground))", whiteSpace: "nowrap" }}>{sig.qualification}</p>}
                          {sig.designation && <p className="text-[9px] leading-tight" style={{ color: "hsl(var(--muted-foreground))", whiteSpace: "nowrap" }}>{sig.designation}</p>}
                        </div>
                      ))}
                    </div>
                  );
                })()}
                </div>
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

    // Single parameter test: Parameter column uses report test label (display_name
    // or parameter name like "SGOT (AST)"), and drops italic description.
    if (block.isSingleParameter && results.length === 1 && !results[0].is_subheader) {
      const keptParamName = String(results[0].parameter_name || "").trim();
      const chosen = block.testName || keptParamName;
      results[0] = { ...results[0], parameter_name: chosen, parameter_description: undefined };
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
