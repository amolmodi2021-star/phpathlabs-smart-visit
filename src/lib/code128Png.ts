import bwipjs from "bwip-js/browser";
import JsBarcode from "jsbarcode";

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
    height: 8,
    includetext: false,
    backgroundcolor: "FFFFFF",
    barcolor: "000000",
    paddingleft: 4,
    paddingright: 4,
    paddingtop: 1,
    paddingbottom: 1,
  });
  return canvasToPng(canvas);
}

function renderWithJsBarcode(text: string): string | null {
  const canvas = document.createElement("canvas");
  JsBarcode(canvas, text, {
    format: "CODE128",
    height: 28,
    width: 1.4,
    displayValue: false,
    margin: 2,
    background: "#ffffff",
    lineColor: "#000000",
  });
  return canvasToPng(canvas);
}

/**
 * Render CODE128 as a PNG data URL (never leave a live canvas in the DOM).
 * Bars only — invoice number is drawn as HTML under the image so preview and
 * PDF capture (html-to-image) stay identical. Do not stamp a second barcode
 * onto the captured page.
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
        "display:block;max-width:100%;height:28px;background:#ffffff;";
      canvas.replaceWith(img);
    } catch {
      canvas.remove();
    }
  });
}
