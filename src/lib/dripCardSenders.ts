/**
 * Shared drip-style card senders. Used by:
 * - AutomatedMarketing (live drip campaigns)
 * - MarketingRetry (regenerate cards for failed rows from live CRM data)
 *
 * Each sender:
 * 1. Loads the active template from DB
 * 2. Regenerates the card image fresh (so storage cleanup of stale images
 *    doesn't break retries)
 * 3. Calls whatsapp-proxy
 * 4. Returns { ok, retryPayload, messageId } so callers can log + persist
 */

import { supabase } from "@/integrations/supabase/client";
import {
  generateAndUploadCard,
  getTemplateAssets,
  exportCanvasAsCompressedJpeg,
  type CardData,
  type CardFailureReason,
} from "@/lib/cardRenderer";
import { uploadJpegToCloudinaryWithRetry } from "@/lib/cardStorageCloudinary";
import { sortAbnormalTestsByDateDesc } from "@/lib/abnormalTests";
import { extractMessageId } from "@/lib/messageLog";

export type AbnormalCardFailureReason = CardFailureReason;
export interface AbnormalCardResult {
  url: string | null;
  reason?: AbnormalCardFailureReason;
}

function classifyAbnormalUploadError(err: unknown): AbnormalCardFailureReason {
  const msg = String((err as { message?: string })?.message || err || "").toLowerCase();
  if (msg.includes("exist") || msg.includes("duplicate")) return "upload_collision";
  if (/\b(5\d\d|429|timeout|network|fetch)\b/.test(msg)) return "upload_5xx";
  return "upload_failed";
}

function freshAbnormalFileName() {
  const uuid = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
  return `generated/abnormal/${Date.now()}_${uuid}.jpg`;
}

async function uploadAbnormalWithRetry(
  blobFn: () => Promise<Blob>,
  initialPath: string,
): Promise<{ path: string }> {
  let path = initialPath;
  let lastReason: AbnormalCardFailureReason = "upload_failed";
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const blob = await blobFn();
      const { error } = await supabase.storage
        .from("loyalty-cards")
        .upload(path, blob, { contentType: "image/jpeg" });
      if (!error) return { path };
      lastErr = error;
      lastReason = classifyAbnormalUploadError(error);
      if (lastReason === "upload_collision") path = freshAbnormalFileName();
    } catch (e) {
      lastErr = e;
      const msg = String((e as Error)?.message || e || "");
      lastReason = msg === "toblob_null" ? "toblob_null" : classifyAbnormalUploadError(e);
    }
    if (attempt < 2) await new Promise((r) => setTimeout(r, 250 * Math.pow(3, attempt)));
  }
  const tagged = new Error(lastReason) as Error & { reason: AbnormalCardFailureReason };
  tagged.reason = lastReason;
  (tagged as { cause?: unknown }).cause = lastErr;
  throw tagged;
}

export interface DripContact {
  id?: string;
  primary_key?: string | null;
  patient_name?: string | null;
  mobile_number?: string | null;
  umr_number?: string | null;
  default_discount_pct?: number | null;
}

export interface DripGlobalCfg {
  [key: string]: string;
}

export interface DripSendResult {
  ok: boolean;
  retryPayload: Record<string, unknown> | null;
  messageId: string | null;
  reason?: string;
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

/**
 * Render an Abnormal History card (PNG) and upload to storage.
 * Returns `{ url, reason? }` — `url` is the public URL on success;
 * `reason` is a tagged failure cause on failure (consumed by the drip log).
 */
export async function generateAbnormalCardForDripEx(
  contact: DripContact,
  tests: any[],
  template: any,
  expiryDate: string,
): Promise<AbnormalCardResult> {
  try {
    const cw = template?.canvas_width || 900;
    const padding = 30;
    const tRowHeight = (template?.table_config as any)?.rowHeight || 35;
    const tableHeaderH = (template?.table_config as any)?.headerHeight || 40;
    const hdrH = template?.show_header_band !== false ? (template?.header_band_height || 160) : 0;

    const bandsArr = Array.isArray(template?.bands) ? template.bands : [];
    const bandsAboveH = bandsArr.filter((b: any) => b.position === "above-table").reduce((s: number, b: any) => s + (b.height || 40), 0);
    const bandsBelowH = bandsArr.filter((b: any) => b.position === "below-table").reduce((s: number, b: any) => s + (b.height || 40), 0);
    const footerLinesArr = Array.isArray(template?.footer_lines) ? template.footer_lines : [];
    const footerH = footerLinesArr.reduce((s: number, fl: any) => s + (fl.fontSize || 12) + 8, 0);

    const height = hdrH + bandsAboveH + 10 + tableHeaderH + tests.length * tRowHeight + 10 + bandsBelowH + footerH + 40;

    const canvas = document.createElement("canvas");
    canvas.width = cw;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return { url: null, reason: "ctx_error" };

    const bgColor = template?.background_color || "#FFFFFF";
    const headerBg = template?.header_bg_color || "#2E3192";
    const headerFontCol = template?.header_font_color || "#FFFFFF";

    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, cw, height);

    if (template?.show_header_band !== false) {
      ctx.fillStyle = headerBg;
      ctx.fillRect(0, 0, cw, hdrH);
    }

    if (template?.logo_url) {
      try {
        const response = await fetch(template.logo_url);
        const blob = await response.blob();
        const dataUrl = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.readAsDataURL(blob);
        });
        const logoImg = await new Promise<HTMLImageElement>((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = () => reject();
          img.src = dataUrl;
        });
        const lx = ((template.logo_x ?? 2) / 100) * cw;
        const ly = ((template.logo_y ?? 2) / 100) * hdrH;
        ctx.drawImage(logoImg, lx, ly, template.logo_width || 120, template.logo_height || 60);
      } catch {}
    }

    const tc = (template?.table_config || {}) as any;
    const tHeaderBg = tc.headerBgColor || "#2E3192";
    const tHeaderFontColor = tc.headerFontColor || "#FFFFFF";
    const tHeaderFontSize = tc.headerFontSize || 14;
    const tRowFontSize = tc.rowFontSize || 13;
    const tRowFontColor = tc.rowFontColor || "#333333";
    const tResultColor = tc.resultColor || "#CC0000";
    const tAltRowColor = tc.altRowColor || "#F5F5F5";
    const tBorderColor = tc.borderColor || "#DDDDDD";
    const colWidths = tc.colWidths || [0.35, 0.18, 0.17, 0.30];

    let cursorY = hdrH;
    bandsArr.filter((b: any) => b.position === "above-table").forEach((b: any) => {
      ctx.fillStyle = b.color || "#2E3192";
      ctx.fillRect(0, cursorY, cw, b.height || 40);
      if (b.text) {
        ctx.fillStyle = b.textColor || "#FFFFFF";
        ctx.font = `${b.bold ? "bold " : ""}${b.fontSize || 14}px Arial, sans-serif`;
        ctx.textBaseline = "middle";
        ctx.textAlign = b.align === "center" ? "center" : b.align === "right" ? "right" : "left";
        const tx = b.align === "center" ? cw / 2 : b.align === "right" ? cw - padding : padding;
        ctx.fillText(b.text, tx, cursorY + (b.height || 40) / 2);
      }
      cursorY += b.height || 40;
    });

    const tableY = cursorY + 10;
    const tableW = cw - padding * 2;
    const colStarts = [0, colWidths[0], colWidths[0] + colWidths[1], colWidths[0] + colWidths[1] + colWidths[2]].map(
      (f) => padding + f * tableW + 10
    );
    const colEnds = [...colStarts.slice(1), padding + tableW];
    const colMaxWidths = colStarts.map((s, i) => colEnds[i] - s - 6);

    const fillTextFit = (ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, font: string, minScale = 0.6, align = "left") => {
      const baseSizeMatch = font.match(/(\d+)px/);
      const baseSize = baseSizeMatch ? parseInt(baseSizeMatch[1]) : 14;
      let scale = 1;
      while (scale >= minScale) {
        ctx.font = font.replace(`${baseSize}px`, `${Math.round(baseSize * scale)}px`);
        const m = ctx.measureText(text);
        if (m.width <= maxW) break;
        scale -= 0.05;
      }
      if (scale < minScale) {
        ctx.font = font.replace(`${baseSize}px`, `${Math.round(baseSize * minScale)}px`);
      }
      if (align === "center") {
        const tw = ctx.measureText(text).width;
        ctx.textAlign = "left";
        ctx.fillText(text, x + (maxW - tw) / 2, y);
      } else {
        ctx.textAlign = "left";
        ctx.fillText(text, x, y);
      }
    };

    ctx.fillStyle = tHeaderBg;
    ctx.fillRect(padding, tableY, tableW, tableHeaderH);
    ctx.fillStyle = tHeaderFontColor;
    ctx.textBaseline = "middle";
    const hdrFont = `bold ${tHeaderFontSize}px Arial, sans-serif`;
    const hdrMid = tableY + tableHeaderH / 2;
    fillTextFit(ctx, "Test Name", colStarts[0], hdrMid, colMaxWidths[0], hdrFont, 0.6, "center");
    fillTextFit(ctx, "Date", colStarts[1], hdrMid, colMaxWidths[1], hdrFont, 0.6, "center");
    fillTextFit(ctx, "Result", colStarts[2], hdrMid, colMaxWidths[2], hdrFont, 0.6, "center");
    fillTextFit(ctx, "Normal Range", colStarts[3], hdrMid, colMaxWidths[3], hdrFont, 0.6, "center");

    const sortedTests = sortAbnormalTestsByDateDesc(tests);
    sortedTests.forEach((t, i) => {
      const y = tableY + tableHeaderH + i * tRowHeight;
      if (i % 2 === 1) {
        ctx.fillStyle = tAltRowColor;
        ctx.fillRect(padding, y, tableW, tRowHeight);
      }
      ctx.strokeStyle = tBorderColor;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(padding, y + tRowHeight);
      ctx.lineTo(padding + tableW, y + tRowHeight);
      ctx.stroke();

      ctx.fillStyle = tRowFontColor;
      ctx.textBaseline = "middle";
      const rowFont = `${tRowFontSize}px Arial, sans-serif`;
      const rowMid = y + tRowHeight / 2;
      fillTextFit(ctx, t.test_name || "", colStarts[0], rowMid, colMaxWidths[0], rowFont);
      fillTextFit(ctx, t.test_date || "", colStarts[1], rowMid, colMaxWidths[1], rowFont, 0.6, "center");

      ctx.fillStyle = tResultColor;
      const boldRowFont = `bold ${tRowFontSize}px Arial, sans-serif`;
      fillTextFit(ctx, t.result_value || "", colStarts[2], rowMid, colMaxWidths[2], boldRowFont, 0.6, "center");

      ctx.fillStyle = tRowFontColor;
      fillTextFit(ctx, t.normal_range || "", colStarts[3], rowMid, colMaxWidths[3], rowFont);
    });

    ctx.strokeStyle = tHeaderBg;
    ctx.lineWidth = 2;
    ctx.strokeRect(padding, tableY, tableW, tableHeaderH + tests.length * tRowHeight);

    let belowY = tableY + tableHeaderH + tests.length * tRowHeight + 10;
    bandsArr.filter((b: any) => b.position === "below-table").forEach((b: any) => {
      ctx.fillStyle = b.color || "#2E3192";
      ctx.fillRect(0, belowY, cw, b.height || 40);
      if (b.text) {
        ctx.fillStyle = b.textColor || "#FFFFFF";
        ctx.font = `${b.bold ? "bold " : ""}${b.fontSize || 14}px Arial, sans-serif`;
        ctx.textBaseline = "middle";
        ctx.textAlign = b.align === "center" ? "center" : b.align === "right" ? "right" : "left";
        const tx = b.align === "center" ? cw / 2 : b.align === "right" ? cw - padding : padding;
        ctx.fillText(b.text, tx, belowY + (b.height || 40) / 2);
      }
      belowY += b.height || 40;
    });

    let fy = belowY + 10;
    footerLinesArr.forEach((fl: any) => {
      ctx.fillStyle = fl.fontColor || "#666666";
      ctx.font = `${fl.bold ? "bold " : ""}${fl.fontSize || 12}px Arial, sans-serif`;
      ctx.textAlign = fl.align === "center" ? "center" : fl.align === "right" ? "right" : "left";
      const fx = fl.align === "center" ? cw / 2 : fl.align === "right" ? cw - padding : padding;
      ctx.fillText(fl.text || "", fx, fy);
      fy += (fl.fontSize || 12) + 8;
    });

    const phs: any[] = template?.placeholders ? (typeof template.placeholders === "string" ? JSON.parse(template.placeholders) : template.placeholders) : [];
    const designerSampleRows = 3;
    const rowDiff = (tests.length - designerSampleRows) * tRowHeight;
    const designerTableEndY = hdrH + bandsAboveH + tableHeaderH + designerSampleRows * tRowHeight;

    const drawBarcodeOnCanvas = (ctx: CanvasRenderingContext2D, value: string, x: number, y: number, bHeight: number, color: string) => {
      const digits = value.replace(/\D/g, "");
      if (!digits) return;
      const evenDigits = digits.length % 2 === 0 ? digits : `0${digits}`;
      const codes = [105 as number];
      for (let i = 0; i < evenDigits.length; i += 2) codes.push(Number(evenDigits.slice(i, i + 2)));
      let checksum = 105;
      for (let i = 1; i < codes.length; i++) checksum += codes[i] * i;
      codes.push(checksum % 103);
      codes.push(106);
      const patterns = codes.map((code) => CODE128_PATTERNS[code]).filter(Boolean);
      const totalModules = patterns.reduce((sum, p) => sum + p.split("").reduce((acc, w) => acc + Number(w), 0), 0);
      const targetWidth = Math.max(evenDigits.length * bHeight * 0.38, bHeight * 2.8);
      const moduleWidth = targetWidth / totalModules;
      ctx.save();
      ctx.fillStyle = color;
      let cursorX2 = x;
      for (const pattern of patterns) {
        pattern.split("").forEach((seg, idx) => {
          const width = Number(seg) * moduleWidth;
          if (idx % 2 === 0) ctx.fillRect(cursorX2, y, width, bHeight);
          cursorX2 += width;
        });
      }
      ctx.restore();
    };

    if (phs.length > 0) {
      for (const p of phs) {
        const px = (p.x / 100) * cw;
        let py = p.y;
        if (py > designerTableEndY) py += rowDiff;
        if (p.field === "Barcode") {
          drawBarcodeOnCanvas(ctx, contact.mobile_number || "", px, py, p.fontSize || 20, p.fontColor || headerFontCol);
        } else {
          ctx.font = `${p.bold ? "bold " : ""}${p.fontSize || 18}px Arial, Helvetica, sans-serif`;
          ctx.fillStyle = p.fontColor || headerFontCol;
          ctx.textBaseline = "top";
          ctx.textAlign = "left";
          const val = p.field === "Name" ? (contact.patient_name || "").toUpperCase()
            : p.field === "Mobile" ? `Mobile: ${contact.mobile_number || ""}`
            : p.field === "Expiry Date" ? expiryDate
            : `UMR: ${contact.umr_number || ""}`;
          ctx.fillText(val, px, py);
        }
      }
    } else {
      ctx.fillStyle = headerFontCol;
      ctx.font = "bold 28px Arial, Helvetica, sans-serif";
      ctx.textBaseline = "top";
      ctx.fillText("Abnormal Test History", padding, 20);
      ctx.font = "18px Arial, Helvetica, sans-serif";
      ctx.fillText(`Name: ${(contact.patient_name || "").toUpperCase()}`, padding, 60);
      ctx.fillText(`Mobile: ${contact.mobile_number || ""}`, padding, 88);
      ctx.fillText(`UMR: ${contact.umr_number || ""}`, padding + 400, 88);
    }

    // Downscaled JPEG (max 800px width, q=0.72) — ~55% smaller than full PNG, slashes WhatsApp egress.
    // Bounded retry around toBlob + upload absorbs transient storage errors and
    // birthday-paradox filename collisions under high concurrency.
    const blobFn = async () => {
      try {
        return await exportCanvasAsCompressedJpeg(canvas);
      } catch {
        throw new Error("toblob_null");
      }
    };
    const { path } = await uploadAbnormalWithRetry(blobFn, freshAbnormalFileName());
    const { data: urlData } = supabase.storage.from("loyalty-cards").getPublicUrl(path);
    return { url: urlData.publicUrl };
  } catch (err) {
    const reason = (err as { reason?: AbnormalCardFailureReason })?.reason || "upload_failed";
    console.error(`Drip abnormal card generation failed (${reason}):`, err);
    return { url: null, reason };
  }
}

/**
 * Back-compat wrapper that returns just the URL (or null on failure). New code
 * should prefer `generateAbnormalCardForDripEx` to surface the tagged failure reason.
 */
export async function generateAbnormalCardForDrip(
  contact: DripContact,
  tests: any[],
  template: any,
  expiryDate: string,
): Promise<string | null> {
  const { url } = await generateAbnormalCardForDripEx(contact, tests, template, expiryDate);
  return url;
}

// =================== Senders for Retry ===================

interface CardTemplateRow { id: string }

/**
 * Regenerate an ABC loyalty card and send via whatsapp-proxy.
 */
export async function sendABCCard(opts: {
  contact: DripContact;
  cfg: DripGlobalCfg;
  abcTmpl: any | null;
  cardTemplateId?: string | null;
}): Promise<DripSendResult> {
  const { contact, cfg, abcTmpl } = opts;
  const mob = (contact.mobile_number || "").replace(/\D/g, "").slice(-10);
  if (!mob) return { ok: false, retryPayload: null, messageId: null, reason: "invalid_mobile" };

  const apiBaseUrl = cfg["wa_global_baseUrl"];
  const apiKey = cfg["wa_global_apiKey"];
  const templateName = abcTmpl?.whatsapp_template_name || "";
  const headerName = cfg["wa_global_authHeaderName"] || "apikey";
  const headerPrefix = cfg["wa_global_authHeaderPrefix"] || "";
  const fromNumber = cfg["wa_global_fromNumber"] || "";
  const campaignName = abcTmpl?.api_base_url || "";
  const bodyMappingStr = abcTmpl?.body_mapping || "";
  const staticExpiryDate = cfg["loyalty_static_expiry_date"] || "";

  if (!apiBaseUrl || !apiKey || !templateName) {
    return { ok: false, retryPayload: null, messageId: null, reason: "wa_not_configured" };
  }

  // Pick a card template — use the explicit one if provided, else first available.
  let templateId = opts.cardTemplateId || null;
  if (!templateId) {
    const { data: tpls } = await supabase
      .from("loyalty_card_templates")
      .select("id")
      .order("created_at", { ascending: false })
      .limit(1);
    templateId = tpls && tpls[0]?.id || null;
  }
  if (!templateId) return { ok: false, retryPayload: null, messageId: null, reason: "no_template" };

  const assets = await getTemplateAssets(templateId);
  if (!assets) return { ok: false, retryPayload: null, messageId: null, reason: "template_load_error" };

  const cardData: CardData = {
    Name: contact.patient_name || "",
    Mobile: contact.mobile_number || "",
    UMR: contact.umr_number || "",
    "Discount %": `${contact.default_discount_pct ?? 20}%`,
    "Expiry Date": staticExpiryDate,
  };
  const imageUrl = await generateAndUploadCard(
    templateId, cardData, assets.bgImg, assets.placeholders,
  );
  if (!imageUrl) return { ok: false, retryPayload: null, messageId: null, reason: "card_generation_error" };

  let mapping: Record<string, string> = {};
  try { mapping = bodyMappingStr ? JSON.parse(bodyMappingStr) : {}; } catch { mapping = {}; }
  const components: Record<string, unknown> = {};
  if (Object.keys(mapping).length > 0) {
    const sortedKeys = Object.keys(mapping).sort((a, b) => Number(a) - Number(b));
    components.body = { params: sortedKeys.map((key) => {
      const f = mapping[key];
      if (f === "Name") return contact.patient_name || "";
      if (f === "Mobile") return contact.mobile_number || "";
      if (f === "UMR") return contact.umr_number || "";
      if (f === "Discount %") return `${contact.default_discount_pct ?? 20}%`;
      if (f === "Expiry Date") return staticExpiryDate;
      return "";
    })};
  }
  components.header = { type: "image", image: { link: imageUrl } };

  const payload: Record<string, unknown> = {
    from: fromNumber, to: `+91${mob}`, templateName,
    campaignName, type: "template", components,
  };
  const retryPayload: Record<string, unknown> = {
    kind: "drip-proxy", message_type: "ABC",
    apiBaseUrl, apiKey, authHeaderName: headerName, authHeaderPrefix: headerPrefix, payload,
  };

  try {
    const proxyRes = await supabase.functions.invoke("whatsapp-proxy", {
      body: { apiBaseUrl, apiKey, authHeaderName: headerName, authHeaderPrefix: headerPrefix, payload },
    });
    const apiOk = !proxyRes.error && (proxyRes.data?.status ?? 200) < 400;
    return {
      ok: apiOk,
      retryPayload,
      messageId: apiOk ? extractMessageId(proxyRes.data) : null,
      reason: apiOk ? undefined : "wa_api_error",
    };
  } catch {
    return { ok: false, retryPayload, messageId: null, reason: "wa_exception" };
  }
}

/**
 * Regenerate an Abnormal History card from `crm_abnormal_tests` and send.
 * Caller is expected to have already looked up `tests` for this contact.
 */
export async function sendAbnormalCard(opts: {
  contact: DripContact;
  tests: any[];
  cfg: DripGlobalCfg;
  abnTmpl: any | null;
  abnormalTemplateId?: string | null;
}): Promise<DripSendResult> {
  const { contact, tests, cfg, abnTmpl } = opts;
  const mob = (contact.mobile_number || "").replace(/\D/g, "").slice(-10);
  if (!mob) return { ok: false, retryPayload: null, messageId: null, reason: "invalid_mobile" };
  if (!tests || tests.length === 0) {
    return { ok: false, retryPayload: null, messageId: null, reason: "no_abnormal_history" };
  }

  const apiBaseUrl = cfg["wa_global_baseUrl"];
  const apiKey = cfg["wa_global_apiKey"];
  const headerName = cfg["wa_global_authHeaderName"] || "apikey";
  const headerPrefix = cfg["wa_global_authHeaderPrefix"] || "";
  const fromNumber = cfg["wa_global_fromNumber"] || "";
  const templateName = abnTmpl?.whatsapp_template_name || "";
  const campaignName = abnTmpl?.api_base_url || "";
  const includeMediaHeader = abnTmpl?.from_number === "media_header_enabled";
  if (!apiBaseUrl || !apiKey || !templateName) {
    return { ok: false, retryPayload: null, messageId: null, reason: "wa_not_configured" };
  }

  let abnTemplate: any = null;
  let abnTemplateId = opts.abnormalTemplateId || null;
  if (!abnTemplateId) {
    const { data: tpls } = await supabase
      .from("abnormal_card_templates")
      .select("id")
      .order("created_at", { ascending: false })
      .limit(1);
    abnTemplateId = tpls && tpls[0]?.id || null;
  }
  if (abnTemplateId) {
    const { data } = await supabase.from("abnormal_card_templates").select("*").eq("id", abnTemplateId).single();
    abnTemplate = data;
  }
  const staticExpiryDate = cfg["abnormal_static_expiry_date"] || "";

  const imageUrl = includeMediaHeader
    ? await generateAbnormalCardForDrip(contact, tests, abnTemplate, staticExpiryDate)
    : null;

  const components: Record<string, unknown> = {};
  if (includeMediaHeader && imageUrl) {
    components.header = { type: "image", image: { link: imageUrl } };
  }
  components.body = { params: [(contact.patient_name || "").toUpperCase()] };

  const payload: Record<string, unknown> = {
    from: fromNumber, to: `+91${mob}`, templateName, campaignName, type: "template", components,
  };
  const retryPayload: Record<string, unknown> = {
    kind: "drip-proxy", message_type: "Abnormal History",
    apiBaseUrl, apiKey, authHeaderName: headerName, authHeaderPrefix: headerPrefix, payload,
  };

  try {
    const proxyRes = await supabase.functions.invoke("whatsapp-proxy", {
      body: { apiBaseUrl, apiKey, authHeaderName: headerName, authHeaderPrefix: headerPrefix, payload },
    });
    const apiOk = !proxyRes.error && (proxyRes.data?.status ?? 200) < 400;
    return {
      ok: apiOk,
      retryPayload,
      messageId: apiOk ? extractMessageId(proxyRes.data) : null,
      reason: apiOk ? undefined : "wa_api_error",
    };
  } catch {
    return { ok: false, retryPayload, messageId: null, reason: "wa_exception" };
  }
}
