/**
 * High-resolution outsourced lab PDF crop + letterhead compose.
 * Matches provisional/final report chrome: top/bottom margins from layout
 * settings, LimsReportHeader-style demographics, crop auto-fitted in the
 * band above the doctor signature / page-number area.
 */
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import * as pdfjsLib from "pdfjs-dist";
import { format } from "date-fns";
import { getCachedLetterheadPng } from "@/lib/reportAssetCache";
import { supabase } from "@/integrations/supabase/client";
import { formatPatientDisplayName } from "@/lib/patientDisplayName";
import { formatPatientAge } from "@/lib/patientAge";

pdfjsLib.GlobalWorkerOptions.workerSrc =
  `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.2.67/pdf.worker.min.mjs`;

/** Normalized crop box (0–1 relative to page width/height). */
export type PdfCropRegion = {
  pageIndex: number;
  x: number;
  y: number;
  w: number;
  h: number;
};

export type ComposePatientMeta = {
  patientName?: string | null;
  title?: string | null;
  gender?: string | null;
  dob?: string | null;
  ageText?: string | null;
  umrNumber?: string | null;
  doctorName?: string | null;
  mobileNumber?: string | null;
  invoiceNumber?: string | null;
  registrationDate?: string | null;
  sampleCollectionDate?: string | null;
  approvalDate?: string | null;
  printDate?: string | null;
  visitType?: string | null;
  testName?: string | null;
};

const A4_W = 595.28;
const A4_H = 841.89;
const MM_TO_PT = 72 / 25.4;
/** Same constants as LimsReportView (mm). */
const HEADER_HEIGHT_MM = 28;
const SIGNATURE_HEIGHT_MM = 16;
const PAGE_NUM_HEIGHT_MM = 6;
const SIDE_PAD_MM = 8;
const DEFAULT_TOP_MARGIN_CM = 2.5;
const DEFAULT_BOTTOM_MARGIN_CM = 1.5;
const RENDER_SCALE = 2.5;
const DEMO_FONT = 9;
const DEMO_LABEL_GAP = 2;
const DEMO_LINE_GAP = 3;

export function parsePdfCropRegions(raw: unknown): PdfCropRegion[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((r: any) => ({
      pageIndex: Number(r.pageIndex) || 0,
      x: clamp01(Number(r.x)),
      y: clamp01(Number(r.y)),
      w: clamp01(Number(r.w)),
      h: clamp01(Number(r.h)),
    }))
    .filter((r) => r.w > 0.01 && r.h > 0.01);
}

function clamp01(n: number) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function mm(n: number) {
  return n * MM_TO_PT;
}

function formatReportDate(d: string | null | undefined) {
  if (!d) return "—";
  try {
    return format(new Date(d), "dd-MMM-yyyy hh:mm a");
  } catch {
    return d;
  }
}

function formatVisitType(visitType: string | null | undefined): string {
  switch (visitType) {
    case "home_visit":
      return "Home Visit";
    case "lab_visit":
      return "Lab Visit";
    case "pickup_point":
      return "Pickup Point";
    default:
      return visitType ? String(visitType).replace(/_/g, " ") : "—";
  }
}

async function fetchPdfBytes(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load PDF (${res.status})`);
  return await res.arrayBuffer();
}

type LayoutMargins = { topMm: number; bottomMm: number };

async function loadLetterheadAndMargins(): Promise<{
  dataUrl: string | null;
  margins: LayoutMargins;
}> {
  const margins: LayoutMargins = {
    topMm: DEFAULT_TOP_MARGIN_CM * 10,
    bottomMm: DEFAULT_BOTTOM_MARGIN_CM * 10,
  };
  const { data: settings } = await supabase
    .from("report_layout_settings")
    .select("letterhead_pdf_path, top_margin_cm, bottom_margin_cm")
    .limit(1)
    .maybeSingle();
  if (settings?.top_margin_cm != null && Number.isFinite(Number(settings.top_margin_cm))) {
    margins.topMm = Number(settings.top_margin_cm) * 10;
  }
  if (settings?.bottom_margin_cm != null && Number.isFinite(Number(settings.bottom_margin_cm))) {
    margins.bottomMm = Number(settings.bottom_margin_cm) * 10;
  }
  if (!settings?.letterhead_pdf_path) return { dataUrl: null, margins };
  const { data: urlData } = supabase.storage
    .from("letterheads")
    .getPublicUrl(settings.letterhead_pdf_path);
  try {
    const dataUrl = await getCachedLetterheadPng(
      settings.letterhead_pdf_path,
      urlData.publicUrl,
      async (pdfUrl) => {
        const pdf = await pdfjsLib.getDocument(pdfUrl).promise;
        const page = await pdf.getPage(1);
        const viewport = page.getViewport({ scale: 2 });
        const canvas = document.createElement("canvas");
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext("2d")!;
        await page.render({ canvasContext: ctx, viewport }).promise;
        return canvas.toDataURL("image/png");
      },
    );
    return { dataUrl, margins };
  } catch {
    return { dataUrl: null, margins };
  }
}

async function dataUrlToUint8(dataUrl: string): Promise<Uint8Array> {
  const res = await fetch(dataUrl);
  return new Uint8Array(await res.arrayBuffer());
}

/** Render one crop region from source PDF to a PNG data URL at high DPI. */
export async function renderCropToPng(
  sourcePdfUrl: string,
  region: PdfCropRegion,
  scale = RENDER_SCALE,
): Promise<string> {
  const bytes = await fetchPdfBytes(sourcePdfUrl);
  const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
  const page = await pdf.getPage(region.pageIndex + 1);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  const ctx = canvas.getContext("2d")!;
  await page.render({ canvasContext: ctx, viewport }).promise;

  const sx = Math.floor(region.x * canvas.width);
  const sy = Math.floor(region.y * canvas.height);
  const sw = Math.max(1, Math.floor(region.w * canvas.width));
  const sh = Math.max(1, Math.floor(region.h * canvas.height));
  const out = document.createElement("canvas");
  out.width = sw;
  out.height = sh;
  const octx = out.getContext("2d")!;
  octx.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
  return out.toDataURL("image/png");
}

function drawLabeled(
  page: any,
  font: any,
  fontBold: any,
  x: number,
  y: number,
  label: string,
  value: string,
  maxW: number,
) {
  const labelText = `${label} `;
  const labelW = fontBold.widthOfTextAtSize(labelText, DEMO_FONT);
  page.drawText(labelText, {
    x,
    y,
    size: DEMO_FONT,
    font: fontBold,
    color: rgb(0.1, 0.1, 0.1),
  });
  const valueMax = Math.max(20, maxW - labelW);
  let text = value || "—";
  while (text.length > 1 && font.widthOfTextAtSize(text, DEMO_FONT) > valueMax) {
    text = text.slice(0, -1);
  }
  page.drawText(text, {
    x: x + labelW,
    y,
    size: DEMO_FONT,
    font,
    color: rgb(0.1, 0.1, 0.1),
  });
}

/**
 * Draw demographics matching LimsReportHeader (provisional / final reports).
 * Returns the PDF y of the bottom of the demographics band (content must stay below this in screen terms = lower y).
 */
function drawReportDemographics(
  page: any,
  font: any,
  fontBold: any,
  meta: ComposePatientMeta,
  topMarginMm: number,
): number {
  const side = mm(SIDE_PAD_MM);
  const usableW = A4_W - side * 2;
  const colW = usableW / 3;
  const lineH = DEMO_FONT + DEMO_LINE_GAP;

  // PDF y decreases downward; start just below top margin (same as report paddingTop).
  let y = A4_H - mm(topMarginMm) - DEMO_FONT;

  const name = formatPatientDisplayName(meta.title, meta.patientName, meta.gender) || "—";
  drawLabeled(page, font, fontBold, side, y, "Patient Name:", name, usableW);
  y -= lineH + DEMO_LABEL_GAP;

  const age = formatPatientAge({
    dob: meta.dob,
    ageText: meta.ageText,
    asOf: meta.approvalDate || meta.registrationDate || null,
  });

  const row1 = [
    { label: "Visit Type:", value: formatVisitType(meta.visitType) },
    { label: "Age / Gender:", value: `${age || "—"} / ${meta.gender || "—"}` },
    { label: "UMR No:", value: meta.umrNumber || "—" },
  ];
  const row2 = [
    { label: "Ref. Doctor:", value: meta.doctorName || "SELF" },
    { label: "Invoice No:", value: meta.invoiceNumber || "—" },
    { label: "Mobile:", value: meta.mobileNumber || "—" },
  ];
  const row3 = [
    { label: "Reg. Date:", value: formatReportDate(meta.registrationDate) },
    { label: "Collection:", value: formatReportDate(meta.sampleCollectionDate) },
    { label: "Report Date:", value: formatReportDate(meta.approvalDate) },
  ];

  for (const row of [row1, row2, row3]) {
    row.forEach((cell, i) => {
      drawLabeled(page, font, fontBold, side + i * colW, y, cell.label, cell.value, colW - 4);
    });
    y -= lineH;
  }

  if (meta.testName) {
    y -= 1;
    drawLabeled(page, font, fontBold, side, y, "Test:", meta.testName, usableW);
    y -= lineH;
  }

  // Hairline under demographics (matches border-b on LimsReportHeader)
  const ruleY = y - 2;
  page.drawLine({
    start: { x: side, y: ruleY },
    end: { x: A4_W - side, y: ruleY },
    thickness: 0.6,
    color: rgb(0.75, 0.75, 0.75),
  });

  return ruleY - 6;
}

/**
 * Build a multi-page A4 PDF: letterhead + report demographics + auto-fitted crop.
 * Crop is scaled to fit between demographics and the signature/page-number band.
 */
export async function composeOutsourcedLetterheadPdf(
  sourcePdfUrl: string,
  regions: PdfCropRegion[],
  meta: ComposePatientMeta,
): Promise<Blob> {
  const sorted = [...regions].sort((a, b) => a.pageIndex - b.pageIndex || a.y - b.y);
  if (sorted.length === 0) throw new Error("Select at least one region on the uploaded PDF");

  const outDoc = await PDFDocument.create();
  const font = await outDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await outDoc.embedFont(StandardFonts.HelveticaBold);
  const { dataUrl: letterheadDataUrl, margins } = await loadLetterheadAndMargins();
  let letterheadImg: Awaited<ReturnType<typeof outDoc.embedPng>> | null = null;
  if (letterheadDataUrl) {
    try {
      letterheadImg = await outDoc.embedPng(await dataUrlToUint8(letterheadDataUrl));
    } catch {
      letterheadImg = null;
    }
  }

  const side = mm(SIDE_PAD_MM);
  const maxW = A4_W - side * 2;
  // Reserve same bottom chrome as LimsReportView (signature + page number + bottom margin).
  const contentBottom =
    mm(margins.bottomMm) + mm(SIGNATURE_HEIGHT_MM) + mm(PAGE_NUM_HEIGHT_MM) + 4;

  for (const region of sorted) {
    const pngDataUrl = await renderCropToPng(sourcePdfUrl, region);
    const pngBytes = await dataUrlToUint8(pngDataUrl);
    const embedded = await outDoc.embedPng(pngBytes);
    const page = outDoc.addPage([A4_W, A4_H]);

    if (letterheadImg) {
      page.drawImage(letterheadImg, { x: 0, y: 0, width: A4_W, height: A4_H });
    }

    // Soft white band so demographics stay readable over letterhead artwork
    const demoTop = A4_H - mm(margins.topMm);
    const demoBandH = mm(HEADER_HEIGHT_MM) + 8;
    page.drawRectangle({
      x: side - 2,
      y: demoTop - demoBandH,
      width: maxW + 4,
      height: demoBandH,
      color: rgb(1, 1, 1),
      opacity: 0.92,
    });

    const demoBottomY = drawReportDemographics(page, font, fontBold, meta, margins.topMm);
    const contentTop = Math.min(demoBottomY, A4_H - mm(margins.topMm) - mm(HEADER_HEIGHT_MM));
    const maxH = Math.max(40, contentTop - contentBottom);

    const iw = embedded.width;
    const ih = embedded.height;
    // Fit inside band (scale down or up to use available space without overflow).
    const scale = Math.min(maxW / iw, maxH / ih);
    const drawW = iw * scale;
    const drawH = ih * scale;
    const x = side + (maxW - drawW) / 2;
    // Align to top of content band (not vertically centered) so signature zone stays clear.
    const y = contentTop - drawH;
    page.drawImage(embedded, { x, y, width: drawW, height: drawH });
  }

  const bytes = await outDoc.save();
  return new Blob([bytes.buffer as ArrayBuffer], { type: "application/pdf" });
}

/** Render each page of a composed PDF to high-res PNG data URLs for report embedding. */
export async function composedPdfPagesToPngs(
  composedPdfUrl: string,
  scale = 2,
): Promise<string[]> {
  const bytes = await fetchPdfBytes(composedPdfUrl);
  const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
  const urls: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext("2d")!;
    await page.render({ canvasContext: ctx, viewport }).promise;
    urls.push(canvas.toDataURL("image/png"));
  }
  return urls;
}