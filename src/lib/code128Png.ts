import bwipjs from "bwip-js/browser";
import JsBarcode from "jsbarcode";

export const REPORT_BARCODE_LAYOUT = {
  xMm: 8,
  widthMm: 48,
  heightMm: 16,
  pageNumMm: 6,
};

/** Footer Y (mm from page top) so the barcode sits left of the signature band. */
export function reportBarcodeYMm(bottomMm: number, pageHeightMm = 297): number {
  return (
    pageHeightMm -
    bottomMm -
    REPORT_BARCODE_LAYOUT.pageNumMm -
    REPORT_BARCODE_LAYOUT.heightMm -
    0.5
  );
}

function canvasToPng(canvas: HTMLCanvasElement): string | null {
  if (!canvas.width || !canvas.height) return null;
  try {
    const url = canvas.toDataURL("image/png");
    if (typeof url !== "string" || !url.startsWith("data:image/png")) return null;
    return url;
  } catch {
    return null;
  }
}

function renderWithBwip(text: string): string | null {
  const canvas = document.createElement("canvas");
  bwipjs.toCanvas(canvas, {
    bcid: "code128",
    text,
    scale: 3,
    height: 10,
    includetext: true,
    textsize: 8,
    textxalign: "center",
    backgroundcolor: "FFFFFF",
    barcolor: "000000",
    paddingleft: 6,
    paddingright: 6,
    paddingtop: 2,
    paddingbottom: 2,
  });
  return canvasToPng(canvas);
}

function renderWithJsBarcode(text: string): string | null {
  const canvas = document.createElement("canvas");
  JsBarcode(canvas, text, {
    format: "CODE128",
    height: 40,
    width: 1.6,
    displayValue: true,
    fontSize: 12,
    margin: 4,
    background: "#ffffff",
    lineColor: "#000000",
  });
  return canvasToPng(canvas);
}

/**
 * Render CODE128 as a PNG data URL (never leave a live canvas in the DOM).
 *
 * Prefer bwip-js (same engine as sample-tube stickers). html-to-image JPEG
 * capture blurs thin bars, so callers should also stamp this PNG onto the
 * PDF/print image after capture.
 */
export function renderCode128Png(
  value: string | null | undefined,
): string | null {
  const text = String(value || "").trim();
  if (!text) return null;
  if (typeof document === "undefined") return null;
  try {
    return renderWithBwip(text) || renderWithJsBarcode(text);
  } catch {
    try {
      return renderWithJsBarcode(text);
    } catch {
      return null;
    }
  }
}

/**
 * html-to-image cannot see canvas pixels. Replace any leftover canvases in
 * a capture root with PNG img copies (same fix as invoice WhatsApp).
 */
export function replaceCanvasesWithPngImages(root: HTMLElement): void {
  root.querySelectorAll("canvas").forEach((canvas) => {
    if (!(canvas instanceof HTMLCanvasElement)) return;
    if (canvas.width <= 0 || canvas.height <= 0) {
      canvas.remove();
      return;
    }
    try {
      const img = document.createElement("img");
      img.src = canvas.toDataURL("image/png");
      img.alt = canvas.getAttribute("alt") || "";
      img.style.cssText =
        canvas.getAttribute("style") ||
        "display:block;max-width:100%;height:40px;background:#ffffff;";
      canvas.replaceWith(img);
    } catch {
      canvas.remove();
    }
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image load failed"));
    img.src = src;
  });
}

/**
 * Draw a sharp PNG barcode onto a captured report page. JPEG html-to-image
 * captures smear CODE128 bars; stamping after capture keeps them scannable
 * in downloaded PDFs and WhatsApp sends.
 */
export async function stampInvoiceBarcodeOnPage(opts: {
  pageDataUrl: string;
  barcodePng: string | null;
  bottomMm: number;
  pageWidthMm?: number;
  pageHeightMm?: number;
  output: "png" | "jpeg";
}): Promise<string> {
  if (!opts.barcodePng) return opts.pageDataUrl;
  const pageWidthMm = opts.pageWidthMm ?? 210;
  const pageHeightMm = opts.pageHeightMm ?? 297;
  try {
    const [page, barcode] = await Promise.all([
      loadImage(opts.pageDataUrl),
      loadImage(opts.barcodePng),
    ]);
    const canvas = document.createElement("canvas");
    canvas.width = page.width;
    canvas.height = page.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return opts.pageDataUrl;
    ctx.drawImage(page, 0, 0);
    const pxPerMm = page.width / pageWidthMm;
    const x = REPORT_BARCODE_LAYOUT.xMm * pxPerMm;
    const y = reportBarcodeYMm(opts.bottomMm, pageHeightMm) * pxPerMm;
    const w = REPORT_BARCODE_LAYOUT.widthMm * pxPerMm;
    const h = REPORT_BARCODE_LAYOUT.heightMm * pxPerMm;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(x - 2 * pxPerMm, y - 1 * pxPerMm, w + 4 * pxPerMm, h + 2 * pxPerMm);
    ctx.drawImage(barcode, x, y, w, h);
    if (opts.output === "png") return canvas.toDataURL("image/png");
    return canvas.toDataURL("image/jpeg", 0.92);
  } catch {
    return opts.pageDataUrl;
  }
}
