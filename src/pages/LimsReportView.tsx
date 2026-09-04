import { useState, useEffect, useRef, useMemo, useLayoutEffect } from "react";
import { flushSync } from "react-dom";
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
import CbcHistogramCharts, { pageHasCbcTest, type AnalyzerHistogram } from "@/components/report/CbcHistogramCharts";
import AutoScaleContent from "@/components/report/AutoScaleContent";
import type { TestResult, ProfileMeta } from "@/components/report/ReportResultsSection";
import { toast } from "sonner";
import { format } from "date-fns";
import { logEvent, createShareLink } from "@/lib/reportShareLinks";
import { patientDisplayName } from "@/lib/patientDisplayName";
import { enqueueReportForWhatsAppConsole } from "@/lib/whatsappConsoleBridge";
import { reportPdfCacheKey, setCachedReportPdf, getCachedReportPdf } from "@/lib/reportPdfSessionCache";
import { resolveNormalRangeDisplay } from "@/lib/parameterNormalRange";
import { resolveReportAgeText } from "@/lib/patientAge";
import { renderCode128Png, replaceCanvasesWithPngImages } from "@/lib/code128Png";
import {
  getCachedLetterheadPng,
  getCachedSignatureDataUrl,
  getOrFetchUrlAsDataUrl,
  normalizeImageDataUrl,
  reportAssetCacheKey,
} from "@/lib/reportAssetCache";
import { isSnipResultRow, snipImageUrlsFromRow, composedPdfUrlFromRow } from "@/lib/outsourcedResultMode";
import { composedPdfPagesToPngs } from "@/lib/outsourcedPdfCompose";
import { healApprovedReportSnapshotFromLive } from "@/lib/patientResultLookup";
import {
  hasRenderableHistograms,
  healApprovedReportHistograms,
  mergeHistogramSnapshots,
  normalizeHistogramRows,
} from "@/lib/analyzerHistograms";
import ReportTrendCharts from "@/components/report/ReportTrendCharts";
import {
  buildReportHistoricalTrends,
  freezeApprovedReportHistoricalTrends,
  chunkTrendsForPages,
  orderParameterIdsByReportHierarchy,
  type TrendSeries,
} from "@/lib/reportHistoricalTrends";

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
        setTimeout(done, 2500);
      });
    })
  );
  // Two RAFs to let layout/paint settle after fonts/images load
  await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
  // Recharts SVGs need a paint tick before html-to-image capture
  if (root.querySelector("[data-historical-trends]")) {
    await new Promise<void>((r) => setTimeout(r, 100));
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
  }
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

type PageCaptureOptions = {
  /** Override html-to-image pixelRatio (default: snip 1.25 / structured 2). */
  pixelRatio?: number;
  /** JPEG quality 0–1 (default 0.9). */
  quality?: number;
  /** Force image cache bust (default: false — cacheBust breaks data: assets). */
  cacheBust?: boolean;
  attempts?: number;
  /** Skip expensive pixel blank-check when data URL looks non-empty (dispatch/fast). */
  fastBlankCheck?: boolean;
  /** Skip font embedding in html-to-image (much faster; webfonts already painted). */
  skipFonts?: boolean;
};

/** Run async work over items with a fixed concurrency pool (preserves result order). */
async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const run = async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  };
  const n = Math.max(1, Math.min(concurrency, items.length || 1));
  await Promise.all(Array.from({ length: n }, () => run()));
  return results;
};

// Capture a page with retries (handles intermittent blank captures from html-to-image).
// Always capture at full A4 CSS size; sharpness comes from pixelRatio (default 2).
// If a caller passes smaller width/height, scale the clone (do not crop overflow:hidden).
const A4_WIDTH_CSS_PX = Math.round((210 / 25.4) * 96); // ~794
const A4_HEIGHT_CSS_PX = Math.round((297 / 25.4) * 96); // ~1123

const captureWithRetry = async (
  el: HTMLElement,
  width: number,
  height: number,
  format: "png" | "jpeg",
  captureOpts?: PageCaptureOptions,
): Promise<string> => {
  const isSnipPage = !!el.querySelector("img[data-snip-image]");
  const pixelRatio = captureOpts?.pixelRatio ?? (isSnipPage ? 1.25 : 2);
  const attempts = captureOpts?.attempts ?? 2;
  const captureMs = isSnipPage ? 12_000 : 16_000;
  const jpegQuality = captureOpts?.quality ?? 0.9;
  // offsetWidth ignores CSS transform (previewScale), so this is the true A4 layout size.
  const layoutW = el.offsetWidth || A4_WIDTH_CSS_PX;
  const layoutH = el.offsetHeight || A4_HEIGHT_CSS_PX;
  const scale = Math.min(width / layoutW, height / layoutH);
  const opts = {
    pixelRatio,
    backgroundColor: "#ffffff",
    width,
    height,
    // Never default-bust: html-to-image appends ?t=… which breaks data: signature/letterhead URLs
    // and hung Dispatch WhatsApp PDF generation on multi-page reports.
    cacheBust: captureOpts?.cacheBust ?? false,
    skipFonts: captureOpts?.skipFonts ?? false,
    style: {
      // Clear previewScale; only downscale if caller asked for a smaller canvas (avoid crop).
      transform: scale < 0.999 ? `scale(${scale})` : "none",
      transformOrigin: "top left",
      width: `${layoutW}px`,
      height: `${layoutH}px`,
    } as Record<string, string>,
  };
  let lastUrl = "";
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      lastUrl = format === "png"
        ? await withTimeout(toPng(el, { ...opts, quality: 1 }), captureMs, "snip/page PNG capture")
        : await withTimeout(toJpeg(el, { ...opts, quality: jpegQuality }), captureMs, "page JPEG capture");
      // Fast path: non-tiny JPEG on first try is almost never a blank capture.
      if (captureOpts?.fastBlankCheck && attempt === 0 && lastUrl.length > 12_000) {
        return lastUrl;
      }
      const blank = await isBlankDataUrl(lastUrl);
      if (!blank) return lastUrl;
    } catch (e) {
      lastErr = e;
    }
    await new Promise((r) => setTimeout(r, 80));
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
const INTER_PROFILE_GAP_MM = 2;     // matches spacer outside profile; internal 1mm is inside measured block
const SAFETY_PAD_MM = 3;            // first-pass cushion only; measure-then-repack uses real heights
const FIT_TOLERANCE_MM = 2;         // never let estimate spill onto signature
const MEASURE_FIT_GAP_MM = 1.5;     // measured pack: keep this gap above signature top
const PX_PER_MM = 96 / 25.4;
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

// Length-aware interpretation height (first-pass estimate; measure-then-repack corrects)
const interpretationMm = (html?: string | null): number => {
  if (!html) return 0;
  const raw = String(html);
  const text = raw.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  if (!text) return 0;
  const blockBreaks = (raw.match(/<(?:p|div|li|br|tr|h[1-6])\b/gi) || []).length;
  const lines = Math.max(
    blockBreaks + 1,
    text.split(/\r?\n/).filter(Boolean).length,
    Math.ceil(text.length / 85),
  );
  return 6 /* "Interpretation:" label */ + lines * 4.2 + 2 /* padding */;
};

/** Pack tests into pages. Preserves department → collection datetime → test order. */
function packStructuredTestBlocks(
  testBlocks: TestBlock[],
  getHeightMm: (block: TestBlock, isFirstOnPage: boolean) => number,
  usableHeightMm: number,
  deptHeaderMm: number = DEPT_HEADER_MM,
): PageContent[] {
  const allPages: PageContent[] = [];
  let currentPageBlocks: TestBlock[] = [];
  let usedHeight = deptHeaderMm;
  let currentDeptName: string | null = null;
  let currentDateKey: string | null = null;
  const fitLimit = usableHeightMm - MEASURE_FIT_GAP_MM;

  const collectApprovers = (blocks: TestBlock[]) => [...new Set(blocks.flatMap((b) => b.approvers || []))];
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
    usedHeight = deptHeaderMm;
  };

  testBlocks.forEach((block) => {
    const dateChanged = currentDateKey != null && block.collectionDateKey !== currentDateKey;
    const deptChanged = currentDeptName != null && block.departmentName !== currentDeptName;

    if (block.dedicatedPage) {
      flushPage();
      allPages.push({
        type: "structured",
        departmentName: block.departmentName,
        testBlocks: [block],
        approvers: collectApprovers([block]),
        sampleCollectionDate: block.collectionDateIso,
      });
      currentDeptName = null;
      currentDateKey = null;
      usedHeight = deptHeaderMm;
      return;
    }

    if (dateChanged || deptChanged) {
      flushPage();
    }

    let isFirst = currentPageBlocks.length === 0;
    let blockH = getHeightMm(block, isFirst);
    if (!isFirst && usedHeight + blockH > fitLimit) {
      flushPage();
      isFirst = true;
      blockH = getHeightMm(block, true);
    }

    // Oversized first block still goes on its own page (never silently clip).
    if (isFirst && blockH + deptHeaderMm > fitLimit) {
      // keep packing; measure/overflow pass will bump if needed
    }

    if (isFirst) {
      currentDeptName = block.departmentName;
      currentDateKey = block.collectionDateKey;
      usedHeight = deptHeaderMm;
    }

    currentPageBlocks.push(block);
    usedHeight += blockH;
  });
  flushPage();
  return allPages;
}

function pagesFingerprint(pages: PageContent[]): string {
  return pages
    .map((p) => {
      if (p.type === "trends") {
        return `t:${(p.trends || []).map((t) => t.parameter_id).join(",")}`;
      }
      if (p.type !== "structured") return `${p.type}`;
      return `s:${p.departmentName}:${(p.testBlocks || []).map((b) => b.testId).join(",")}`;
    })
    .join("|");
}

function appendHistoricalTrendPages(pages: PageContent[], trends: TrendSeries[]): PageContent[] {
  if (!trends.length) return pages;
  const chunks = chunkTrendsForPages(trends);
  return [
    ...pages,
    ...chunks.map((chunk) => ({
      type: "trends" as const,
      trends: chunk,
      departmentName: "HISTORICAL TRENDS",
    })),
  ];
}

function snipPageToContent(
  snip: SnipPage,
  fallback?: {
    departmentName?: string;
    testName?: string;
    collectionDateIso?: string | null;
    approvers?: string[];
  },
): PageContent {
  const approvers = snip.approvedByDoctorCode
    ? [snip.approvedByDoctorCode]
    : snip.approvedBy
      ? [snip.approvedBy]
      : (fallback?.approvers?.length ? fallback.approvers : undefined);
  return {
    type: "snip",
    departmentName: snip.departmentName || fallback?.departmentName || "Results",
    snipImage: snip.imageUrl,
    snipTestId: snip.testId,
    snipTestName: snip.testName || fallback?.testName,
    snipScalePct: snip.scalePct,
    snipTopMarginPct: snip.topMarginPct,
    snipFullBleed: !!snip.fullBleed,
    sampleCollectionDate: fallback?.collectionDateIso || null,
    approvers,
  };
}

/**
 * Dense-pack structured pages, then attach each test's crop/snip pages after the
 * structured page that contains that test (histogram after CBC if enabled).
 * `orderedTestIds` keeps snip-only tests in department/test hierarchy after structured packing.
 */
function assembleReportPages(
  structuredPages: PageContent[],
  snipsByTest: Map<string, SnipPage[]>,
  opts: {
    enableHistograms: boolean;
    analyzerHistograms: AnalyzerHistogram[];
    orderedTestIds?: string[];
  },
): PageContent[] {
  const remaining = new Map<string, SnipPage[]>();
  snipsByTest.forEach((list, key) => {
    remaining.set(key, [...list]);
  });
  const out: PageContent[] = [];
  let histogramPageInserted = false;

  for (const page of structuredPages) {
    out.push(page);
    if (
      opts.enableHistograms
      && !histogramPageInserted
      && page.type === "structured"
      && pageHasCbcTest(page.testBlocks)
      && hasRenderableHistograms(opts.analyzerHistograms)
    ) {
      out.push({
        type: "histogram",
        departmentName: page.departmentName || "Haematology",
        histograms: opts.analyzerHistograms,
        approvers: page.approvers,
        sampleCollectionDate: page.sampleCollectionDate,
      });
      histogramPageInserted = true;
    }
    for (const block of page.testBlocks || []) {
      const snips = remaining.get(block.testId);
      if (!snips?.length) continue;
      remaining.delete(block.testId);
      for (const snip of snips) {
        out.push(snipPageToContent(snip, {
          departmentName: block.departmentName,
          testName: block.testName,
          collectionDateIso: block.collectionDateIso,
          approvers: block.approvers,
        }));
      }
    }
  }

  const emitRemainingFor = (testId: string) => {
    const snips = remaining.get(testId);
    if (!snips?.length) return;
    remaining.delete(testId);
    for (const snip of snips) out.push(snipPageToContent(snip));
  };

  for (const testId of opts.orderedTestIds || []) {
    emitRemainingFor(testId);
  }
  for (const testId of [...remaining.keys()]) {
    if (testId === "__orphan__") continue;
    emitRemainingFor(testId);
  }
  for (const snip of remaining.get("__orphan__") || []) {
    out.push(snipPageToContent(snip));
  }
  return out;
}

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
  approved_by_doctor_code?: string | null;
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
  testId?: string;
  testName?: string;
  departmentName?: string;
  scalePct?: number;
  topMarginPct?: number;
  /** Composed lab PDF page — already has letterhead + demographics; full-bleed. */
  fullBleed?: boolean;
  /** Who approved this snipped/outsourced test (from snip row or snapshot). */
  approvedBy?: string | null;
  /** Stable doctor code for signature lookup (preferred over name). */
  approvedByDoctorCode?: string | null;
}

interface PageContent {
  type: "structured" | "snip" | "histogram" | "trends";
  departmentName?: string;
  testBlocks?: TestBlock[];
  snipImage?: string;
  snipTestId?: string;
  snipTestName?: string;
  snipScalePct?: number;
  snipTopMarginPct?: number;
  snipFullBleed?: boolean;
  histograms?: AnalyzerHistogram[];
  trends?: TrendSeries[];
  approvers?: string[];
  /** Per-page sample collection datetime (ISO) — different date/time never share a page */
  sampleCollectionDate?: string | null;
}

interface SignatureInfo {
  doctor_code?: string | null;
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
  const eagerPdfStartedRef = useRef(false);
  const cachedPdfRef = useRef<{ blob: Blob; filename: string } | null>(null);
  const pdfBuildInFlightRef = useRef<Promise<{ blob: Blob; filename: string } | null> | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [hasDownloadedOnce, setHasDownloadedOnce] = useState(false);
  const [sharingWa, setSharingWa] = useState(false);
  const [showLetterhead, setShowLetterhead] = useState(!isProvisional);
  const enableHistograms = true;
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
  const [analyzerHistograms, setAnalyzerHistograms] = useState<AnalyzerHistogram[]>([]);
  const [historicalTrends, setHistoricalTrends] = useState<TrendSeries[]>([]);
  /** Hide trend/CBC fills for print & PDF (React omit — never removeChild). */
  const [hideChartFills, setHideChartFills] = useState(false);

  const invoiceNumberForBarcode =
    approvedReports[0]?.invoice_number || registration?.invoice_number || "";
  const [invoiceBarcodePng, setInvoiceBarcodePng] = useState<string | null>(null);
  /** True once barcode render attempted (success or fail) so queueWa cannot stall forever. */
  const [invoiceBarcodeReady, setInvoiceBarcodeReady] = useState(false);
  useEffect(() => {
    if (!invoiceNumberForBarcode) {
      setInvoiceBarcodePng(null);
      setInvoiceBarcodeReady(true);
      return;
    }
    setInvoiceBarcodeReady(false);
    setInvoiceBarcodePng(renderCode128Png(invoiceNumberForBarcode));
    setInvoiceBarcodeReady(true);
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
    setHistoricalTrends([]);
    cachedPdfRef.current = null;
    eagerPdfStartedRef.current = false;
    pdfBuildInFlightRef.current = null;
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

    let histRows: any[] = [];
    {
      const { data, error } = await supabase
        .from("analyzer_histograms")
        .select("kind, bins, discriminators, x_min, x_max, x_label, estimated, source, sample_id")
        .eq("registration_id", registrationId);
      if (!error) histRows = data || [];
    }

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
        .in("status", ["entered", "pending", "results_entered", "verified", "approved", "dispatched"]);
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
      try {
        await healApprovedReportHistograms(supabase, registrationId);
        const { data: healedReport } = await supabase
          .from("approved_reports")
          .select("histograms")
          .eq("registration_id", registrationId)
          .maybeSingle();
        if (healedReport) {
          reportsArr = reportsArr.map((r: any, i: number) =>
            i === 0 ? { ...r, histograms: (healedReport as any).histograms ?? r.histograms } : r,
          );
        }
      } catch (histHealErr) {
        console.warn("histogram snapshot heal skipped", histHealErr);
      }
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

    // Build signature map keyed by doctor_code (preferred) and name (legacy fallback).
    const sigMap: Record<string, SignatureInfo> = {};
    if (signatures && signatures.length > 0) {
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
          sigUrl =
            (await getCachedSignatureDataUrl(sig.signature_image_path, sigUrlData.publicUrl)) ||
            sigUrlData.publicUrl;
        }
        const code = String(sig.doctor_code || "").trim();
        const info: SignatureInfo = {
          doctor_code: code || null,
          pathologist_name: sig.pathologist_name,
          qualification: sig.qualification,
          designation: sig.designation,
          signatureUrl: sigUrl,
        };
        if (code) sigMap[code.toLowerCase()] = info;
        if (sig.pathologist_name) sigMap[sig.pathologist_name.toLowerCase()] = info;
        if (sig.mapped_user_id && userDisplayMap[sig.mapped_user_id]) {
          sigMap[userDisplayMap[sig.mapped_user_id].toLowerCase()] = info;
        }
      }
    }

    // Outsourced visuals: store high-res crops only; letterhead + demographics from report shell.
    // Resolve approver per test from snip row and/or approved snapshot (snip-only markers).
    const approverByTestId: Record<string, string> = {};
    const doctorCodeByTestId: Record<string, string> = {};
    let reportHeaderApprover: string | null = null;
    for (const r of filteredReports) {
      const headerBy = typeof (r as any)?.approved_by === "string" ? String((r as any).approved_by).trim() : "";
      if (headerBy && !reportHeaderApprover) reportHeaderApprover = headerBy;
      for (const tr of (r.test_results || []) as any[]) {
        const tid = tr?.test_id;
        const by = typeof tr?.approved_by === "string" ? tr.approved_by.trim() : "";
        const code = typeof tr?.approved_by_doctor_code === "string" ? tr.approved_by_doctor_code.trim() : "";
        if (tid && by && !approverByTestId[tid]) approverByTestId[tid] = by;
        if (tid && code && !doctorCodeByTestId[tid]) doctorCodeByTestId[tid] = code;
      }
    }
    const snipPages: SnipPage[] = [];
    const snipIds = new Set<string>();
    for (const s of snips || []) {
      if (selectedTestIds && !selectedTestIds.has(s.test_id)) continue;
      if (!isSnipResultRow(s)) continue;
      snipIds.add(s.test_id);
      let urls = snipImageUrlsFromRow(s);
      // Legacy: letterhead-baked composed PDF only when no crop images exist.
      if (urls.length === 0) {
        const composedUrl = composedPdfUrlFromRow(s);
        if (composedUrl) {
          try {
            urls = await withTimeout(composedPdfPagesToPngs(composedUrl, 2), 60_000, "composed pdf render");
          } catch (e) {
            console.error("Failed to render composed PDF:", composedUrl, e);
            toast.error("Could not load composed outsourced PDF for report");
            continue;
          }
        }
      }
      if (urls.length === 0) continue;
      const legacyFullBleed = snipImageUrlsFromRow(s).length === 0 && !!composedPdfUrlFromRow(s);
      const snipApprovedByCode =
        (typeof s.approved_by_doctor_code === "string" && s.approved_by_doctor_code.trim()) ||
        doctorCodeByTestId[s.test_id] ||
        null;
      const snipApprovedBy =
        (typeof s.approved_by === "string" && s.approved_by.trim()) ||
        approverByTestId[s.test_id] ||
        reportHeaderApprover ||
        null;
      for (let i = 0; i < urls.length; i++) {
        const u = urls[i];
        const marker = "/outsourced-snips/";
        const idx = u.indexOf(marker);
        const path = idx >= 0
          ? decodeURIComponent(u.slice(idx + marker.length).split("?")[0] || "")
          : "";
        const cacheKey = path
          ? reportAssetCacheKey("outsourced-snips", path)
          : `url:${u}`;
        try {
          const dataUrl = u.startsWith("data:")
            ? u
            : await withTimeout(urlToDataUrl(u, cacheKey), 30_000, "snip image download");
          if (dataUrl) {
            const testInfo = tMap[s.test_id];
            const deptId = testInfo?.department_id || null;
            const deptName = deptId
              ? ((depts || []).find((d: any) => d.id === deptId)?.department_name || "Other")
              : "Other";
            snipPages.push({
              imageUrl: dataUrl,
              testId: s.test_id,
              testName: testInfo?.display_name || testInfo?.test_name || "Outsourced",
              departmentName: deptName,
              scalePct: 100,
              topMarginPct: 0,
              fullBleed: legacyFullBleed,
              approvedBy: snipApprovedBy,
              approvedByDoctorCode: snipApprovedByCode,
            });
          }
        } catch (e) {
          console.error("Failed to inline snip image:", u, e);
          toast.error("Could not load snipped report image for PDF");
        }
      }
    }
    // Inline / normalize snapshot signature URLs in approved_reports.test_results.
    // Prefer live pathologist_signatures by approved_by_doctor_code (stable), then name.
    // Legacy rows may still have data:/http URLs — keep those working until healed.
    const inlineSignatureUrl = async (raw: unknown): Promise<string | null> => {
      if (typeof raw !== "string" || !raw.trim()) return null;
      if (raw.startsWith("data:")) return normalizeImageDataUrl(raw) || raw;
      const marker = "/signatures/";
      const idx = raw.indexOf(marker);
      const sigPath = idx >= 0 ? decodeURIComponent(raw.slice(idx + marker.length).split("?")[0] || "") : "";
      const cacheKey = sigPath ? reportAssetCacheKey("signatures", sigPath) : `url:${raw}`;
      return (await urlToDataUrl(raw, cacheKey)) || null;
    };
    const liveSigFor = (doctorCode: unknown, approvedBy: unknown): SignatureInfo | null => {
      const code = String(doctorCode || "").trim().toLowerCase();
      if (code && sigMap[code]) return sigMap[code];
      const name = String(approvedBy || "").trim().toLowerCase();
      if (name && sigMap[name]) return sigMap[name];
      return null;
    };
    const resolveSignatureForApprover = (doctorCode: unknown, approvedBy: unknown, embeddedUrl: unknown): string | null => {
      const live = liveSigFor(doctorCode, approvedBy);
      if (live?.signatureUrl) return live.signatureUrl;
      if (typeof embeddedUrl === "string" && embeddedUrl.trim()) return embeddedUrl.trim();
      return null;
    };
    for (const r of filteredReports) {
      const trs = (r.test_results || []) as any[];
      for (const tr of trs) {
        const by = tr.approved_by;
        const code = tr.approved_by_doctor_code;
        const fromLive = resolveSignatureForApprover(code, by, null);
        if (fromLive) {
          tr.approved_by_signature_url = fromLive;
        } else if (tr.approved_by_signature_url) {
          const fixed = await inlineSignatureUrl(tr.approved_by_signature_url);
          if (fixed) tr.approved_by_signature_url = fixed;
        }
        const live = liveSigFor(code, by);
        if (live) {
          if (!tr.approved_by_doctor_code && live.doctor_code) tr.approved_by_doctor_code = live.doctor_code;
          // Prefer live display name/qual/desig so renamed doctors still print correctly.
          if (live.pathologist_name) tr.approved_by = live.pathologist_name;
          if (live.qualification) tr.approved_by_qualification = live.qualification;
          if (live.designation) tr.approved_by_designation = live.designation;
        }
        const params = (tr.parameters || []) as any[];
        for (const p of params) {
          const pBy = p.approved_by || by;
          const pCode = p.approved_by_doctor_code || code;
          const pLiveUrl = resolveSignatureForApprover(pCode, pBy, null);
          if (pLiveUrl) {
            p.approved_by_signature_url = pLiveUrl;
          } else if (p.approved_by_signature_url) {
            const fixed = await inlineSignatureUrl(p.approved_by_signature_url);
            if (fixed) p.approved_by_signature_url = fixed;
          }
          const pLive = liveSigFor(pCode, pBy);
          if (pLive) {
            if (!p.approved_by_doctor_code && pLive.doctor_code) p.approved_by_doctor_code = pLive.doctor_code;
            if (pLive.pathologist_name) p.approved_by = pLive.pathologist_name;
            if (pLive.qualification) p.approved_by_qualification = pLive.qualification;
            if (pLive.designation) p.approved_by_designation = pLive.designation;
          }
        }
      }
    }

    // Fetch test_parameters for hierarchy
    let computedTpMap: Record<string, any[]> = {};
    const uniqueTestIds: string[] = [...new Set([
      ...filteredReports.flatMap((r: any) =>
        ((r.test_results || []) as TestResultEntry[]).map(tr => tr.test_id).filter(Boolean),
      ),
      ...snipPages.map((s) => s.testId).filter(Boolean) as string[],
    ])] as string[];
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
    const snapshotHists = normalizeHistogramRows((filteredReports[0] as any)?.histograms);
    const liveHists = normalizeHistogramRows(histRows);
    setAnalyzerHistograms(mergeHistogramSnapshots(snapshotHists, liveHists));

    let trends: TrendSeries[] = [];
    try {
      const rawParameterIds = Array.from(
        new Set(
          filteredReports.flatMap((r: any) =>
            ((r.test_results || []) as TestResultEntry[])
              .filter((tr) => tr.result_value && String(tr.result_value).trim() && tr.parameter_id)
              .map((tr) => String(tr.parameter_id)),
          ),
        ),
      );
      // Same hierarchy as report body: department → test → parameter display_order
      const hierarchyResults = filteredReports.flatMap((r: any) =>
        ((r.test_results || []) as TestResultEntry[]).map((tr) => ({
          parameter_id: tr.parameter_id,
          test_id: tr.test_id,
        })),
      );
      const reportParameterIds = orderParameterIdsByReportHierarchy({
        parameterIds: rawParameterIds,
        results: hierarchyResults,
        departments: depts || [],
        testsMap: tMap,
        testParamsMap: computedTpMap,
      });
      const primaryReport = filteredReports[0] as any;
      const currentVisitResults = filteredReports.flatMap((r: any) =>
        ((r.test_results || []) as TestResultEntry[]).map((tr) => ({
          parameter_id: tr.parameter_id,
          param_code: (tr as any).param_code,
          parameter_name: tr.parameter_name,
          result_value: tr.result_value,
          unit: tr.unit,
          normal_range_low: tr.normal_range_low,
          normal_range_high: tr.normal_range_high,
          reference_range: tr.reference_range,
          flag: tr.flag,
        })),
      );
      const asOfIso =
        primaryReport?.sample_collection_date
        || primaryReport?.approval_date
        || primaryReport?.registration_date
        || regData?.created_at
        || null;
      const built = await buildReportHistoricalTrends({
        umrNumber: regData?.umr_number || primaryReport?.umr_number,
        registrationId: registrationId!,
        reportParameterIds,
        isProvisional,
        frozenTrends: primaryReport?.historical_trends,
        asOfIso,
        currentVisitResults,
        currentVisitDateIso: asOfIso,
        gender: primaryReport?.gender || regData?.gender || null,
        dob: primaryReport?.dob || regData?.dob || null,
      });
      trends = built.trends;
      // Sync freeze: add newly enabled analytics params, prune disabled ones, keep hierarchy order.
      if (!isProvisional && registrationId) {
        try {
          await freezeApprovedReportHistoricalTrends(registrationId, trends);
        } catch (freezeErr) {
          console.warn("Could not freeze historical trends:", freezeErr);
        }
      }
    } catch (trendErr) {
      console.warn("Historical trends skipped:", trendErr);
      trends = [];
    }
    setHistoricalTrends(trends);
    setLoading(false);

    } catch (err: any) {
      console.error("Failed to load report data:", err);
      toast.error("Failed to load report data");
      setLoading(false);
    }
  };

  // ── Build structured content (first-pass estimate pack) ──
  const packPlan = useMemo(() => {
    if (approvedReports.length === 0 && snipImages.length === 0) {
      return {
        pages: [] as PageContent[],
        totalPages: 0,
        sortedTestBlocks: [] as TestBlock[],
        usableHeightMm: 0,
        packKey: "empty",
      };
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

    // Merge all test_results from all approved reports (include params even when snips exist)
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
        SAFETY_PAD_MM;

      // Collect unique approvers for this test block (prefer stable doctor_code).
      const blockApprovers = [...new Set(sortedParams.map(p =>
        (p.approved_by_doctor_code && String(p.approved_by_doctor_code).trim())
        || p.approved_by
      ).filter(Boolean))] as string[];

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

    // Pack per test in department/test hierarchy: structured params first, then that test's snips.
    const snipsByTest = new Map<string, SnipPage[]>();
    for (const snip of snipImages) {
      const tid = snip.testId || "__orphan__";
      const list = snipsByTest.get(tid) || [];
      list.push(snip);
      snipsByTest.set(tid, list);
    }

    const blockById = new Map(testBlocks.map((b) => [b.testId, b]));
    const orderedTestIds: string[] = [];
    const seenOrder = new Set<string>();
    for (const b of testBlocks) {
      orderedTestIds.push(b.testId);
      seenOrder.add(b.testId);
    }
    // Snip-only tests (no typed params) — insert in same dept/test hierarchy
    const snipOnlyMeta = [...snipsByTest.keys()]
      .filter((id) => id !== "__orphan__" && !seenOrder.has(id))
      .map((testId) => {
        const testInfo = testsMap[testId];
        const deptId = testInfo?.department_id || null;
        return {
          testId,
          departmentOrder: deptId ? (deptOrderMap[deptId] ?? 999) : 999,
          testOrder: (testInfo?.report_display_order ?? 9999),
          testName: testInfo?.test_name || testId,
        };
      })
      .sort((a, b) => {
        if (a.departmentOrder !== b.departmentOrder) return a.departmentOrder - b.departmentOrder;
        if (a.testOrder !== b.testOrder) return a.testOrder - b.testOrder;
        return a.testName.localeCompare(b.testName);
      });

    // Merge snip-only into ordered list by sort key
    const mergedIds: string[] = [];
    {
      let i = 0;
      let j = 0;
      const structuredMeta = testBlocks.map((b) => ({
        testId: b.testId,
        departmentOrder: b.departmentOrder,
        testOrder: b.testOrder,
        testName: b.testName,
      }));
      while (i < structuredMeta.length || j < snipOnlyMeta.length) {
        const a = structuredMeta[i];
        const b = snipOnlyMeta[j];
        if (!b || (a && (
          a.departmentOrder < b.departmentOrder
          || (a.departmentOrder === b.departmentOrder && a.testOrder < b.testOrder)
          || (a.departmentOrder === b.departmentOrder && a.testOrder === b.testOrder && a.testName.localeCompare(b.testName) <= 0)
        ))) {
          mergedIds.push(a.testId);
          i++;
        } else {
          mergedIds.push(b.testId);
          j++;
        }
      }
    }

    const structuredPages = packStructuredTestBlocks(
      testBlocks,
      (blk, isFirst) => blk.estimatedHeightMm + (isFirst ? 0 : INTER_PROFILE_GAP_MM),
      usableHeight - FIT_TOLERANCE_MM,
    );
    const pagesWithHistograms = assembleReportPages(structuredPages, snipsByTest, {
      enableHistograms,
      analyzerHistograms,
      orderedTestIds: mergedIds,
    });
    const pagesWithTrends = appendHistoricalTrendPages(pagesWithHistograms, historicalTrends);

    return {
      pages: pagesWithTrends,
      totalPages: pagesWithTrends.length,
      sortedTestBlocks: testBlocks,
      usableHeightMm: usableHeight,
      packKey: pagesFingerprint(pagesWithTrends) + `|u${usableHeight.toFixed(1)}|tr${historicalTrends.length}`,
    };
  }, [approvedReports, departments, testsMap, testParamsMap, snipImages, snipModeTestIds, layoutSettings, pickupFooterNote, collectionDateByTestId, analyzerHistograms, enableHistograms, historicalTrends]);

  const [measuredPages, setMeasuredPages] = useState<PageContent[] | null>(null);
  const [paginationReady, setPaginationReady] = useState(false);
  const paginationReadyRef = useRef(false);
  const measurePassRef = useRef(0);

  useEffect(() => {
    paginationReadyRef.current = paginationReady;
  }, [paginationReady]);

  useEffect(() => {
    setMeasuredPages(null);
    setPaginationReady(false);
    measurePassRef.current = 0;
  }, [packPlan.packKey]);

  const pages = measuredPages ?? packPlan.pages;
  const totalPages = pages.length;

  useLayoutEffect(() => {
    if (loading || !printRef.current) return;
    if (packPlan.sortedTestBlocks.length === 0) {
      setPaginationReady(true);
      return;
    }
    if (measurePassRef.current >= 4) {
      setPaginationReady(true);
      return;
    }

    let cancelled = false;
    const run = async () => {
      try {
        if ((document as any).fonts?.ready) await (document as any).fonts.ready;
      } catch {}
      await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
      if (cancelled || !printRef.current) return;

      const root = printRef.current;
      const measured = new Map<string, number>();
      root.querySelectorAll<HTMLElement>("[data-pdf-test-id]").forEach((el) => {
        const id = el.getAttribute("data-pdf-test-id");
        if (!id) return;
        const hMm = el.offsetHeight / PX_PER_MM;
        if (hMm > 0) measured.set(id, Math.max(measured.get(id) || 0, hMm));
      });

      let usableMm = packPlan.usableHeightMm;
      let deptHeaderMm = DEPT_HEADER_MM;
      const firstPage =
        root.querySelector<HTMLElement>('[data-page][data-page-type="structured"]') ||
        root.querySelector<HTMLElement>("[data-page]");
      if (firstPage) {
        const content = firstPage.querySelector<HTMLElement>("[data-report-content]");
        // Use the flex content box height only (excludes pickup note + signature band below it).
        if (content && content.clientHeight > 0) {
          const slotMm = content.clientHeight / PX_PER_MM;
          if (slotMm > 40) usableMm = slotMm;
        }
        const deptHeader = firstPage.querySelector<HTMLElement>("[data-report-dept-header]");
        if (deptHeader && deptHeader.offsetHeight > 0) {
          deptHeaderMm = deptHeader.offsetHeight / PX_PER_MM;
        }
      }

      let overflowDetected = false;
      root.querySelectorAll<HTMLElement>("[data-page]").forEach((pageEl) => {
        if (pageEl.getAttribute("data-page-type") !== "structured") return;
        const content = pageEl.querySelector<HTMLElement>("[data-report-content]");
        const signature = pageEl.querySelector<HTMLElement>("[data-report-signature]");
        if (!content || !signature) return;
        // flex-1 box fills to signature; detect true child overflow only.
        if (content.scrollHeight > content.clientHeight + 2) {
          overflowDetected = true;
          return;
        }
        const kids = Array.from(content.children) as HTMLElement[];
        if (kids.length === 0) return;
        const last = kids[kids.length - 1];
        const childBottom = last.offsetTop + last.offsetHeight;
        // Relative to content box; leave a tiny gap above signature.
        if (childBottom > content.clientHeight - 1) overflowDetected = true;
      });

      if (measured.size === 0 && !overflowDetected) {
        if (packPlan.sortedTestBlocks.length > 0 && measurePassRef.current < 3) {
          measurePassRef.current += 1;
          await new Promise((r) => setTimeout(r, 80));
          if (cancelled || !printRef.current) return;
          // Fall through by re-querying below via a nested remount pass.
        } else {
          setPaginationReady(true);
          return;
        }
      }

      // Re-measure after paint retry
      if (measured.size === 0 && packPlan.sortedTestBlocks.length > 0) {
        root.querySelectorAll<HTMLElement>("[data-pdf-test-id]").forEach((el) => {
          const id = el.getAttribute("data-pdf-test-id");
          if (!id) return;
          const hMm = el.offsetHeight / PX_PER_MM;
          if (hMm > 0) measured.set(id, Math.max(measured.get(id) || 0, hMm));
        });
        if (measured.size === 0 && !overflowDetected) {
          setPaginationReady(true);
          return;
        }
      }

      const getHeight = (block: TestBlock, isFirst: boolean) => {
        const base = measured.get(block.testId) ?? block.estimatedHeightMm;
        // On overflow, prefer bumping measured heights slightly (fonts/images may still settle).
        const bump = overflowDetected ? (measured.has(block.testId) ? 2 : 8) : 0;
        return base + bump + (isFirst ? 0 : INTER_PROFILE_GAP_MM);
      };

      // Source of truth: re-pack ALL structured blocks with measured heights (fills whitespace),
      // then re-attach snip/crop pages from the current plan.
      const snipsMap = new Map<string, SnipPage[]>();
      const orderedTestIds: string[] = [];
      const seenTests = new Set<string>();
      for (const b of packPlan.sortedTestBlocks) {
        orderedTestIds.push(b.testId);
        seenTests.add(b.testId);
      }
      for (const pg of packPlan.pages) {
        if (pg.type !== "snip" || !pg.snipImage) continue;
        const key = pg.snipTestId
          || packPlan.sortedTestBlocks.find((b) => b.testName === pg.snipTestName)?.testId
          || "__orphan__";
        const list = snipsMap.get(key) || [];
        list.push({
          imageUrl: pg.snipImage,
          testId: key === "__orphan__" ? undefined : key,
          testName: pg.snipTestName,
          departmentName: pg.departmentName,
          scalePct: pg.snipScalePct,
          topMarginPct: pg.snipTopMarginPct,
          fullBleed: pg.snipFullBleed,
          approvedBy: (() => {
            const a = pg.approvers?.[0];
            if (!a) return null;
            const live = signatureMap[a.toLowerCase()];
            return live?.pathologist_name || a;
          })(),
          approvedByDoctorCode: (() => {
            const a = pg.approvers?.[0];
            if (!a) return null;
            const live = signatureMap[a.toLowerCase()];
            return live?.doctor_code || null;
          })(),
        });
        snipsMap.set(key, list);
        if (key !== "__orphan__" && !seenTests.has(key)) {
          orderedTestIds.push(key);
          seenTests.add(key);
        }
      }

      const structured = packStructuredTestBlocks(
        packPlan.sortedTestBlocks,
        getHeight,
        Math.max(40, usableMm),
        deptHeaderMm,
      );
      const nextPages = appendHistoricalTrendPages(
        assembleReportPages(structured, snipsMap, {
          enableHistograms,
          analyzerHistograms,
          orderedTestIds,
        }),
        historicalTrends,
      );

      measurePassRef.current += 1;
      if (pagesFingerprint(nextPages) !== pagesFingerprint(pages)) {
        setMeasuredPages(nextPages);
        setPaginationReady(false);
      } else {
        setPaginationReady(true);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [loading, packPlan, pages, enableHistograms, analyzerHistograms, historicalTrends]);


  /**
   * Print-only: hide CBC/trend shaded fills without mutating React SVG via removeChild.
   * Download PDF keeps shades (do not wrap buildPdfBlob with this).
   */
  const withChartFillsHiddenForCapture = async <T,>(
    fn: () => Promise<T>,
    opts?: { stripLetterhead?: boolean },
  ): Promise<T> => {
    const root = printRef.current;
    flushSync(() => setHideChartFills(true));
    if (root) {
      root.classList.add("print-strip-colors");
      if (opts?.stripLetterhead) root.classList.add("print-no-letterhead");
    }
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
    try {
      return await fn();
    } finally {
      if (root) {
        root.classList.remove("print-strip-colors", "print-no-letterhead");
      }
      flushSync(() => setHideChartFills(false));
      await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
    }
  };

  /** Yield so the browser can paint/GC between heavy page rasters (helps low-RAM PCs). */
  const yieldToMain = () =>
    new Promise<void>((resolve) => {
      if (typeof (window as any).scheduler?.yield === "function") {
        (window as any).scheduler.yield().then(() => resolve(), () => resolve());
        return;
      }
      setTimeout(() => resolve(), 0);
    });

  const buildPdfBlob = async (_opts?: {
    /** Kept for callers; quality stays full; pages are captured sequentially for low-RAM PCs. */
    queueMode?: boolean;
  }): Promise<{ blob: Blob; filename: string } | null> => {
    if (!printRef.current && !cachedPdfRef.current) return null;

    const cacheKey = registrationId
      ? reportPdfCacheKey(registrationId, selectedTestIdsParam)
      : "";
    if (cacheKey) {
      const hit = await getCachedReportPdf(cacheKey);
      if (hit) {
        cachedPdfRef.current = { blob: hit.blob, filename: hit.filename };
        return { blob: hit.blob, filename: hit.filename };
      }
    }
    if (cachedPdfRef.current) return cachedPdfRef.current;
    if (pdfBuildInFlightRef.current) return pdfBuildInFlightRef.current;

    const run = (async (): Promise<{ blob: Blob; filename: string } | null> => {
      if (!printRef.current) return null;

      // Wait for measure-then-repack to settle so export matches densest safe layout.
      const waitStart = Date.now();
      while (!paginationReadyRef.current && Date.now() - waitStart < 6_000) {
        await new Promise((r) => setTimeout(r, 25));
      }

      const pageElements = Array.from(printRef.current.querySelectorAll("[data-page]")) as HTMLElement[];
      if (pageElements.length === 0) return null;

      await waitForCaptureReady(printRef.current);

      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const NATIVE_W = Math.round((PAGE_WIDTH_MM / 25.4) * 96);
      const NATIVE_H = Math.round((PAGE_HEIGHT_MM / 25.4) * 96);
      // Full A4 @ PR2 / JPEG 0.9 — same visual quality. Capture ONE page at a time
      // (parallel pages OOM low-spec PCs on large reports e.g. 100+ tests + trends).
      const captureOpts: PageCaptureOptions = {
        pixelRatio: 2,
        attempts: 1,
        quality: 0.9,
        cacheBust: false,
        fastBlankCheck: true,
        // Fonts are already painted in the DOM; re-embedding them is very costly.
        skipFonts: true,
      };

      const wrappers = pageElements.map((el) => el.parentElement as HTMLElement | null);
      const prevVisibility = wrappers.map((w) => (w ? w.style.visibility : ""));
      const prevContentVis = wrappers.map((w) => (w ? (w.style as any).contentVisibility || "" : ""));

      try {
        for (let i = 0; i < pageElements.length; i++) {
          wrappers.forEach((w, j) => {
            if (!w) return;
            if (j === i) {
              w.style.visibility = "visible";
              (w.style as any).contentVisibility = "visible";
            } else {
              w.style.visibility = "hidden";
              (w.style as any).contentVisibility = "hidden";
            }
          });
          await yieldToMain();

          let jpegUrl = await captureWithRetry(
            pageElements[i],
            NATIVE_W,
            NATIVE_H,
            "jpeg",
            captureOpts,
          );
          if (i > 0) pdf.addPage();
          pdf.addImage(jpegUrl, "JPEG", 0, 0, PAGE_WIDTH_MM, PAGE_HEIGHT_MM, undefined, "MEDIUM");
          jpegUrl = "";
          if (
            queueWaRequested &&
            (i === 0 || i === pageElements.length - 1 || (i + 1) % 4 === 0)
          ) {
            toast.message(`Building report PDF… ${i + 1}/${pageElements.length} pages`);
          }
          await yieldToMain();
        }
      } finally {
        wrappers.forEach((w, j) => {
          if (!w) return;
          w.style.visibility = prevVisibility[j];
          (w.style as any).contentVisibility = prevContentVis[j];
        });
      }

      const patientNameRaw = patientDisplayName(approvedReports[0]);
      const patientName = !approvedReports[0] || patientNameRaw === "—" ? "Report" : patientNameRaw;
      const invoiceNum = approvedReports[0]?.invoice_number || "";
      const filename = [patientName, invoiceNum].filter(Boolean).join(" ").replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim() + ".pdf";
      const blob = pdf.output("blob") as Blob;
      cachedPdfRef.current = { blob, filename };
      if (cacheKey) await setCachedReportPdf(cacheKey, blob, filename);
      return { blob, filename };
    })();

    pdfBuildInFlightRef.current = run;
    try {
      return await run;
    } finally {
      if (pdfBuildInFlightRef.current === run) pdfBuildInFlightRef.current = null;
    }
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
    if (!printRef.current && !cachedPdfRef.current) return;
    setDownloading(true);
    try {
      // Always use full-quality capture; reuse session/eager cache when present.
      const built = cachedPdfRef.current || await buildPdfBlob({ queueMode: true });
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
    if (!invoiceBarcodeReady) return;
    if (autoDownloadStartedRef.current) return;
    autoDownloadStartedRef.current = true;
    // Small delay to let layout settle (images, fonts)
    const t = setTimeout(() => { handleDownloadPdf(); }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPublic, loading, pages.length, invoiceBarcodeReady, invoiceBarcodePng]);

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

  // ── Warm PDF cache once the report layout is ready (makes Download near-instant). ──
  useEffect(() => {
    if (loading) return;
    if (!paginationReady) return;
    if (!invoiceBarcodeReady) return;
    if (pages.length === 0) return;
    if (queueWaRequested || manualWaRequested) return; // those flows build immediately
    if (eagerPdfStartedRef.current) return;
    eagerPdfStartedRef.current = true;
    const t = window.setTimeout(() => {
      void buildPdfBlob({ queueMode: true }).catch((e) => {
        console.warn("eager PDF build failed", e);
        eagerPdfStartedRef.current = false;
      });
    }, 120);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, paginationReady, invoiceBarcodeReady, pages.length, queueWaRequested, manualWaRequested]);

  // ── Auto-queue report PDF to WhatsApp Console (when queueWa=1) ──
  // Wait for paginationReady so measure-repack does not cancel the scheduled start.
  // Unique popup names are handled in dispatchReportWhatsApp.ts.
  useEffect(() => {
    if (!queueWaRequested) return;
    if (loading) return;
    if (!paginationReady) return;
    if (!invoiceBarcodeReady) return;
    if (autoQueueWaStartedRef.current) return;

    if (pages.length === 0) {
      autoQueueWaStartedRef.current = true;
      const msg = "No report pages to export — snipped images may have failed to load";
      toast.error(msg);
      notifyQueueWa(false, msg);
      return;
    }

    autoQueueWaStartedRef.current = true;
    let launched = false;
    let finished = false;
    let cancelled = false;
    const pageCount = Math.max(1, pages.length);
    // Large reports (100+ tests / many trends) need far more than 90s on average PCs.
    const buildTimeoutMs = Math.min(360_000, Math.max(120_000, pageCount * 12_000));
    const failSafeMs = buildTimeoutMs + 90_000;

    const failSafe = window.setTimeout(() => {
      if (finished || !launched) return;
      const msg = "Timed out generating report PDF for WhatsApp";
      toast.error(msg);
      notifyQueueWa(false, msg);
      setDownloading(false);
    }, failSafeMs);

    const t = window.setTimeout(async () => {
      if (cancelled) return;
      launched = true;
      setDownloading(true);
      toast.message(`Building report PDF… (${pageCount} page${pageCount === 1 ? "" : "s"})`);
      try {
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

        // Share link + PDF in parallel (link is independent of rasterization).
        const sharePromise = (async () => {
          if (!registrationId) return "";
          try {
            const created = await createShareLink(registrationId, invoiceNum, "dispatch");
            return `\nView online: ${created.url}`;
          } catch (e) {
            console.warn("share link for report caption failed", e);
            return "";
          }
        })();

        const built = cachedPdfRef.current || await withTimeout(
          buildPdfBlob({ queueMode: true }),
          buildTimeoutMs,
          "report PDF build",
        );
        if (!built) throw new Error("No pages to export");
        const portalLine = await sharePromise;
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
        }, 400);
      } catch (err: any) {
        const msg = err?.message || "Failed to queue report WhatsApp";
        toast.error(msg);
        notifyQueueWa(false, msg);
      } finally {
        finished = true;
        window.clearTimeout(failSafe);
        setDownloading(false);
      }
    }, 100);

    return () => {
      cancelled = true;
      window.clearTimeout(t);
      // Keep failSafe while in-flight work continues; only drop it if we never launched.
      if (!launched) {
        window.clearTimeout(failSafe);
        autoQueueWaStartedRef.current = false;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queueWaRequested, loading, paginationReady, invoiceBarcodeReady, pages.length]);

  // Fail closed if report data never finishes loading in the Dispatch popup.
  useEffect(() => {
    if (!queueWaRequested) return;
    if (!loading) return;
    if (autoQueueWaStartedRef.current) return;
    const t = window.setTimeout(() => {
      if (autoQueueWaStartedRef.current) return;
      autoQueueWaStartedRef.current = true;
      const msg = "Timed out loading report for WhatsApp";
      toast.error(msg);
      notifyQueueWa(false, msg);
    }, 90_000);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queueWaRequested, loading]);

  // ── Failed Console send: download PDF only (staff send manually) ──
  useEffect(() => {
    if (!manualWaRequested) return;
    if (loading) return;
    if (!paginationReady) return;
    if (!invoiceBarcodeReady) return;
    if (autoManualWaStartedRef.current) return;
    if (pages.length === 0) return;

    autoManualWaStartedRef.current = true;
    let launched = false;
    let cancelled = false;
    const t = window.setTimeout(async () => {
      if (cancelled) return;
      launched = true;
      setDownloading(true);
      try {
        const built = cachedPdfRef.current || await withTimeout(
          buildPdfBlob({ queueMode: true }),
          90_000,
          "report PDF download",
        );
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
    }, 100);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
      if (!launched) autoManualWaStartedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manualWaRequested, loading, paginationReady, invoiceBarcodeReady, pages.length]);

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

  // Native CSS Print ? no html-to-image raster (fast dialog, low RAM on older PCs)
  const handlePrint = async () => {
    if (!printRef.current) return;
    setDownloading(true);
    const root = printRef.current;
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      root.classList.remove("print-strip-colors", "print-no-letterhead", "print-native");
      document.body.classList.remove("lims-report-printing");
      flushSync(() => setHideChartFills(false));
      window.removeEventListener("afterprint", onAfterPrint);
      setDownloading(false);
    };
    const onAfterPrint = () => cleanup();

    try {
      // Brief wait only ? do not block up to 10s like the old raster path.
      const waitStart = Date.now();
      while (!paginationReadyRef.current && Date.now() - waitStart < 1_500) {
        await new Promise((r) => setTimeout(r, 40));
      }
      if (root.querySelectorAll("[data-page]").length === 0) {
        toast.error("No pages to print");
        setDownloading(false);
        return;
      }

      // Strip shaded fills + letterhead for physical letterhead paper (same as previous print).
      flushSync(() => setHideChartFills(true));
      root.classList.add("print-strip-colors", "print-no-letterhead", "print-native");
      document.body.classList.add("lims-report-printing");
      await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));

      window.addEventListener("afterprint", onAfterPrint);
      // Fallback if afterprint never fires (some embedded browsers)
      window.setTimeout(() => cleanup(), 90_000);

      window.print();

      // Stamp print_date without blocking the dialog (non-provisional only)
      if (!isProvisional && !isPublic && registrationId) {
        void supabase
          .from("approved_reports")
          .update({ print_date: new Date().toISOString() })
          .eq("registration_id", registrationId);
      }
    } catch (err: any) {
      cleanup();
      toast.error("Print failed: " + (err.message || "Unknown error"));
    }
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
    <div className="p-2 sm:p-4 space-y-3 sm:space-y-4 print:p-0 print:space-y-0">
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
              data-page-type={page.type}
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
            {letterheadImageUrl && showLetterhead && !page.snipFullBleed && (
              <img
                data-report-letterhead
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
            <div data-report-page-inner className="relative" style={{ zIndex: 1, paddingTop: page.snipFullBleed ? 0 : `${topMm}mm`, paddingBottom: page.snipFullBleed ? `${SIGNATURE_HEIGHT_MM + PAGE_NUM_HEIGHT_MM}mm` : `${bottomMm}mm`, paddingLeft: page.snipFullBleed ? 0 : "8mm", paddingRight: page.snipFullBleed ? 0 : "8mm", height: "100%", boxSizing: "border-box", display: "flex", flexDirection: "column" }}>
              {/* Patient Demographics — skip for composed lab PDF (already in image) */}
              {!page.snipFullBleed && (
              <div data-report-header>
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
              </div>
              )}

              {/* Main Content Area — packs down to top of signature band */}
              <div data-report-content className={page.type === "histogram" || page.type === "snip" || page.type === "trends" ? "flex-1 min-h-0 overflow-hidden" : "flex-1 overflow-visible"}>{/* overflow-visible: surfaces any pagination-estimate regression instead of silently clipping rows (e.g. RFT being truncated). Histogram/snip pages must not paint over the signature. */}
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

                {page.type === "histogram" && hasRenderableHistograms(page.histograms || analyzerHistograms) && (
                  <CbcHistogramCharts
                    histograms={page.histograms || analyzerHistograms}
                    hideFill={hideChartFills}
                  />
                )}

                {page.type === "trends" && page.trends && page.trends.length > 0 && (
                  <AutoScaleContent fillParent>
                    <ReportTrendCharts
                      trends={page.trends}
                      forPdf
                      hideRefFill={hideChartFills}
                    />
                  </AutoScaleContent>
                )}

                {page.type === "snip" && page.snipImage && (() => {
                  // Reserve: top logo margin, demographics, dept+test headers, signature, page #, footer note.
                  // PNG fills only the leftover band (object-fit: contain).
                  if (page.snipFullBleed) {
                    return (
                      <div className="flex items-start justify-center h-full overflow-hidden">
                        <img
                          data-snip-image="true"
                          src={page.snipImage}
                          alt="Outsourced Report"
                          className="w-full h-full object-contain object-top"
                          style={{
                            maxHeight: `${PAGE_HEIGHT_MM - SIGNATURE_HEIGHT_MM - PAGE_NUM_HEIGHT_MM - (layoutSettings.bottom_margin_cm || 1.5) * 10}mm`,
                            width: "100%",
                            objectFit: "contain",
                            objectPosition: "top center",
                          }}
                        />
                      </div>
                    );
                  }
                  const showDept = !!page.departmentName;
                  const showTest = !!page.snipTestName;
                  return (
                    <div className="w-full h-full flex flex-col min-h-0 overflow-hidden">
                      {(showDept || showTest) && (
                        <div className="shrink-0 mb-1.5 space-y-1">
                          {showDept && (
                            <div
                              data-report-dept-header
                              data-pdf-section="department"
                              className="px-3 py-1.5 rounded-t font-bold text-center bg-[#2E3192] text-white print:bg-transparent print:text-gray-900 print:border-2 print:border-gray-800"
                              style={{ fontSize: "15px" }}
                            >
                              {page.departmentName}
                            </div>
                          )}
                          {showTest && (
                            <div
                              className="px-3 py-1 font-semibold bg-blue-50 print:bg-transparent border border-gray-100"
                              style={{ color: "#2E3192", fontSize: "14px" }}
                            >
                              {page.snipTestName}
                            </div>
                          )}
                        </div>
                      )}
                      <div className="w-full flex-1 min-h-0 overflow-hidden flex items-start justify-center">
                        <img
                          data-snip-image="true"
                          src={page.snipImage}
                          alt="Outsourced Report"
                          style={{
                            width: "100%",
                            height: "100%",
                            maxHeight: "100%",
                            objectFit: "contain",
                            objectPosition: "top center",
                          }}
                        />
                      </div>
                    </div>
                  );
                })()}
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

              {/* Footer: invoice barcode (left) + doctor signatures (right). Top edge = content floor.
                  Historical-trends pages: barcode + page # only — never doctor signature. */}
              <div data-report-signature className={pickupFooterNote ? "" : "mt-auto"}>
                <div className="pt-1 border-t flex justify-between items-end gap-3 print:break-inside-avoid">
                  <ReportInvoiceBarcode
                    invoiceNumber={invoiceNumberForBarcode}
                    barcodePng={invoiceBarcodePng}
                  />
                  {!isProvisional && page.type !== "trends" && (() => {
                  // Prefer page-specific approvers (doctor_code or legacy name). Never default snip pages
                  // to "first pathologist in map".
                  const pageApprovers = page.approvers && page.approvers.length > 0
                    ? page.approvers
                    : (page.type === "snip"
                        ? []
                        : (() => {
                            const uniq = new Map<string, SignatureInfo>();
                            Object.values(signatureMap).forEach((s) => {
                              const k = (s.doctor_code || s.pathologist_name || "").toLowerCase();
                              if (k && !uniq.has(k)) uniq.set(k, s);
                            });
                            const first = [...uniq.values()][0];
                            return first ? [first.doctor_code || first.pathologist_name] : [];
                          })());

                  // Snapshot meta keyed by doctor_code and name; live lookup preferred for image/name.
                  const snapshotSigMap: Record<string, SignatureInfo> = {};
                  if (page.testBlocks) {
                    page.testBlocks.forEach(block => {
                      block.params.forEach(p => {
                        const code = String(p.approved_by_doctor_code || "").trim();
                        const name = String(p.approved_by || "").trim();
                        const live = (code && signatureMap[code.toLowerCase()])
                          || (name && signatureMap[name.toLowerCase()])
                          || null;
                        const info: SignatureInfo = {
                          doctor_code: code || live?.doctor_code || null,
                          pathologist_name: live?.pathologist_name || name || "Doctor",
                          qualification: live?.qualification || p.approved_by_qualification || null,
                          designation: live?.designation || p.approved_by_designation || null,
                          signatureUrl: live?.signatureUrl || p.approved_by_signature_url || null,
                        };
                        if (code) snapshotSigMap[code.toLowerCase()] = info;
                        if (name) snapshotSigMap[name.toLowerCase()] = info;
                      });
                    });
                  }

                  const resolvedSigs = pageApprovers
                    .map(keyRaw => {
                      const key = String(keyRaw || "").trim().toLowerCase();
                      if (!key) return null;
                      const snap = snapshotSigMap[key];
                      const live = signatureMap[key];
                      if (live) {
                        return {
                          doctor_code: live.doctor_code || snap?.doctor_code || null,
                          pathologist_name: live.pathologist_name,
                          qualification: live.qualification || snap?.qualification || null,
                          designation: live.designation || snap?.designation || null,
                          signatureUrl: live.signatureUrl || snap?.signatureUrl || null,
                        } as SignatureInfo;
                      }
                      return snap || {
                        doctor_code: null,
                        pathologist_name: keyRaw,
                        qualification: null,
                        designation: null,
                        signatureUrl: null,
                      } as SignatureInfo;
                    })
                    .filter(Boolean) as SignatureInfo[];
                  // Deduplicate by doctor_code when present, else pathologist_name
                  const uniqueSigs = resolvedSigs.filter((s, i, arr) => {
                    const id = (s.doctor_code || s.pathologist_name || "").toLowerCase();
                    return arr.findIndex(x => (x.doctor_code || x.pathologist_name || "").toLowerCase() === id) === i;
                  });
                  if (uniqueSigs.length === 0 && page.type !== "snip") {
                    const uniq = new Map<string, SignatureInfo>();
                    Object.values(signatureMap).forEach((s) => {
                      const k = (s.doctor_code || s.pathologist_name || "").toLowerCase();
                      if (k && !uniq.has(k)) uniq.set(k, s);
                    });
                    const fallback = [...uniq.values()][0];
                    if (!fallback) return null;
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
                  if (uniqueSigs.length === 0) return null;
                  return (
                    <div className="flex justify-end items-start gap-6 flex-nowrap ml-auto">
                      {uniqueSigs.map((sig, idx) => (
                        <div key={idx} className="text-center" style={{ minWidth: 0, flexShrink: 0 }}>
                          {sig.signatureUrl && (
                            <img
                              src={sig.signatureUrl}
                              {...(sig.signatureUrl.startsWith("http") ? { crossOrigin: "anonymous" as const } : {})}
                              alt="Signature"
                              className="h-8 mx-auto mb-0"
                            />
                          )}
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

      {/* Native print styles ? avoids multi-page JPEG capture */}
      <style>{`
        #print-container.print-no-letterhead [data-report-letterhead] {
          display: none !important;
        }
        @media print {
          @page { size: A4; margin: 0; }
          .print\:hidden { display: none !important; }

          body.lims-report-printing aside,
          body.lims-report-printing nav,
          body.lims-report-printing header,
          body.lims-report-printing .print\:hidden {
            display: none !important;
          }

          body.lims-report-printing,
          body.lims-report-printing #root,
          body.lims-report-printing main {
            margin: 0 !important;
            padding: 0 !important;
            width: 210mm !important;
            max-width: none !important;
            background: white !important;
            overflow: visible !important;
          }
          body.lims-report-printing main > div {
            padding: 0 !important;
            margin: 0 !important;
            gap: 0 !important;
          }
          body.lims-report-printing .fixed,
          body.lims-report-printing [class*="sticky"] {
            display: none !important;
          }

          body.lims-report-printing #print-container.print-native {
            display: block !important;
            width: 210mm !important;
            margin: 0 !important;
            gap: 0 !important;
            transform: none !important;
          }

          body.lims-report-printing #print-container.print-native > div {
            width: 210mm !important;
            height: 297mm !important;
            margin: 0 !important;
            padding: 0 !important;
            overflow: hidden !important;
            page-break-after: always;
            break-after: page;
          }
          body.lims-report-printing #print-container.print-native > div:last-child {
            page-break-after: auto;
            break-after: auto;
          }

          body.lims-report-printing #print-container.print-native [data-page] {
            box-shadow: none !important;
            transform: none !important;
            width: 210mm !important;
            height: 297mm !important;
            min-height: 297mm !important;
            max-height: 297mm !important;
            overflow: hidden !important;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }

          /* Reinforce H/L bold in native print — black only (lab B&W printers). */
          body.lims-report-printing #print-container [data-abnormal="1"] > td {
            font-weight: 700 !important;
            color: #000 !important;
          }
          body.lims-report-printing #print-container [data-abnormal="1"] .italic,
          body.lims-report-printing #print-container [data-abnormal="1"] .font-normal {
            font-weight: 400 !important;
            color: #000 !important;
          }
          body.lims-report-printing #print-container .flag-badge {
            font-weight: 700 !important;
            border: 1px solid #000 !important;
            color: #000 !important;
            background: transparent !important;
          }
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
      test_id: block.testId,
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
