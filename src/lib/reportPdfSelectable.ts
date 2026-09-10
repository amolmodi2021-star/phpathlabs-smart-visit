/**
 * Hybrid report PDF helpers: visual page capture (matches View Report) +
 * invisible selectable text layer (copy/search) without changing layout.
 */
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export type ReportPdfTextRun = {
  text: string;
  x: number;
  y: number;
  size: number;
};

const A4_WIDTH_PT = 595.28;
const A4_HEIGHT_PT = 841.89;

export function winAnsiSafe(raw: string): string {
  return String(raw || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const m = String(dataUrl || "").match(/^data:([^;]+);base64,(.+)$/);
  if (!m) throw new Error("Invalid image data URL");
  const bin = atob(m[2]);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function collectPageTextRuns(pageEl: HTMLElement): ReportPdfTextRun[] {
  const pageRect = pageEl.getBoundingClientRect();
  const layoutW = Math.max(1, pageEl.offsetWidth || pageRect.width);
  const layoutH = Math.max(1, pageEl.offsetHeight || pageRect.height);
  const scaleX = pageRect.width / layoutW || 1;
  const scaleY = pageRect.height / layoutH || 1;
  const runs: ReportPdfTextRun[] = [];

  const walker = document.createTreeWalker(pageEl, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const raw = node.textContent || "";
      if (!raw.trim()) return NodeFilter.FILTER_REJECT;
      const el = node.parentElement;
      if (!el) return NodeFilter.FILTER_REJECT;
      if (el.closest("script, style, noscript, [data-report-letterhead]")) {
        return NodeFilter.FILTER_REJECT;
      }
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") {
        return NodeFilter.FILTER_REJECT;
      }
      if (Number.parseFloat(style.opacity || "1") === 0) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  let node: Node | null;
  while ((node = walker.nextNode())) {
    const el = node.parentElement;
    if (!el) continue;
    const text = winAnsiSafe((node.textContent || "").replace(/\s+/g, " "));
    if (!text) continue;

    const style = getComputedStyle(el);
    const fontSizePx = Number.parseFloat(style.fontSize) || 10;
    const range = document.createRange();
    try {
      range.selectNodeContents(node);
    } catch {
      continue;
    }
    const rects = Array.from(range.getClientRects());
    if (rects.length === 0) continue;

    const r = rects[0];
    if (r.width < 0.5 || r.height < 0.5) continue;

    const xCss = (r.left - pageRect.left) / scaleX;
    const yCss = (r.top - pageRect.top) / scaleY;
    const size = Math.max(4, Math.min(18, fontSizePx * (A4_HEIGHT_PT / layoutH)));
    const x = xCss * (A4_WIDTH_PT / layoutW);
    const yTop = yCss * (A4_HEIGHT_PT / layoutH);
    const y = A4_HEIGHT_PT - yTop - size * 0.8;

    if (x < -2 || y < -2 || x > A4_WIDTH_PT + 2 || y > A4_HEIGHT_PT + 2) continue;
    runs.push({ text, x: Math.max(0, x), y: Math.max(0, y), size });
  }

  return runs;
}

export async function assembleReportPdfWithSelectableText(
  pages: Array<{ jpegDataUrl: string; textRuns: ReportPdfTextRun[] }>,
): Promise<Blob> {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

  for (const pageData of pages) {
    const page = pdfDoc.addPage([A4_WIDTH_PT, A4_HEIGHT_PT]);
    const bytes = dataUrlToBytes(pageData.jpegDataUrl);
    const image = await pdfDoc.embedJpg(bytes);
    page.drawImage(image, {
      x: 0,
      y: 0,
      width: A4_WIDTH_PT,
      height: A4_HEIGHT_PT,
    });

    for (const run of pageData.textRuns || []) {
      const text = winAnsiSafe(run.text);
      if (!text) continue;
      try {
        page.drawText(text, {
          x: run.x,
          y: run.y,
          size: run.size,
          font,
          color: rgb(0, 0, 0),
          opacity: 0,
          maxWidth: Math.max(8, A4_WIDTH_PT - run.x - 6),
          lineHeight: run.size * 1.15,
        });
      } catch {
        // visual layer remains intact
      }
    }
  }

  const saved = await pdfDoc.save();
  return new Blob([saved], { type: "application/pdf" });
}
