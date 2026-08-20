/**
 * High-resolution outsourced lab PDF crop + letterhead compose.
 * Uses pdf.js to extract selected page regions at high DPI (works for scanned
 * and digital PDFs), then pdf-lib to place them on A4 letterhead pages with
 * auto-fit between demographic header and signature band.
 */
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import * as pdfjsLib from "pdfjs-dist";
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
  visitType?: string | null;
  testName?: string | null;
};

const A4_W = 595.28;
const A4_H = 841.89;
/** Content band below demographics / above signature (points). */
const HEADER_BAND_PT = 72;
const SIGNATURE_BAND_PT = 56;
const SIDE_PAD_PT = 28;
const RENDER_SCALE = 2.5;

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

async function fetchPdfBytes(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load PDF (${res.status})`);
  return await res.arrayBuffer();
}

async function loadLetterheadPngDataUrl(): Promise<string | null> {
  const { data: settings } = await supabase
    .from("report_layout_settings")
    .select("letterhead_pdf_path, top_margin_cm, bottom_margin_cm")
    .limit(1)
    .maybeSingle();
  if (!settings?.letterhead_pdf_path) return null;
  const { data: urlData } = supabase.storage
    .from("letterheads")
    .getPublicUrl(settings.letterhead_pdf_path);
  try {
    return await getCachedLetterheadPng(
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
  } catch {
    return null;
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

function drawDemoText(
  page: any,
  font: any,
  fontBold: any,
  meta: ComposePatientMeta,
  topY: number,
) {
  const name = formatPatientDisplayName(meta.title, meta.patientName, meta.gender) || "—";
  const age = formatPatientAge({
    dob: meta.dob,
    ageText: meta.ageText,
    asOf: meta.registrationDate || null,
  });
  const lines = [
    { text: name, bold: true, size: 11 },
    { text: `${age || "—"}  |  UMR: ${meta.umrNumber || "—"}  |  Inv: ${meta.invoiceNumber || "—"}`, bold: false, size: 9 },
    { text: `Dr: ${meta.doctorName || "—"}  |  Mob: ${meta.mobileNumber || "—"}`, bold: false, size: 9 },
    { text: meta.testName ? `Test: ${meta.testName}` : "", bold: false, size: 9 },
  ].filter((l) => l.text);
  let y = topY;
  for (const line of lines) {
    page.drawText(line.text.slice(0, 110), {
      x: SIDE_PAD_PT,
      y,
      size: line.size,
      font: line.bold ? fontBold : font,
      color: rgb(0.1, 0.1, 0.1),
    });
    y -= line.size + 4;
  }
}

/**
 * Build a multi-page A4 PDF: letterhead + demographics + auto-fitted crop per region.
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
  const letterheadDataUrl = await loadLetterheadPngDataUrl();
  let letterheadImg: Awaited<ReturnType<typeof outDoc.embedPng>> | null = null;
  if (letterheadDataUrl) {
    try {
      letterheadImg = await outDoc.embedPng(await dataUrlToUint8(letterheadDataUrl));
    } catch {
      letterheadImg = null;
    }
  }

  const contentTop = A4_H - HEADER_BAND_PT - 8;
  const contentBottom = SIGNATURE_BAND_PT + 8;
  const maxW = A4_W - SIDE_PAD_PT * 2;
  const maxH = contentTop - contentBottom;

  for (const region of sorted) {
    const pngDataUrl = await renderCropToPng(sourcePdfUrl, region);
    const pngBytes = await dataUrlToUint8(pngDataUrl);
    const embedded = await outDoc.embedPng(pngBytes);
    const page = outDoc.addPage([A4_W, A4_H]);

    if (letterheadImg) {
      page.drawImage(letterheadImg, { x: 0, y: 0, width: A4_W, height: A4_H });
    }

    drawDemoText(page, font, fontBold, meta, A4_H - 36);

    const iw = embedded.width;
    const ih = embedded.height;
    const scale = Math.min(maxW / iw, maxH / ih, 1);
    const drawW = iw * scale;
    const drawH = ih * scale;
    const x = SIDE_PAD_PT + (maxW - drawW) / 2;
    const y = contentBottom + (maxH - drawH) / 2;
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
