import JsBarcode from "jsbarcode";

/**
 * Render CODE128 as a PNG data URL (never leave a live canvas in the DOM).
 *
 * html-to-image captures via SVG foreignObject, which cannot clone canvas pixels.
 * Invoice WhatsApp had to swap the barcode canvas for an img before capture;
 * reports always use an img with a PNG data URL so print, download, and
 * WhatsApp PDF all rasterize the barcode.
 *
 * Visual settings match the invoice barcode (CODE128, compact bars, no human text).
 */
export function renderCode128Png(
  value: string | null | undefined,
  opts?: { height?: number; width?: number },
): string | null {
  const text = String(value || "").trim();
  if (!text) return null;
  if (typeof document === "undefined") return null;
  try {
    const canvas = document.createElement("canvas");
    JsBarcode(canvas, text, {
      format: "CODE128",
      height: opts?.height ?? 28,
      width: opts?.width ?? 1.2,
      displayValue: false,
      margin: 0,
      background: "#ffffff",
      lineColor: "#000000",
    });
    if (!canvas.width || !canvas.height) return null;
    const url = canvas.toDataURL("image/png");
    if (typeof url !== "string" || !url.startsWith("data:image/png")) return null;
    return url;
  } catch {
    return null;
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
        "display:block;max-width:100%;height:28px;";
      canvas.replaceWith(img);
    } catch {
      canvas.remove();
    }
  });
}
