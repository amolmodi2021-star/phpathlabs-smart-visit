import { supabase } from "@/integrations/supabase/client";

/**
 * Downscale a source canvas to a maximum width (default 800px, preserving aspect ratio)
 * and export as JPEG at quality 0.72. This is the cost-saving export path used by every
 * personalized card flow (loyalty cards, drip ABC, drip abnormal). Drops typical card
 * size from ~80 KB → ~35 KB with no visible quality loss on flat designs.
 */
export async function exportCanvasAsCompressedJpeg(
  source: HTMLCanvasElement,
  maxWidth = 800,
  quality = 0.72,
): Promise<Blob> {
  const scale = source.width > maxWidth ? maxWidth / source.width : 1;
  const targetW = Math.round(source.width * scale);
  const targetH = Math.round(source.height * scale);

  let exportCanvas: HTMLCanvasElement = source;
  if (scale < 1) {
    exportCanvas = document.createElement("canvas");
    exportCanvas.width = targetW;
    exportCanvas.height = targetH;
    const ectx = exportCanvas.getContext("2d");
    if (!ectx) throw new Error("Failed to create export canvas context");
    ectx.imageSmoothingEnabled = true;
    ectx.imageSmoothingQuality = "high";
    ectx.drawImage(source, 0, 0, targetW, targetH);
  }

  return await new Promise<Blob>((resolve, reject) => {
    exportCanvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Canvas toBlob failed"))),
      "image/jpeg",
      quality,
    );
  });
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
  const digits = value.replace(/\D/g, "");
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
  if (!response.ok) throw new Error("Failed to fetch background image");
  const blob = await response.blob();
  const dataUrl = await new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.readAsDataURL(blob);
  });
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load background image"));
    img.src = dataUrl;
  });
}

export interface CardData {
  Name: string;
  Mobile: string;
  UMR: string;
  "Discount %": string;
  "Expiry Date": string;
}

/**
 * Generate a loyalty card image, upload to storage, insert into loyalty_cards table.
 * Returns the public URL of the generated image, or null on failure.
 */
export async function generateAndUploadCard(
  templateId: string,
  data: CardData,
  bgImg: HTMLImageElement,
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  placeholders: any[],
): Promise<string | null> {
  try {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bgImg, 0, 0);

    for (const p of placeholders) {
      const isBarcode = p.field === "Barcode";
      const text = isBarcode ? (data["Mobile"] || "") : (data[p.field as keyof CardData] || "");
      if (!text) continue;
      const x = (p.x / 100) * canvas.width;
      const y = (p.y / 100) * canvas.height;
      const fontSize = p.fontSize || 32;
      const fontColor = p.fontColor || "#000000";
      if (isBarcode) { drawBarcode(ctx, text, x, y, fontSize, fontColor); continue; }
      const bold = p.bold ? "bold" : "normal";
      ctx.font = `${bold} ${fontSize}px Arial, Helvetica, sans-serif`;
      ctx.fillStyle = fontColor;
      ctx.textBaseline = "top";
      ctx.fillText(text, x, y);
    }

    // Downscale to max 800px width + JPEG @ 0.72 — ~55% smaller than 0.85 full-size,
    // visually identical for these flat card designs. Slashes WhatsApp egress.
    const blob = await exportCanvasAsCompressedJpeg(canvas);

    const fileName = `generated/crm/${Date.now()}_${Math.random().toString(36).slice(2, 6)}.jpg`;
    const { error: uploadError } = await supabase.storage
      .from("loyalty-cards")
      .upload(fileName, blob, { contentType: "image/jpeg" });
    if (uploadError) throw uploadError;

    const { data: urlData } = supabase.storage.from("loyalty-cards").getPublicUrl(fileName);
    return urlData.publicUrl;
  } catch (err) {
    console.error("Card generation failed:", err);
    return null;
  }
}

export async function getTemplateAssets(templateId: string) {
  const { data: template } = await supabase.from("loyalty_card_templates").select("*").eq("id", templateId).single();
  if (!template?.background_image_url) return null;
  const bgImg = await loadImage(template.background_image_url);
  const canvas = document.createElement("canvas");
  canvas.width = bgImg.naturalWidth;
  canvas.height = bgImg.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  return { bgImg, canvas, ctx, placeholders: (template.placeholders as any[]) || [] };
}
