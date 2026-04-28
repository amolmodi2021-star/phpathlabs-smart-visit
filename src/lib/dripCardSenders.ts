/**
 * Abnormal History card generator used by the manual `AbnormalBulkSender`
 * (Loyalty Cards → Abnormal Cards tab).
 *
 * Renders an offscreen canvas using the `abnormal_card_templates` row config
 * (logo, header band, patient details, abnormal-test table, footer) and
 * uploads the result to Cloudinary. Returns the public secure_url, or null
 * on failure (the bulk sender surfaces this as "Card generation failed").
 *
 * Cost note: uses Cloudinary's free tier (25 GB/mo) instead of Lovable Cloud
 * Storage so WhatsApp's media-fetch egress doesn't bill us.
 */
import { exportCanvasAsCompressedJpeg } from "@/lib/cardRenderer";
import { uploadJpegToCloudinaryWithRetry } from "@/lib/cardStorageCloudinary";

interface AbnormalTest {
  test_name: string;
  test_date: string;
  result_value: string;
  normal_range: string;
}

interface AbnormalCardTemplate {
  logo_url?: string | null;
  logo_width?: number | null;
  logo_height?: number | null;
  logo_x?: number | null;
  logo_y?: number | null;
  background_color?: string | null;
  header_bg_color?: string | null;
  header_font_color?: string | null;
  canvas_width?: number | null;
  placeholders?: Array<{
    field: string;
    x: number; // percent of canvas width
    y: number; // pixel offset within header band
    fontSize?: number;
    fontColor?: string;
    bold?: boolean;
  }>;
  table_config?: {
    headerBg?: string;
    headerFontColor?: string;
    headerFontSize?: number;
    headerFont?: string;
    rowFontSize?: number;
    rowFontColor?: string;
    rowHeight?: number;
    altRowColor?: string;
    borderColor?: string;
    resultColor?: string;
    colWidths?: number[];
    colAligns?: Array<"left" | "center" | "right">;
  } | null;
  footer_lines?: Array<{
    text: string;
    align?: "left" | "center" | "right";
    bold?: boolean;
    fontSize?: number;
    fontColor?: string;
  }>;
  bands?: Array<{
    label?: string;
    text?: string;
    height?: number;
    color?: string;
    textColor?: string;
    fontSize?: number;
    bold?: boolean;
    align?: "left" | "center" | "right";
    position?: "above-table" | "below-table";
  }>;
  header_band_height?: number | null;
  show_header_band?: boolean | null;
  details_band_height?: number | null;
}

const CODE128_PATTERNS = [
  "212222","222122","222221","121223","121322","131222","122213","122312","132212","221213","221312","231212",
  "112232","122132","122231","113222","123122","123221","223211","221132","221231","213212","223112","312131",
  "311222","321122","321221","312212","322112","322211","212123","212321","232121","111323","131123","131321",
  "112313","132113","132311","211313","231113","231311","112133","112331","132131","113123","113321","133121",
  "313121","211331","231131","213113","213311","213131","311123","311321","331121","312113","312311","332111",
  "314111","221411","431111","111224","111422","121124","121421","141122","141221","112214","112412","122114",
  "122411","142112","142211","241211","221114","413111","241112","134111","111242","121142","121241","114212",
  "124112","124211","411212","421112","421211","212141","214121","412121","111143","111341","131141","114113",
  "114311","411113","411311","113141","114131","311141","411131","211412","211214","211232","2331112",
];

function normalizeIndianMobile(value: string) {
  const digits = (value || "").replace(/\D/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
}

function encodeCode128C(digits: string) {
  if (!/^\d+$/.test(digits) || digits.length % 2 !== 0) return null;
  const codes = [105];
  for (let i = 0; i < digits.length; i += 2) codes.push(Number(digits.slice(i, i + 2)));
  let checksum = 105;
  for (let i = 1; i < codes.length; i++) checksum += codes[i] * i;
  codes.push(checksum % 103);
  codes.push(106);
  return codes;
}

function drawBarcode(ctx: CanvasRenderingContext2D, value: string, x: number, y: number, height: number, color: string) {
  const digits = normalizeIndianMobile(value);
  if (!digits) return;
  const evenDigits = digits.length % 2 === 0 ? digits : `0${digits}`;
  const codes = encodeCode128C(evenDigits);
  if (!codes) return;
  const patterns = codes.map((code) => CODE128_PATTERNS[code]).filter(Boolean);
  const totalModules = patterns.reduce((sum, p) => sum + p.split("").reduce((acc, w) => acc + Number(w), 0), 0);
  const targetWidth = Math.max(evenDigits.length * height * 0.38, height * 2.8);
  const moduleWidth = targetWidth / totalModules;
  ctx.save();
  ctx.fillStyle = color;
  let cursorX = x;
  for (const pattern of patterns) {
    pattern.split("").forEach((seg, idx) => {
      const width = Number(seg) * moduleWidth;
      if (idx % 2 === 0) ctx.fillRect(cursorX, y, width, height);
      cursorX += width;
    });
  }
  ctx.restore();
}

async function loadImage(url: string): Promise<HTMLImageElement> {
  const response = await fetch(url);
  if (!response.ok) throw new Error("Failed to fetch image");
  const blob = await response.blob();
  const dataUrl = await new Promise<string>((resolve) => {
    const r = new FileReader();
    r.onloadend = () => resolve(r.result as string);
    r.readAsDataURL(blob);
  });
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = dataUrl;
  });
}

function formatDateDDMMYYYY(value: string): string {
  if (!value) return "";
  // Already in dd-MM-yyyy?
  if (/^\d{2}-\d{2}-\d{4}$/.test(value)) return value;
  const d = new Date(value);
  if (isNaN(d.getTime())) return value;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()}`;
}

export async function generateAbnormalCardForDrip(
  patient: { patient_name: string; mobile_number: string; umr_number: string },
  tests: AbnormalTest[],
  cardTemplate: unknown,
  _footerText: string,
): Promise<string | null> {
  try {
    if (!cardTemplate) throw new Error("missing template");

    const tpl = cardTemplate as AbnormalCardTemplate;
    const canvasWidth = tpl.canvas_width || 900;
    const headerBandHeight = tpl.show_header_band !== false ? (tpl.header_band_height || 130) : 0;

    // Patient details band: tallest placeholder y + fontSize gives band height
    const placeholders = tpl.placeholders || [];
    const detailsBandHeight = placeholders.reduce((max, p) => {
      const fs = p.fontSize || 25;
      const bottom = (p.y || 0) + fs + 10;
      return Math.max(max, bottom);
    }, 120);

    const bandsAbove = (tpl.bands || []).filter((b) => b.position === "above-table");
    const bandsBelow = (tpl.bands || []).filter((b) => b.position === "below-table");
    const aboveBandsTotal = bandsAbove.reduce((s, b) => s + (b.height || 60), 0);
    const belowBandsTotal = bandsBelow.reduce((s, b) => s + (b.height || 30), 0);

    const tableCfg = tpl.table_config || {};
    const rowHeight = tableCfg.rowHeight || 60;
    const headerFontSize = tableCfg.headerFontSize || 16;
    const tableHeaderHeight = headerFontSize + 24;
    const tableHeight = tableHeaderHeight + tests.length * rowHeight;

    const footerLines = tpl.footer_lines || [];
    const footerHeight = footerLines.reduce((s, fl) => s + (fl.fontSize || 20) + 14, 30);

    const padding = 30;
    const canvasHeight =
      headerBandHeight + detailsBandHeight + aboveBandsTotal + tableHeight + belowBandsTotal + footerHeight + padding;

    const canvas = document.createElement("canvas");
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("ctx_error");

    // Background
    ctx.fillStyle = tpl.background_color || "#FFFFFF";
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    let cursorY = 0;

    // Header band (logo)
    if (tpl.show_header_band !== false && headerBandHeight > 0) {
      ctx.fillStyle = tpl.header_bg_color || "#FFFFFF";
      ctx.fillRect(0, cursorY, canvasWidth, headerBandHeight);
      if (tpl.logo_url) {
        try {
          const logoImg = await loadImage(tpl.logo_url);
          const lw = tpl.logo_width || 200;
          const lh = tpl.logo_height || 80;
          const lx = tpl.logo_x ?? 20;
          const ly = (tpl.logo_y ?? 20) + cursorY;
          ctx.drawImage(logoImg, lx, ly, lw, lh);
        } catch (e) {
          console.warn("logo load failed", e);
        }
      }
      cursorY += headerBandHeight;
    }

    // Patient details band
    const detailsBandTop = cursorY;
    for (const p of placeholders) {
      const isBarcode = p.field === "Barcode";
      const fontSize = p.fontSize || 25;
      const fontColor = p.fontColor || "#000000";
      const xPx = ((p.x || 0) / 100) * canvasWidth;
      const yPx = detailsBandTop + (p.y || 0);

      if (isBarcode) {
        drawBarcode(ctx, patient.mobile_number || "", xPx, yPx, fontSize, fontColor);
        continue;
      }

      let text = "";
      if (p.field === "Name") text = (patient.patient_name || "").toUpperCase();
      else if (p.field === "Mobile") text = normalizeIndianMobile(patient.mobile_number || "");
      else if (p.field === "UMR") text = patient.umr_number || "";

      if (!text) continue;
      ctx.font = `${p.bold ? "bold " : ""}${fontSize}px Arial, Helvetica, sans-serif`;
      ctx.fillStyle = fontColor;
      ctx.textBaseline = "top";
      ctx.fillText(text, xPx, yPx);
    }
    cursorY += detailsBandHeight;

    // Helper to draw band (above/below table)
    const drawBand = (band: NonNullable<AbnormalCardTemplate["bands"]>[number]) => {
      const h = band.height || 60;
      ctx.fillStyle = band.color || "#2E3192";
      ctx.fillRect(0, cursorY, canvasWidth, h);
      const text = band.text || "";
      if (text) {
        const fs = band.fontSize || 24;
        ctx.font = `${band.bold ? "bold " : ""}${fs}px Arial, Helvetica, sans-serif`;
        ctx.fillStyle = band.textColor || "#FFFFFF";
        ctx.textBaseline = "middle";
        const align = band.align || "left";
        ctx.textAlign = align;
        const tx = align === "center" ? canvasWidth / 2 : align === "right" ? canvasWidth - 20 : 20;
        // Append patient name to "Health History for" band per legacy behavior
        const fullText = /history for/i.test(text)
          ? `${text} ${(patient.patient_name || "").toUpperCase()}`.trim()
          : text;
        ctx.fillText(fullText, tx, cursorY + h / 2);
        ctx.textAlign = "left";
      }
      cursorY += h;
    };

    bandsAbove.forEach(drawBand);

    // Abnormal tests table
    const colWeights = tableCfg.colWidths && tableCfg.colWidths.length === 4
      ? tableCfg.colWidths
      : [0.38, 0.18, 0.18, 0.26];
    const colWidths = colWeights.map((w) => Math.floor(w * canvasWidth));

    // Header row
    const colAligns = (tableCfg.colAligns && tableCfg.colAligns.length === 4
      ? tableCfg.colAligns
      : ["left", "center", "center", "center"]) as Array<"left" | "center" | "right">;

    // Helper: shrink font to fit within column width
    const fitFontSize = (text: string, baseSize: number, maxWidth: number, bold: boolean, family: string) => {
      let size = baseSize;
      while (size > 8) {
        ctx.font = `${bold ? "bold " : ""}${size}px ${family}, Helvetica, sans-serif`;
        if (ctx.measureText(text).width <= maxWidth) return size;
        size -= 1;
      }
      return size;
    };

    ctx.fillStyle = tableCfg.headerBg || "#2E3192";
    ctx.fillRect(0, cursorY, canvasWidth, tableHeaderHeight);
    ctx.fillStyle = tableCfg.headerFontColor || "#FFFFFF";
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    const headers = ["Test Name", "Date", "Result", "Normal Range"];
    let xCursor = 0;
    headers.forEach((h, i) => {
      const fs = fitFontSize(h, headerFontSize, colWidths[i] - 12, true, tableCfg.headerFont || "Arial");
      ctx.font = `bold ${fs}px ${tableCfg.headerFont || "Arial"}, Helvetica, sans-serif`;
      ctx.fillText(h, xCursor + colWidths[i] / 2, cursorY + tableHeaderHeight / 2);
      xCursor += colWidths[i];
    });
    cursorY += tableHeaderHeight;

    // Rows
    const rowFontSize = tableCfg.rowFontSize || 24;
    const rowFontColor = tableCfg.rowFontColor || "#333333";
    const altRowColor = tableCfg.altRowColor || "#F9F9FC";
    const borderColor = tableCfg.borderColor || "#E0E0E8";
    const resultColor = tableCfg.resultColor || "#ed1c23";

    tests.forEach((t, i) => {
      if (i % 2 === 1) {
        ctx.fillStyle = altRowColor;
        ctx.fillRect(0, cursorY, canvasWidth, rowHeight);
      }
      const cells = [
        t.test_name || "",
        formatDateDDMMYYYY(t.test_date || ""),
        t.result_value || "",
        t.normal_range || "",
      ];
      ctx.textBaseline = "middle";
      let cx = 0;
      cells.forEach((cell, ci) => {
        const isResult = ci === 2;
        const al = colAligns[ci] || "center";
        const maxW = colWidths[ci] - 12;
        const fs = fitFontSize(cell, rowFontSize, maxW, isResult, "Arial");
        ctx.fillStyle = isResult ? resultColor : rowFontColor;
        ctx.font = `${isResult ? "bold " : ""}${fs}px Arial, Helvetica, sans-serif`;
        ctx.textAlign = al;
        const tx = al === "left" ? cx + 18 : al === "right" ? cx + colWidths[ci] - 18 : cx + colWidths[ci] / 2;
        ctx.fillText(cell, tx, cursorY + rowHeight / 2);
        cx += colWidths[ci];
      });
      // Bottom border
      ctx.strokeStyle = borderColor;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, cursorY + rowHeight);
      ctx.lineTo(canvasWidth, cursorY + rowHeight);
      ctx.stroke();
      cursorY += rowHeight;
    });

    bandsBelow.forEach(drawBand);

    // Footer lines
    cursorY += 10;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    footerLines.forEach((fl) => {
      const fs = fl.fontSize || 20;
      ctx.font = `${fl.bold ? "bold " : ""}${fs}px Arial, Helvetica, sans-serif`;
      ctx.fillStyle = fl.fontColor || "#666666";
      const align = fl.align || "left";
      ctx.textAlign = align;
      const tx = align === "center" ? canvasWidth / 2 : align === "right" ? canvasWidth - 20 : 20;
      ctx.fillText(fl.text || "", tx, cursorY);
      cursorY += fs + 8;
    });

    const blobFn = async () => {
      try {
        return await exportCanvasAsCompressedJpeg(canvas);
      } catch {
        throw new Error("toblob_null");
      }
    };
    const url = await uploadJpegToCloudinaryWithRetry(blobFn);
    return url;
  } catch (err) {
    console.error("generateAbnormalCardForDrip failed:", err);
    return null;
  }
}
