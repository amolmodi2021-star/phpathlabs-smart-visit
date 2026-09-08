import { useRef, useState, useEffect, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Printer, Send, Loader2, Wallet, CheckCircle2 } from "lucide-react";
import { format } from "date-fns";
import { toJpeg, getFontEmbedCSS } from "html-to-image";
import JsBarcode from "jsbarcode";
import { logMessageSend } from "@/lib/messageLog";
import { enqueueInvoiceForWhatsAppConsole } from "@/lib/whatsappConsoleBridge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { getCurrentUserName } from "@/lib/auth";
import { patientDisplayName } from "@/lib/patientDisplayName";
import { formatPatientAge } from "@/lib/patientAge";
import {
  fetchPackageIncludedTestNamesFromLines,
  formatPackageIncludedTests,
} from "@/lib/invoicePackageTests";
import { computeHvcRefundAmount } from "@/lib/invoiceRefundDisplay";
import {
  shouldFireBoundInvoiceQueue,
  type InvoiceQueueToken,
} from "@/lib/whatsappOutboxQueue";
import {
  getInvoiceBrandCached,
  INVOICE_BRAND_DEFAULTS,
} from "@/lib/invoiceBrandCache";

interface InvoicePreviewProps {
  data: any;
  open: boolean;
  onClose: () => void;
  /** After registration: auto-enqueue invoice to WhatsApp Console outbox once. */
  autoQueueWhatsApp?: boolean;
  /** Hide Print (e.g. home-visit completion receipt — WhatsApp only). */
  hidePrint?: boolean;
  /**
   * Parent-driven sequential queue (home-visit multi-patient). Bound to invoice
   * number so a leftover token cannot fire the next patient's capture.
   */
  queueRequest?: InvoiceQueueToken | null;
  /** Called when fonts + package names for the current invoice are ready to capture. */
  onReady?: (invoiceNumber: string) => void;
  /** Called when a triggered / button queue finishes. */
  onQueueSettled?: (result: { ok: boolean; error?: string; invoiceNumber?: string }) => void;
  /** Optional status line shown above actions (e.g. batch send progress). */
  statusHint?: string;
}

function invoiceLineAmount(t: any): number {
  return Number(t?.price || 0);
}

/** Net after discount; keep 0 when 100% discount (do not fall back via ||). */
function invoiceLineNet(t: any): number {
  const net = t?.discounted_price ?? t?.discountedPrice;
  if (net !== undefined && net !== null && net !== "") return Number(net) || 0;
  return Number(t?.price || 0);
}

function invoiceLineDiscount(t: any): number {
  return Number(t?.discount || 0);
}

/** Prefer payment timestamp; fall back to registration time (registration-time payments). */
function paymentTimestamp(
  p: { date?: string; payment_date?: string; collected_at?: string } | null | undefined,
  registrationAt?: Date | string | null,
): Date | null {
  const raw = p?.date || p?.payment_date || p?.collected_at;
  if (raw) {
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) return d;
  }
  if (registrationAt) {
    const d = registrationAt instanceof Date ? registrationAt : new Date(registrationAt);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

function paymentDetailsDateLabel(
  p: { date?: string; payment_date?: string; collected_at?: string } | null | undefined,
  registrationAt?: Date | string | null,
): string {
  const d = paymentTimestamp(p, registrationAt);
  return d ? format(d, "dd MMM yyyy hh:mm a") : "—";
}

function refundModeLabel(mode?: string | null): string {
  const m = String(mode || "").trim();
  if (!m) return "Refund";
  if (/^refund\b/i.test(m)) return m;
  return `Refund (${m})`;
}

function paymentStatusBadge(data: any): { label: string; tone: "paid" | "partial" | "due" | "cancelled" } {
  if (data?.bill_cancelled) return { label: "CANCELLED", tone: "cancelled" };
  const due = Number(data?.due_amount || 0);
  const paid = Number(data?.paid_amount || 0);
  if (due > 0 && paid > 0) return { label: "PARTIALLY PAID", tone: "partial" };
  if (due > 0) return { label: "DUE", tone: "due" };
  if (paid > 0) return { label: "PAID", tone: "paid" };
  return { label: "DUE", tone: "due" };
}


function isInvoicePackageLine(t: any, packageTestsById: Map<string, string[]>): boolean {
  if (String(t?.item_type || "").toLowerCase() === "package") return true;
  const id = String(t?.test_id || "");
  if (id && packageTestsById.has(id)) return true;
  const nameKey = String(t?.test_name || "").trim().toLowerCase().replace(/\s+/g, " ");
  return !!(nameKey && packageTestsById.has(nameKey));
}

/** Packages first (higher value first), then individual tests by descending price. */
function sortInvoiceLines(lines: any[], packageTestsById: Map<string, string[]>): any[] {
  return [...lines].sort((a, b) => {
    const aPkg = isInvoicePackageLine(a, packageTestsById) ? 0 : 1;
    const bPkg = isInvoicePackageLine(b, packageTestsById) ? 0 : 1;
    if (aPkg !== bPkg) return aPkg - bPkg;
    return invoiceLineAmount(b) - invoiceLineAmount(a);
  });
}


/** Logo-matched palette (PH PathLabs: royal blue + medical red). */
const PALETTE = {
  blue: "#2E3192",
  blueDark: "#23266F",
  blueSoft: "#F0F1FA",
  blueLine: "#D8DBF0",
  red: "#E41E26",
  orange: "#F7941D",
  ink: "#111827",
  muted: "#6B7280",
  line: "#E5E7EB",
  soft: "#F8FAFC",
  white: "#FFFFFF",
  discount: "#059669",
};

/**
 * Fonts that include U+20B9 (₹). Prefer Noto Sans first — Google Fonts unicode-range
 * subsets for IBM Plex sometimes load late, which caused intermittent □ boxes.
 * Never fall back to Arial (no rupee glyph).
 */
const INVOICE_FONT =
  '"Noto Sans", "IBM Plex Sans", "Segoe UI", system-ui, sans-serif';

const INVOICE_FONT_CSS_HREF =
  "https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=Noto+Sans:wght@400;500;600;700&display=swap";

/** Force-download the unicode-range file that contains ₹ (lazy-loaded otherwise). */
async function ensureInvoiceFontsReady(): Promise<void> {
  if (typeof document === "undefined" || !document.fonts) return;
  try {
    // Ensure stylesheet is present (print window / early open).
    if (!document.querySelector(`link[data-invoice-fonts="1"]`)) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = INVOICE_FONT_CSS_HREF;
      link.setAttribute("data-invoice-fonts", "1");
      document.head.appendChild(link);
    }
    await document.fonts.ready;
    const specs = [
      '400 12px "Noto Sans"',
      '500 12px "Noto Sans"',
      '600 12px "Noto Sans"',
      '700 12px "Noto Sans"',
      '400 12px "IBM Plex Sans"',
      '700 12px "IBM Plex Sans"',
    ];
    // Second arg "₹" is critical — triggers the subset that actually has U+20B9.
    await Promise.all(specs.map((spec) => document.fonts.load(spec, "₹").catch(() => undefined)));
    for (let i = 0; i < 40; i++) {
      if (
        document.fonts.check('400 12px "Noto Sans"', "₹") ||
        document.fonts.check('400 12px "IBM Plex Sans"', "₹")
      ) {
        return;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
  } catch {
    // non-fatal
  }
}


async function waitForHtmlImage(img: HTMLImageElement, timeoutMs = 12000): Promise<void> {
  if (img.complete && img.naturalWidth > 0) return;
  const waitLoad = new Promise<void>((resolve) => {
    const done = () => resolve();
    img.addEventListener("load", done, { once: true });
    img.addEventListener("error", done, { once: true });
  });
  const decode = typeof img.decode === "function"
    ? img.decode().then(() => undefined).catch(() => undefined)
    : Promise.resolve();
  await Promise.race([
    Promise.all([waitLoad, decode]).then(() => undefined),
    new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
}


async function waitForImagesIn(root: HTMLElement, timeoutMs = 12000): Promise<void> {
  const imgs = Array.from(root.querySelectorAll("img"));
  if (imgs.length === 0) return;
  await Promise.race([
    Promise.all(imgs.map((img) => waitForHtmlImage(img, timeoutMs))),
    new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
}

// Warm ₹ glyph as soon as this module loads (registration / invoice paths).
if (typeof window !== "undefined") {
  void ensureInvoiceFontsReady();
}

function escapeInvoiceHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function textStyle(brand: Record<string, string>, prefix: string, fallbackSize: string, fallbackColor: string) {
  const size = Number(brand[`${prefix}_size`] || fallbackSize);
  const bold = brand[`${prefix}_bold`] !== "false";
  const color = brand[`${prefix}_color`] || fallbackColor;
  return {
    fontSize: size,
    fontWeight: bold ? ("bold" as const) : ("normal" as const),
    color,
  };
}

function textStyleCss(brand: Record<string, string>, prefix: string, fallbackSize: string, fallbackColor: string) {
  const s = textStyle(brand, prefix, fallbackSize, fallbackColor);
  return `font-size:${s.fontSize}px;font-weight:${s.fontWeight};color:${s.color}`;
}

const formatVisitType = (vt: string | undefined) => {
  if (!vt) return "";
  const map: Record<string, string> = {
    home_visit: "Home Visit",
    lab_visit: "Lab",
    pickup_point: "Pickup Point",
  };
  return map[vt] || vt.replace(/_/g, " ");
};

const numberToWords = (num: number): string => {
  if (num === 0) return "Zero";
  const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
    "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  const convert = (n: number): string => {
    if (n < 20) return ones[n];
    if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? " " + ones[n % 10] : "");
    if (n < 1000) return ones[Math.floor(n / 100)] + " Hundred" + (n % 100 ? " " + convert(n % 100) : "");
    if (n < 100000) return convert(Math.floor(n / 1000)) + " Thousand" + (n % 1000 ? " " + convert(n % 1000) : "");
    if (n < 10000000) return convert(Math.floor(n / 100000)) + " Lakh" + (n % 100000 ? " " + convert(n % 100000) : "");
    return convert(Math.floor(n / 10000000)) + " Crore" + (n % 10000000 ? " " + convert(n % 10000000) : "");
  };
  return convert(Math.floor(Math.abs(num)));
};

const InvoicePreviewLegacy = ({
  data,
  open,
  onClose,
  autoQueueWhatsApp = false,
  hidePrint = false,
  queueRequest = null,
  onReady,
  onQueueSettled,
  statusHint,
}: InvoicePreviewProps) => {
  const receiptRef = useRef<HTMLDivElement>(null);
  const barcodeRef = useRef<HTMLCanvasElement>(null);
  const queuedInvoiceRef = useRef<string | null>(null);
  const autoQueuedRef = useRef<string | null>(null);
  const [brand, setBrand] = useState<Record<string, string>>(INVOICE_BRAND_DEFAULTS);
  const [logoSrc, setLogoSrc] = useState("");
  const [channelName, setChannelName] = useState("");
  const [consoleQueued, setConsoleQueued] = useState(false);
  const [waSending, setWaSending] = useState(false);
  const [packageTestsById, setPackageTestsById] = useState<Map<string, string[]>>(new Map());
  const [packageNamesReady, setPackageNamesReady] = useState(false);
  const [fontsReady, setFontsReady] = useState(false);
  /** Brand settings + logo bytes ready — must be true before WhatsApp capture. */
  const [brandReady, setBrandReady] = useState(false);

  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  useEffect(() => {
    if (!open) {
      setConsoleQueued(false);
      setWaSending(false);
      setPackageNamesReady(false);
      setFontsReady(false);
      setBrandReady(false);
      setLogoSrc("");
      return;
    }
    const invoiceNo = String(data?.invoice_number || "").trim();
    setConsoleQueued(queuedInvoiceRef.current === invoiceNo);
    setPackageNamesReady(false);
    setFontsReady(false);
    setBrandReady(false);
    setLogoSrc("");
    let cancelled = false;
    let fontsOk = false;
    let packagesOk = false;
    let brandOk = false;
    const maybeReady = () => {
      // Do not signal ready until logo/address brand settings are loaded and logo preloaded.
      if (cancelled || !fontsOk || !packagesOk || !brandOk || !invoiceNo) return;
      onReadyRef.current?.(invoiceNo);
    };
    void ensureInvoiceFontsReady().then(() => {
      if (cancelled) return;
      fontsOk = true;
      setFontsReady(true);
      maybeReady();
    });
    (async () => {
      const lines = Array.isArray(data?.tests) ? data.tests : [];
      const packagePromise = (async () => {
        try {
          const map = await fetchPackageIncludedTestNamesFromLines(lines);
          if (!cancelled) setPackageTestsById(map);
        } catch {
          if (!cancelled) setPackageTestsById(new Map());
        }
      })();
      const brandPromise = (async () => {
        // Session memory + IndexedDB: settings/logo fetched once, not per invoice.
        const bundle = await getInvoiceBrandCached();
        if (cancelled) return bundle;
        setBrand(bundle.brand);
        setLogoSrc(bundle.logoSrc || bundle.brand.invoice_logo_url || "");
        return bundle;
      })();
      await packagePromise;
      if (cancelled) return;
      packagesOk = true;
      setPackageNamesReady(true);
      await brandPromise;
      if (cancelled) return;
      brandOk = true;
      setBrandReady(true);
      maybeReady();
    })();
    return () => { cancelled = true; };
  }, [open, data?.invoice_number]);


  useEffect(() => {
    if (!open || !data?.channel_id) { setChannelName(""); return; }
    (async () => {
      const { data: ch } = await supabase.from("channels").select("name").eq("id", data.channel_id).maybeSingle();
      setChannelName(ch?.name || "");
    })();
  }, [open, data?.channel_id]);

  const renderBarcode = useCallback(() => {
    if (!barcodeRef.current || !data?.umr_number) return false;
    try {
      JsBarcode(barcodeRef.current, data.umr_number, {
        format: "CODE128",
        height: 22,
        width: 1.2,
        displayValue: false,
        margin: 0,
        background: "#ffffff",
        lineColor: "#000000",
      });
      return true;
    } catch {
      return false;
    }
  }, [data?.umr_number]);

  useEffect(() => {
    if (!open || !data?.umr_number || !fontsReady) return;
    const timer = setTimeout(() => {
      renderBarcode();
    }, 50);
    return () => clearTimeout(timer);
  }, [open, data?.umr_number, fontsReady, renderBarcode]);

  const isPickupInvoice = useCallback((row: any) => {
    if (!row) return false;
    if (row.visit_type === "pickup_point") return true;
    if (row.pickup_point_id) return true;
    return false;
  }, []);

  const queueInvoiceViaWaApi = useCallback(async () => {
    const invoiceNo = String(data?.invoice_number || "");
    const patientLabel = patientDisplayName(data) || data?.patient_name || "patient";
    const settle = (ok: boolean, error?: string) => {
      onQueueSettled?.({ ok, error, invoiceNumber: invoiceNo });
    };
    if (!open || !invoiceNo || !data?.mobile_number) {
      toast.error("Mobile number required to send on WhatsApp");
      settle(false, "mobile required");
      return;
    }
    if (isPickupInvoice(data)) {
      toast.error("Pickup point invoices are not sent on WhatsApp");
      settle(false, "pickup");
      return;
    }
    if (!receiptRef.current) {
      toast.error("Invoice not ready yet");
      settle(false, "not ready");
      return;
    }
    if (!brandReady) {
      toast.error("Invoice header still loading — try again in a moment");
      settle(false, "brand not ready");
      return;
    }
    setWaSending(true);
    const host = document.createElement("div");
    try {
      // Capture the exact on-screen receipt (html-to-image / SVG foreignObject).
      // html2canvas was thickening the red rule and altering the patient box.
      renderBarcode();
      await new Promise((r) => setTimeout(r, 80));

      const source = receiptRef.current;
      const clone = source.cloneNode(true) as HTMLElement;
      clone.style.margin = "0";
      clone.style.borderRadius = "0";
      clone.style.boxShadow = "none";
      clone.style.width = "560px";
      clone.style.maxWidth = "560px";
      clone.style.background = "#ffffff";
      clone.style.color = "#111827";
      clone.style.fontFamily = INVOICE_FONT;

      // Canvas pixels do not clone — swap barcode for a PNG <img>.
      const srcCanvas = barcodeRef.current;
      const cloneCanvas = clone.querySelector("canvas");
      if (srcCanvas && cloneCanvas && srcCanvas.width > 0) {
        const img = document.createElement("img");
        img.src = srcCanvas.toDataURL("image/png");
        img.alt = "";
        img.style.cssText =
          cloneCanvas.getAttribute("style") ||
          "display:inline-block;max-width:100%;height:20px;vertical-align:middle";
        cloneCanvas.replaceWith(img);
      } else if (cloneCanvas) {
        cloneCanvas.remove();
      }

      host.setAttribute("data-invoice-wa-capture", "1");
      host.style.cssText =
        "position:fixed;left:-10000px;top:0;width:560px;background:#ffffff;z-index:-1;pointer-events:none;";
      host.appendChild(clone);
      document.body.appendChild(host);

      // Wait on-screen receipt + offscreen clone so logo/address paint before rasterize.
      if (source) await waitForImagesIn(source);
      await waitForImagesIn(clone);
      // One paint frame after images decode.
      await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));

      await ensureInvoiceFontsReady();
      let fontEmbedCSS = "";
      try {
        fontEmbedCSS = await getFontEmbedCSS(clone);
      } catch {
        fontEmbedCSS = "";
      }

      const width = 560;
      const height = Math.max(clone.scrollHeight, clone.offsetHeight, 1);
      let dataUrl = "";
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          dataUrl = await toJpeg(clone, {
            quality: 0.95,
            pixelRatio: 2,
            // cacheBust re-fetches logo with ?t= and races the capture → blank logo.
            cacheBust: false,
            backgroundColor: "#ffffff",
            width,
            height,
            fontEmbedCSS: fontEmbedCSS || undefined,
            style: {
              transform: "none",
              transformOrigin: "top left",
              margin: "0",
              width: `${width}px`,
              fontFamily: INVOICE_FONT,
            },
          });
          if (dataUrl && dataUrl.length > 5000) break;
        } catch {
          // retry — html-to-image can intermittently return blank
        }
        await new Promise((r) => setTimeout(r, 200));
      }
      if (!dataUrl) {
        toast.error("Could not generate invoice image for WhatsApp");
        settle(false, "image");
        return;
      }
      const blob = await (await fetch(dataUrl)).blob();
      if (!blob || blob.size < 1000) {
        toast.error("Could not generate invoice image for WhatsApp");
        settle(false, "blob");
        return;
      }

      const lab = brand.invoice_lab_name || "PH PathLabs";
      const caption =
        `📋 *${lab} — Invoice*\n` +
        `Invoice No: ${invoiceNo}\n` +
        `Patient: ${patientLabel}\n` +
        `Amount: ₹${data.final_amount}`;
      const res = await enqueueInvoiceForWhatsAppConsole({
        phone: data.mobile_number,
        patient_name: data.patient_name,
        registration_id: data.id || null,
        invoice_number: invoiceNo,
        caption,
        blob,
      });
      if (!res.ok) {
        toast.error(res.error || "Failed to queue invoice for WA API");
        settle(false, res.error || "queue");
        return;
      }
      queuedInvoiceRef.current = invoiceNo;
      setConsoleQueued(true);
      logMessageSend(data.mobile_number, data.patient_name, "Invoice", data.umr_number);
      toast.success(`Sending invoice to ${patientLabel}`, {
        description: `${invoiceNo} · ${String(data.mobile_number).replace(/\D/g, "").slice(-10)}`,
      });
      settle(true);
    } catch (e: any) {
      toast.error(e?.message || "WhatsApp WA API queue failed");
      settle(false, e?.message || "exception");
    } finally {
      host.remove();
      setWaSending(false);
    }
  }, [open, data, brand, brandReady, renderBarcode, isPickupInvoice, onQueueSettled]);

  // Parent-driven sequential queue (home-visit multi-patient). Bound to invoice #.
  const lastQueueNonce = useRef(0);
  useEffect(() => {
    const invoiceNo = String(data?.invoice_number || "").trim();
    const ready = open && packageNamesReady && fontsReady && brandReady;
    if (
      !shouldFireBoundInvoiceQueue({
        token: queueRequest,
        lastNonce: lastQueueNonce.current,
        currentInvoiceNumber: invoiceNo,
        ready,
      })
    ) {
      return;
    }
    lastQueueNonce.current = Number(queueRequest?.nonce || 0);
    void queueInvoiceViaWaApi();
  }, [queueRequest, open, data?.invoice_number, packageNamesReady, fontsReady, brandReady, queueInvoiceViaWaApi]);

  // New registration: queue invoice to durable outbox once barcode/layout is ready.
  useEffect(() => {
    if (!autoQueueWhatsApp || !open || !data?.invoice_number || !data?.mobile_number) return;
    if (!packageNamesReady || !fontsReady || !brandReady) return;
    if (isPickupInvoice(data)) return;
    const invoiceNo = String(data.invoice_number);
    if (autoQueuedRef.current === invoiceNo || queuedInvoiceRef.current === invoiceNo) return;
    const timer = setTimeout(() => {
      if (autoQueuedRef.current === invoiceNo || queuedInvoiceRef.current === invoiceNo) return;
      autoQueuedRef.current = invoiceNo;
      void queueInvoiceViaWaApi();
    }, 900);
    return () => clearTimeout(timer);
  }, [autoQueueWhatsApp, open, data, data?.invoice_number, data?.mobile_number, queueInvoiceViaWaApi, isPickupInvoice, packageNamesReady, fontsReady, brandReady]);

  if (!data) return null;

  const allTests = data.tests || [];
  const cancelledTests = Array.isArray(data.cancelled_tests) ? data.cancelled_tests : [];
  const cancelledTestIds = new Set(cancelledTests.map((ct: any) => ct.test_id));
  const tests = sortInvoiceLines(
    allTests.filter((t: any) => !cancelledTestIds.has(t.test_id)),
    packageTestsById,
  );
  const createdAt = data.created_at ? new Date(data.created_at) : new Date();
  const payments = Array.isArray(data.payments) ? data.payments : [];

  const activeGross = tests.reduce((sum: number, t: any) => sum + Number(t.price || 0), 0);
  const activeNet = tests.reduce((sum: number, t: any) => sum + invoiceLineNet(t), 0);
  const activeDiscount = activeGross - activeNet;
  const activeFinal = activeNet + Number(data.home_visit_charges || 0);

  const hvcRefund = computeHvcRefundAmount(data);

  const labVisible = brand.invoice_lab_name_visible !== "false";
  const hasAnyDiscount = tests.some((t: any) => Number(t.discount || 0) > 0);
  const showGross = activeGross !== activeFinal;

  const visitLabel = formatVisitType(data.visit_type) + (channelName ? ` (${channelName})` : "");

  const includedTestsLine = (t: any) =>
    formatPackageIncludedTests(
      packageTestsById.get(String(t?.test_id || ""))
      || packageTestsById.get(String(t?.test_name || "").trim().toLowerCase().replace(/\s+/g, " ")),
    );

  const handlePrint = () => {
    renderBarcode();
    const barcodePng = barcodeRef.current?.toDataURL?.("image/png") || "";
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;

    // Always one page — content auto-scales in the print window.
    const pages: any[][] = [tests];
    const totalPages = 1;

    const headerHtml = () => {
      // No top blue line; solid red rule (not CSS border) under brand block.
      let h = `<div style="padding:20px 0 4px;margin:0">`;
      const printLogo = logoSrc || brand.invoice_logo_url;
      if (printLogo) {
        h += `<div style="text-align:${brand.invoice_logo_align};line-height:0"><img src="${printLogo}" style="max-height:40px;display:inline-block" /></div>`;
      }
      if (labVisible) {
        h += `<h2 style="margin:2px 0 0;${textStyleCss(brand, "invoice_lab_name", "15", PALETTE.blue)};text-align:${brand.invoice_lab_name_align};letter-spacing:-0.02em;line-height:1.15">${brand.invoice_lab_name}</h2>`;
      }
      if (brand.invoice_contact) {
        h += `<p style="margin:1px 0 0;${textStyleCss(brand, "invoice_contact", "9", PALETTE.muted)};text-align:${brand.invoice_lab_name_align};line-height:1.2">${brand.invoice_contact}</p>`;
      }
      if (brand.invoice_address) {
        h += `<p style="margin:0;${textStyleCss(brand, "invoice_address", "8", PALETTE.muted)};white-space:pre-line;text-align:${brand.invoice_address_align};line-height:1.2">${brand.invoice_address}</p>`;
      }
      h += `</div><div style="height:2px;background:${PALETTE.red};width:100%;margin:0 0 6px;padding:0;border:0"></div>`;
      return h;
    };

    const demographicsHtml = () => {
      const tag = brand.invoice_tagline || "Receipt Memo";
      // Left: memo + invoice# · Center: barcode · Right: visit + UMR
      let d = `<table style="width:100%;border-collapse:collapse;table-layout:fixed;margin:0 0 4px"><tr>`;
      d += `<td style="border:none;vertical-align:middle;text-align:left;padding:0;width:38%">`;
      d += `<div style="font-size:8px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:${PALETTE.blue};line-height:1">${tag}</div>`;
      d += `<div style="font-size:15px;font-weight:800;color:${PALETTE.ink};letter-spacing:-0.02em;line-height:1.15">#${data.invoice_number}</div>`;
      d += `<div style="font-size:9px;font-weight:500;color:${PALETTE.muted};line-height:1.2">${format(createdAt, "dd MMM yyyy · hh:mm a")}</div>`;
      d += `</td>`;
      d += `<td style="border:none;vertical-align:middle;text-align:center;padding:0 6px;width:24%">`;
      if (barcodePng) {
        d += `<img src="${barcodePng}" alt="barcode" style="height:20px;max-width:100%;display:inline-block;vertical-align:middle" />`;
      }
      d += `</td>`;
      d += `<td style="border:none;vertical-align:middle;text-align:right;padding:0;width:38%;white-space:nowrap">`;
      d += `<div style="display:inline-block;color:${PALETTE.blue};font-weight:700;font-size:8px;letter-spacing:0.05em;text-transform:uppercase;padding:0">${visitLabel || "Visit"}</div>`;
      if (data.umr_number) d += `<div style="margin-top:2px;font-size:9px;font-weight:700;color:${PALETTE.ink}">${data.umr_number}</div>`;
      d += `</td></tr></table>`;

      // Compact patient block — no fill on print (ink-saving, like report PDFs)
      d += `<div style="border:1px solid ${PALETTE.line};border-radius:6px;padding:4px 8px;margin:0 0 6px">`;
      d += `<table style="width:100%;border-collapse:collapse;font-size:10px;line-height:1.25">`;
      d += `<tr>`;
      d += `<td style="border:none;padding:1px 6px 1px 0;width:50%;vertical-align:top"><span style="color:${PALETTE.muted};font-size:8px">Name</span> <strong style="color:${PALETTE.ink}">${patientDisplayName(data)}</strong></td>`;
      d += `<td style="border:none;padding:1px 0;width:50%;vertical-align:top"><span style="color:${PALETTE.muted};font-size:8px">Mobile</span> <strong style="color:${PALETTE.ink}">${data.mobile_number || "—"}</strong></td>`;
      d += `</tr>`;
      if (data.gender || ageDisplay || data.doctor_name) {
        d += `<tr>`;
        d += `<td style="border:none;padding:1px 6px 1px 0;vertical-align:top"><span style="color:${PALETTE.muted};font-size:8px">Age / Gender</span> <strong style="color:${PALETTE.ink}">${[ageDisplay, data.gender].filter(Boolean).join(" · ") || "—"}</strong></td>`;
        d += `<td style="border:none;padding:1px 0;vertical-align:top"><span style="color:${PALETTE.muted};font-size:8px">Doctor</span> <strong style="color:${PALETTE.ink}">${data.doctor_name || "—"}</strong></td>`;
        d += `</tr>`;
      }
      d += `</table></div>`;
      return d;
    };

    const tableHeaderHtml = () => {
      // Auto layout + generous side padding so Price/Disc/Net do not collapse together.
      const th = `padding:5px 6px;font-size:10px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;color:${PALETTE.blue};border-bottom:2px solid ${PALETTE.blue};background:transparent`;
      const moneyTh = `${th};text-align:right;width:1%;white-space:nowrap;padding-left:14px;padding-right:14px;min-width:4.75em`;
      let h = `<tr>`;
      h += `<th style="${th};width:1%;white-space:nowrap;text-align:center;padding-left:4px;padding-right:4px">#</th>`;
      h += `<th style="${th};text-align:left;padding-left:4px">Test / Investigation</th>`;
      if (hasAnyDiscount) {
        h += `<th style="${moneyTh}">Price</th>`;
        h += `<th style="${moneyTh}">Disc</th>`;
        h += `<th style="${moneyTh}">Net</th>`;
      } else {
        h += `<th style="${moneyTh}">Amount</th>`;
      }
      h += `</tr>`;
      return h;
    };

    const testRowHtml = (t: any, globalIndex: number) => {
      const td = `padding:5px 6px;font-size:12px;color:${PALETTE.ink};border-bottom:1px solid ${PALETTE.line};line-height:1.25;vertical-align:top`;
      const moneyTd = `${td};text-align:right;white-space:nowrap;width:1%;padding-left:14px;padding-right:14px;min-width:4.75em`;
      const name = String(t.test_name || "");
      const nameSize = name.length > 42 ? 10 : name.length > 28 ? 11 : 12;
      const included = includedTestsLine(t);
      let r = `<tr>`;
      r += `<td style="${td};text-align:center;width:1%;white-space:nowrap;color:${PALETTE.muted};padding-left:4px;padding-right:4px">${globalIndex + 1}</td>`;
      r += `<td style="${td};font-weight:600;font-size:${nameSize}px;padding-left:4px;word-break:break-word;overflow-wrap:anywhere;white-space:normal">${escapeInvoiceHtml(name)}`;
      if (included) {
        r += `<div style="font-size:9px;font-style:italic;font-weight:400;color:${PALETTE.muted};line-height:1.3;margin-top:2px;word-break:break-word;overflow-wrap:anywhere">${escapeInvoiceHtml(included)}</div>`;
      }
      r += `</td>`;
      if (hasAnyDiscount) {
        r += `<td style="${moneyTd}">₹${t.price}</td>`;
        r += `<td style="${moneyTd};color:${PALETTE.discount}">${Number(t.discount || 0) > 0 ? `-₹${t.discount}` : "—"}</td>`;
        r += `<td style="${moneyTd};font-weight:700">₹${invoiceLineNet(t)}</td>`;
      } else {
        r += `<td style="${moneyTd};font-weight:700">₹${t.price}</td>`;
      }
      r += `</tr>`;
      return r;
    };

    const totalsRowHtml = (pageTests: any[], isGrandTotal: boolean) => {
      const priceTotal = pageTests.reduce((sum: number, t: any) => sum + invoiceLineAmount(t), 0);
      const discTotal = pageTests.reduce((sum: number, t: any) => sum + invoiceLineDiscount(t), 0);
      const netTotal = pageTests.reduce((sum: number, t: any) => sum + invoiceLineNet(t), 0);
      const label = isGrandTotal ? "Total" : "Subtotal";
      const td = `padding:6px 6px;font-size:13px;font-weight:800;color:${PALETTE.ink};border-top:2px solid ${PALETTE.blue};border-bottom:1px solid ${PALETTE.line};line-height:1.25;vertical-align:middle`;
      const moneyTd = `${td};text-align:right;white-space:nowrap;padding-left:14px;padding-right:14px;min-width:4.75em`;
      let r = `<tr>`;
      r += `<td style="${td};padding-left:4px" colspan="2">${label}</td>`;
      if (hasAnyDiscount) {
        r += `<td style="${moneyTd}">₹${priceTotal}</td>`;
        r += `<td style="${moneyTd};color:${PALETTE.discount}">${discTotal > 0 ? `-₹${discTotal}` : "—"}</td>`;
        r += `<td style="${moneyTd}">₹${netTotal}</td>`;
      } else {
        r += `<td style="${moneyTd}">₹${priceTotal}</td>`;
      }
      r += `</tr>`;
      return r;
    };

    let pagesHtml = '';
    let globalTestIndex = 0;

    pages.forEach((pageTests, pageIdx) => {
      const isLast = pageIdx === totalPages - 1;
      const pageBreak = isLast ? '' : 'page-break-after:always;';

      let tableRows = '';
      pageTests.forEach((t: any) => {
        tableRows += testRowHtml(t, globalTestIndex);
        globalTestIndex++;
      });
      if (pageTests.length > 0) {
        tableRows += totalsRowHtml(pageTests, isLast);
      }

      // Payment summary (left) + Payment Details table (right).
      let summaryHtml = '';
      if (isLast) {
        const status = paymentStatusBadge(data);
        const statusFg = status.tone === "paid" || status.tone === "partial" ? PALETTE.discount : PALETTE.red;
        const dueAmt = Number(data.due_amount || 0);
        const paidAmt = Number(data.paid_amount || 0);

        const sumRow = (label: string, amount: string, opts?: { color?: string; weight?: string; size?: string; amountSize?: string }) => {
          const color = opts?.color || PALETTE.blue;
          const weight = opts?.weight || "500";
          const size = opts?.size || "10px";
          const amountSize = opts?.amountSize || size;
          return `<tr>
            <td style="padding:3px 0;font-size:${size};font-weight:${weight};color:${color};text-align:left;border:0;white-space:nowrap;line-height:1.35">${label}</td>
            <td style="padding:3px 0;padding-left:16px;font-size:${amountSize};font-weight:${weight};color:${color};text-align:right;border:0;white-space:nowrap;line-height:1.35">${amount}</td>
          </tr>`;
        };

        let leftInner = `<table style="width:100%;border-collapse:collapse">`;
        if (showGross) {
          leftInner += sumRow("Gross Amount", `₹${activeGross}`, { color: PALETTE.blue, weight: "500", size: "10px" });
          if (activeDiscount > 0) {
            leftInner += sumRow("Total Discount", `– ₹${activeDiscount}`, { color: PALETTE.discount, weight: "600", size: "10px" });
          }
          if (Number(data.home_visit_charges || 0) > 0) {
            leftInner += sumRow("Home Visit Charges", `+ ₹${data.home_visit_charges}`, { color: PALETTE.blue, weight: "500", size: "10px" });
          }
        }
        leftInner += `<tr><td colspan="2" style="padding-top:6px;border:0"></td></tr>`;
        leftInner += sumRow("Net Payable", `₹${activeFinal}`, { color: PALETTE.blueDark, weight: "800", size: "12px", amountSize: "13px" });
        leftInner += `</table>`;

        leftInner += `<div style="margin-top:8px;background:#E8ECF8;border-radius:8px;padding:8px 10px">`;
        leftInner += `<table style="width:100%;border-collapse:collapse">`;
        leftInner += sumRow("Paid Amount", `₹${paidAmt}`, { color: PALETTE.blue, weight: "600", size: "10px" });
        if (dueAmt > 0) {
          leftInner += `<tr><td colspan="2" style="padding:4px 0;border:0"><div style="height:1px;background:${PALETTE.blueLine}"></div></td></tr>`;
          leftInner += sumRow("Balance Due", `₹${dueAmt}`, { color: PALETTE.red, weight: "700", size: "10px" });
        }
        leftInner += `</table>`;
        leftInner += `<div style="margin-top:8px;display:inline-flex;align-items:center;gap:6px;background:${PALETTE.white};border:1px solid ${PALETTE.blueLine};border-radius:8px;padding:5px 8px">`;
        leftInner += `<span style="display:inline-block;width:14px;height:14px;border-radius:999px;background:${statusFg};color:#fff;font-size:9px;line-height:14px;text-align:center;font-weight:800">✓</span>`;
        leftInner += `<div style="line-height:1.15"><div style="font-size:9px;font-weight:800;color:${statusFg};letter-spacing:0.04em">${status.label}</div>`;
        if (dueAmt > 0 && status.tone !== "cancelled") {
          leftInner += `<div style="font-size:10px;font-weight:800;color:${statusFg}">₹${dueAmt} DUE</div>`;
        }
        leftInner += `</div></div></div>`;

        const leftHtml = `
          <div style="background:${PALETTE.blueSoft};border:1px solid ${PALETTE.blueLine};border-radius:10px;padding:10px 12px;min-width:200px;max-width:260px">
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px">
              <span style="font-size:11px;font-weight:800;color:${PALETTE.blue}">Payment Summary</span>
            </div>
            ${leftInner}
          </div>`;


        const th = (label: string, align = "left") =>
          `<th style="padding:4px 6px;font-size:8px;font-weight:700;letter-spacing:0.03em;text-transform:uppercase;color:${PALETTE.blue};background:${PALETTE.blueSoft};border-bottom:1px solid ${PALETTE.blueLine};text-align:${align};white-space:nowrap">${label}</th>`;
        const td = (val: string, align = "left", color = PALETTE.ink, weight = "500") =>
          `<td style="padding:4px 6px;font-size:9px;font-weight:${weight};color:${color};border-bottom:1px solid ${PALETTE.line};text-align:${align};white-space:nowrap;line-height:1.25">${val}</td>`;

        let payRows = "";
        if (payments.length === 0 && !(Number(data.refund_amount || 0) > 0)) {
          payRows = `<tr><td colspan="3" style="padding:6px;font-size:9px;color:${PALETTE.muted};text-align:left;border-bottom:1px solid ${PALETTE.line}">No payments</td></tr>`;
        } else {
          payments.forEach((pay: any) => {
            payRows += `<tr>${td(paymentDetailsDateLabel(pay, createdAt))}${td(pay.mode || "Payment")}${td(`₹${pay.amount}`, "right", PALETTE.ink, "700")}</tr>`;
          });
          if (Number(data.refund_amount || 0) > 0) {
            const refundDate = data.refund_date
              ? format(new Date(data.refund_date), "dd MMM yyyy hh:mm a")
              : "—";
            payRows += `<tr>${td(refundDate)}${td(refundModeLabel(data.refund_mode))}${td(`-₹${data.refund_amount}`, "right", PALETTE.orange, "700")}</tr>`;
          }
        }
        const rightHtml = `
          <div style="border:1px solid ${PALETTE.blueLine};border-radius:8px;overflow:hidden;background:${PALETTE.white};min-width:220px">
            <div style="display:flex;align-items:center;gap:5px;padding:5px 8px;background:${PALETTE.blueSoft};border-bottom:1px solid ${PALETTE.blueLine}">
              <span style="font-size:10px;font-weight:800;color:${PALETTE.blue}">Payment Details</span>
            </div>
            <table style="width:100%;border-collapse:collapse">
              <thead><tr>${th("Date")}${th("Mode")}${th("Amount", "right")}</tr></thead>
              <tbody>${payRows}</tbody>
              <tfoot>
                <tr>
                  <td colspan="2" style="padding:5px 6px;font-size:9px;font-weight:800;color:${PALETTE.blue};background:${PALETTE.blueSoft};border-top:1px solid ${PALETTE.blueLine}">Total Paid</td>
                  <td style="padding:5px 6px;font-size:10px;font-weight:800;color:${PALETTE.blue};background:${PALETTE.blueSoft};border-top:1px solid ${PALETTE.blueLine};text-align:right">₹${data.paid_amount || 0}</td>
                </tr>
              </tfoot>
            </table>
          </div>`;

        summaryHtml = `<div style="margin-top:14px;padding:0;text-align:left">`;
        summaryHtml += `<div style="display:flex;gap:14px;align-items:flex-start;justify-content:space-between;flex-wrap:wrap">`;
        summaryHtml += `<div style="flex:0 0 auto">${leftHtml}</div>`;
        summaryHtml += `<div style="flex:1 1 220px;max-width:320px">${rightHtml}</div>`;
        summaryHtml += `</div>`;
        if (Number(data.paid_amount || 0) > 0) {
          summaryHtml += `<div style="font-size:10px;margin-top:6px;color:${PALETTE.muted};line-height:1.25;text-align:left">Received with thanks from <strong style="color:${PALETTE.ink}">${patientDisplayName(data)}</strong> a sum of Rs. ${Number(data.paid_amount).toFixed(2)}/- (${numberToWords(Number(data.paid_amount))} Rupees)</div>`;
        }
        if (cancelledTests.length > 0) {
          summaryHtml += `<div style="font-size:9px;color:${PALETTE.muted};margin-top:1px;text-align:left">Cancelled Tests: ${cancelledTests.map((ct: any) => ct.test_name || ct.test_id).join(", ")}</div>`;
        }
        if (hvcRefund > 0) {
          summaryHtml += `<div style="font-size:9px;color:${PALETTE.muted};margin-top:1px;text-align:left">Home Visit Charges Refunded: ₹${hvcRefund}</div>`;
        }
        summaryHtml += `</div>`;

        summaryHtml += `<div style="text-align:center;font-size:10px;color:${PALETTE.muted};margin-top:4px;line-height:1.3">`;
        summaryHtml += `<p style="margin:0;font-weight:700;color:${PALETTE.blue}">Thank you for choosing PH PathLabs</p>`;
        summaryHtml += `<p style="margin:2px 0 0;font-size:9px;color:${PALETTE.muted}">This is an electronically generated receipt and does not require a signature</p>`;
        summaryHtml += `</div>`;
      }

      const printNow = format(new Date(), "dd-MM-yyyy hh:mm a");
      const preparedDate = format(createdAt, "dd-MM-yyyy hh:mm a");
      const currentUser = getCurrentUserName() || "—";
      const preparedPrintedFooter = `<table style="width:100%;border-collapse:collapse;margin-top:4px;border-top:1px solid ${PALETTE.line}">
        <tr>
          <td style="padding-top:3px;font-size:9px;color:${PALETTE.muted};text-align:left;border:0;line-height:1.25">Prepared by ${data.registered_by || "—"} · ${preparedDate}</td>
          <td style="padding-top:3px;font-size:9px;color:${PALETTE.muted};text-align:right;border:0;line-height:1.25">Printed by ${currentUser} · ${printNow}</td>
        </tr>
      </table>`;

      pagesHtml += `<div id="invoice-page"><div id="invoice-sheet">`;
      pagesHtml += headerHtml();
      pagesHtml += demographicsHtml();
      if (pageTests.length > 0) {
        pagesHtml += `<table style="width:100%;border-collapse:collapse;margin:0"><thead>${tableHeaderHtml()}</thead><tbody>${tableRows}</tbody></table>`;
      }
      pagesHtml += summaryHtml;
      pagesHtml += preparedPrintedFooter;
      pagesHtml += `</div></div>`;
    });

    printWindow.document.write(`
      <html><head><title>Invoice ${data.invoice_number}</title>
      <link rel="stylesheet" href="${INVOICE_FONT_CSS_HREF}" />
      <style>
        /* Side margins ≥12mm: preview can look fine at 5mm, but most printers clip
           the outer ~5–10mm (hardware non-printable area) on left/right. */
        @page { size: A5; margin: 8mm 12mm; }
        * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; box-sizing: border-box; }
        html, body { margin: 0; padding: 0; }
        body { font-family: ${INVOICE_FONT}; color: ${PALETTE.ink}; }
        /* A5 148×210mm − @page margins → 124×194mm. Clip so scale never creates page 2. */
        #invoice-page {
          width: 124mm;
          height: 194mm;
          overflow: hidden;
          margin: 0 auto;
          page-break-after: avoid;
          page-break-inside: avoid;
        }
        #invoice-sheet {
          width: 100%;
          transform-origin: top left;
          padding: 0 1mm;
        }
        table { width: 100%; border-collapse: collapse; }
        td, th { vertical-align: middle; }
      </style></head><body>
      ${pagesHtml}
      <script>
        (function () {
          // CBC-style fit: uniform scale from top-left, widen layout by 1/scale so
          // visual width stays full page (no horizontal squeeze) while height fits A5.
          function fit() {
            var page = document.getElementById("invoice-page");
            var sheet = document.getElementById("invoice-sheet");
            if (!page || !sheet) return;
            sheet.style.transform = "none";
            sheet.style.width = "100%";
            var maxH = page.clientHeight || Math.round((194 / 25.4) * 96);
            var h = sheet.scrollHeight;
            var scale = h > maxH ? Math.max(0.38, maxH / h) : 1;
            if (scale < 1) {
              sheet.style.transformOrigin = "top left";
              sheet.style.transform = "scale(" + scale + ")";
              sheet.style.width = (100 / scale) + "%";
            }
          }
          function whenReady(cb) {
            var imgs = Array.prototype.slice.call(document.images || []);
            var pending = imgs.filter(function (img) { return !(img.complete && img.naturalWidth > 0); }).length;
            var fontsReady = document.fonts && document.fonts.ready
              ? document.fonts.ready.catch(function () {})
              : Promise.resolve();
            function go() { fontsReady.then(function () { setTimeout(cb, 50); }); }
            if (!pending) { go(); return; }
            imgs.forEach(function (img) {
              if (img.complete) return;
              img.onload = img.onerror = function () {
                pending -= 1;
                if (pending <= 0) go();
              };
            });
            setTimeout(go, 8000);
          }
          whenReady(function () { fit(); setTimeout(function () { window.focus(); window.print(); }, 120); });
        })();
      <\/script></body></html>
    `);
    printWindow.document.close();
  };

  const age = formatPatientAge({ dob: data.dob, ageText: data.age_text });
  const ageDisplay = age === "—" ? "" : age;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Invoice Generated — {data.invoice_number}</DialogTitle>
        </DialogHeader>

        {(!fontsReady || !brandReady) ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {!fontsReady ? "Loading invoice fonts…" : "Loading invoice header…"}
          </div>
        ) : null}

        <div
          ref={receiptRef}
          className="bg-white text-black rounded"
          style={{
            fontFamily: INVOICE_FONT,
            width: 560,
            margin: "0 auto",
            padding: "10px 16px 12px",
            color: PALETTE.ink,
            // Keep in DOM for capture sizing, but hide until ₹ font subset is ready
            visibility: fontsReady && brandReady ? "visible" : "hidden",
            height: fontsReady && brandReady ? undefined : 0,
            overflow: fontsReady && brandReady ? undefined : "hidden",
          }}
        >
          {/* Brand header — solid red rule (not CSS border: html2canvas thickens borders) */}
          <div style={{ padding: "20px 0 4px" }}>
            {(logoSrc || brand.invoice_logo_url) && (
              <div style={{ textAlign: brand.invoice_logo_align as any, lineHeight: 0 }}>
                <img src={logoSrc || brand.invoice_logo_url} alt="Logo" loading="eager" decoding="sync" style={{ maxHeight: 44, display: "inline-block" }} />
              </div>
            )}
            {labVisible && (
              <h2 style={{ margin: "2px 0 0", textAlign: brand.invoice_lab_name_align as any, letterSpacing: "-0.02em", lineHeight: 1.15, ...textStyle(brand, "invoice_lab_name", "15", PALETTE.blue) }}>
                {brand.invoice_lab_name}
              </h2>
            )}
            {brand.invoice_contact && (
              <p style={{ margin: "1px 0 0", lineHeight: 1.2, textAlign: brand.invoice_lab_name_align as any, ...textStyle(brand, "invoice_contact", "9", PALETTE.muted) }}>
                {brand.invoice_contact}
              </p>
            )}
            {brand.invoice_address && (
              <p style={{ margin: 0, whiteSpace: "pre-line", lineHeight: 1.2, textAlign: brand.invoice_address_align as any, ...textStyle(brand, "invoice_address", "8", PALETTE.muted) }}>
                {brand.invoice_address}
              </p>
            )}
          </div>
          <div style={{ height: 2, background: PALETTE.red, width: "100%", margin: "0 0 6px", padding: 0, border: "none" }} />

          {/* Invoice meta — left invoice#, center barcode, right UMR */}
          <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed", marginBottom: 4 }}>
            <tbody>
              <tr>
                <td style={{ border: "none", verticalAlign: "middle", textAlign: "left", padding: 0, width: "38%" }}>
                  <div style={{ fontSize: 8, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: PALETTE.blue, lineHeight: 1 }}>
                    {brand.invoice_tagline || "Receipt Memo"}
                  </div>
                  <div style={{ fontSize: 15, fontWeight: 800, letterSpacing: "-0.02em", color: PALETTE.ink, lineHeight: 1.15 }}>
                    #{data.invoice_number}
                  </div>
                  <div style={{ fontSize: 9, fontWeight: 500, color: PALETTE.muted, lineHeight: 1.2 }}>
                    {format(createdAt, "dd MMM yyyy · hh:mm a")}
                  </div>
                </td>
                <td style={{ border: "none", verticalAlign: "middle", textAlign: "center", padding: "0 6px", width: "24%" }}>
                  <canvas
                    ref={barcodeRef}
                    style={{
                      display: data.umr_number ? "inline-block" : "none",
                      maxWidth: "100%",
                      height: 20,
                      verticalAlign: "middle",
                    }}
                  />
                </td>
                <td style={{ border: "none", verticalAlign: "middle", textAlign: "right", padding: 0, width: "38%", whiteSpace: "nowrap", fontSize: 9, color: PALETTE.muted }}>
                  <div style={{ display: "inline-block", background: PALETTE.blueSoft, color: PALETTE.blue, fontWeight: 700, fontSize: 8, letterSpacing: "0.05em", textTransform: "uppercase", padding: "2px 7px", borderRadius: 999 }}>
                    {visitLabel || "Visit"}
                  </div>
                  {data.umr_number && (
                    <div style={{ marginTop: 2, fontWeight: 700, color: PALETTE.ink }}>
                      {data.umr_number}
                    </div>
                  )}
                </td>
              </tr>
            </tbody>
          </table>

          {/* Patient — table layout (html2canvas-safe; matches print) */}
          <div style={{ background: PALETTE.blueSoft, border: `1px solid ${PALETTE.blueLine}`, borderRadius: 6, padding: "4px 8px", marginBottom: 6 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10, lineHeight: 1.25 }}>
              <tbody>
                <tr>
                  <td style={{ border: "none", padding: "1px 6px 1px 0", width: "50%", verticalAlign: "top" }}>
                    <span style={{ color: PALETTE.muted, fontSize: 8 }}>Name </span>
                    <strong>{patientDisplayName(data)}</strong>
                  </td>
                  <td style={{ border: "none", padding: "1px 0", width: "50%", verticalAlign: "top" }}>
                    <span style={{ color: PALETTE.muted, fontSize: 8 }}>Mobile </span>
                    <strong>{data.mobile_number || "—"}</strong>
                  </td>
                </tr>
                {(data.gender || ageDisplay || data.doctor_name) && (
                  <tr>
                    <td style={{ border: "none", padding: "1px 6px 1px 0", verticalAlign: "top" }}>
                      <span style={{ color: PALETTE.muted, fontSize: 8 }}>Age / Gender </span>
                      <strong>{[ageDisplay, data.gender].filter(Boolean).join(" · ") || "—"}</strong>
                    </td>
                    <td style={{ border: "none", padding: "1px 0", verticalAlign: "top" }}>
                      <span style={{ color: PALETTE.muted, fontSize: 8 }}>Doctor </span>
                      <strong>{data.doctor_name || "—"}</strong>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <table style={{ width: "100%", borderCollapse: "collapse", margin: 0 }}>
            <thead>
              <tr>
                <th style={{ padding: "5px 4px", fontSize: 10, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: PALETTE.blue, borderBottom: `2px solid ${PALETTE.blue}`, background: PALETTE.blueSoft, width: "1%", whiteSpace: "nowrap", textAlign: "center" }}>#</th>
                <th style={{ padding: "5px 4px", fontSize: 10, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: PALETTE.blue, borderBottom: `2px solid ${PALETTE.blue}`, background: PALETTE.blueSoft, textAlign: "left" }}>Test / Investigation</th>
                {hasAnyDiscount ? (
                  <>
                    <th style={{ padding: "5px 14px", fontSize: 10, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: PALETTE.blue, borderBottom: `2px solid ${PALETTE.blue}`, background: PALETTE.blueSoft, textAlign: "right", width: "1%", whiteSpace: "nowrap", minWidth: "4.75em" }}>Price</th>
                    <th style={{ padding: "5px 14px", fontSize: 10, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: PALETTE.blue, borderBottom: `2px solid ${PALETTE.blue}`, background: PALETTE.blueSoft, textAlign: "right", width: "1%", whiteSpace: "nowrap", minWidth: "4.75em" }}>Disc</th>
                    <th style={{ padding: "5px 14px", fontSize: 10, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: PALETTE.blue, borderBottom: `2px solid ${PALETTE.blue}`, background: PALETTE.blueSoft, textAlign: "right", width: "1%", whiteSpace: "nowrap", minWidth: "4.75em" }}>Net</th>
                  </>
                ) : (
                  <th style={{ padding: "5px 14px", fontSize: 10, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: PALETTE.blue, borderBottom: `2px solid ${PALETTE.blue}`, background: PALETTE.blueSoft, textAlign: "right", width: "1%", whiteSpace: "nowrap", minWidth: "4.75em" }}>Amount</th>
                )}
              </tr>
            </thead>
            <tbody>
              {tests.map((t: any, i: number) => {
                const included = includedTestsLine(t);
                const name = String(t.test_name || "");
                const nameSize = name.length > 42 ? 10 : name.length > 28 ? 11 : 12;
                return (
                <tr key={i}>
                  <td style={{ padding: "5px 4px", fontSize: 12, textAlign: "center", whiteSpace: "nowrap", color: PALETTE.muted, borderBottom: `1px solid ${PALETTE.line}`, lineHeight: 1.25, verticalAlign: "top" }}>{i + 1}</td>
                  <td style={{ padding: "5px 4px", fontSize: nameSize, borderBottom: `1px solid ${PALETTE.line}`, fontWeight: 600, lineHeight: 1.25, verticalAlign: "top", wordBreak: "break-word", overflowWrap: "anywhere", whiteSpace: "normal" }}>
                    {t.test_name}
                    {included ? (
                      <div style={{ fontSize: 9, fontStyle: "italic", fontWeight: 400, color: PALETTE.muted, lineHeight: 1.3, marginTop: 2, wordBreak: "break-word", overflowWrap: "anywhere" }}>
                        {included}
                      </div>
                    ) : null}
                  </td>
                  {hasAnyDiscount ? (
                    <>
                      <td style={{ padding: "5px 14px", fontSize: 12, textAlign: "right", whiteSpace: "nowrap", borderBottom: `1px solid ${PALETTE.line}`, lineHeight: 1.25, minWidth: "4.75em" }}>₹{t.price}</td>
                      <td style={{ padding: "5px 14px", fontSize: 12, textAlign: "right", whiteSpace: "nowrap", color: PALETTE.discount, borderBottom: `1px solid ${PALETTE.line}`, fontWeight: 600, lineHeight: 1.25, minWidth: "4.75em" }}>{Number(t.discount || 0) > 0 ? `-₹${t.discount}` : "—"}</td>
                      <td style={{ padding: "5px 14px", fontSize: 12, textAlign: "right", whiteSpace: "nowrap", fontWeight: 700, borderBottom: `1px solid ${PALETTE.line}`, lineHeight: 1.25, minWidth: "4.75em" }}>₹{invoiceLineNet(t)}</td>
                    </>
                  ) : (
                    <td style={{ padding: "5px 14px", fontSize: 12, textAlign: "right", whiteSpace: "nowrap", fontWeight: 700, borderBottom: `1px solid ${PALETTE.line}`, lineHeight: 1.25, minWidth: "4.75em" }}>₹{t.price}</td>
                  )}
                </tr>
                );
              })}
              {tests.length > 0 && (
                <tr>
                  <td colSpan={2} style={{ padding: "6px 4px", fontSize: 13, fontWeight: 800, color: PALETTE.ink, borderTop: `2px solid ${PALETTE.blue}`, borderBottom: `1px solid ${PALETTE.line}`, lineHeight: 1.25 }}>Total</td>
                  {hasAnyDiscount ? (
                    <>
                      <td style={{ padding: "6px 14px", fontSize: 13, fontWeight: 800, textAlign: "right", whiteSpace: "nowrap", color: PALETTE.ink, borderTop: `2px solid ${PALETTE.blue}`, borderBottom: `1px solid ${PALETTE.line}`, lineHeight: 1.25, minWidth: "4.75em" }}>₹{activeGross}</td>
                      <td style={{ padding: "6px 14px", fontSize: 13, fontWeight: 800, textAlign: "right", whiteSpace: "nowrap", color: PALETTE.discount, borderTop: `2px solid ${PALETTE.blue}`, borderBottom: `1px solid ${PALETTE.line}`, lineHeight: 1.25, minWidth: "4.75em" }}>{activeDiscount > 0 ? `-₹${activeDiscount}` : "—"}</td>
                      <td style={{ padding: "6px 14px", fontSize: 13, fontWeight: 800, textAlign: "right", whiteSpace: "nowrap", color: PALETTE.ink, borderTop: `2px solid ${PALETTE.blue}`, borderBottom: `1px solid ${PALETTE.line}`, lineHeight: 1.25, minWidth: "4.75em" }}>₹{activeNet}</td>
                    </>
                  ) : (
                    <td style={{ padding: "6px 14px", fontSize: 13, fontWeight: 800, textAlign: "right", whiteSpace: "nowrap", color: PALETTE.ink, borderTop: `2px solid ${PALETTE.blue}`, borderBottom: `1px solid ${PALETTE.line}`, lineHeight: 1.25, minWidth: "4.75em" }}>₹{activeGross}</td>
                  )}
                </tr>
              )}
            </tbody>
          </table>

          <div style={{ marginTop: 14, padding: 0, textAlign: "left" }}>
            <div style={{ display: "flex", gap: 14, alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap" }}>
              <div style={{ flex: "0 0 auto", minWidth: 200, maxWidth: 260 }}>
                {(() => {
                  const status = paymentStatusBadge(data);
                  const statusFg = status.tone === "paid" || status.tone === "partial" ? PALETTE.discount : PALETTE.red;
                  const dueAmt = Number(data.due_amount || 0);
                  const paidAmt = Number(data.paid_amount || 0);
                  return (
                <div
                  style={{
                    background: PALETTE.blueSoft,
                    border: `1px solid ${PALETTE.blueLine}`,
                    borderRadius: 10,
                    padding: "10px 12px",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                    <Wallet style={{ width: 13, height: 13, color: PALETTE.blue }} />
                    <span style={{ fontSize: 11, fontWeight: 800, color: PALETTE.blue }}>Payment Summary</span>
                  </div>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <tbody>
                      {showGross && (
                        <>
                          <tr>
                            <td style={{ padding: "3px 0", fontSize: 10, color: PALETTE.blue, textAlign: "left", border: "none", whiteSpace: "nowrap" }}>Gross Amount</td>
                            <td style={{ padding: "3px 0 3px 16px", fontSize: 10, color: PALETTE.blue, textAlign: "right", border: "none", whiteSpace: "nowrap" }}>₹{activeGross}</td>
                          </tr>
                          {activeDiscount > 0 && (
                            <tr>
                              <td style={{ padding: "3px 0", fontSize: 10, fontWeight: 600, color: PALETTE.discount, textAlign: "left", border: "none", whiteSpace: "nowrap" }}>Total Discount</td>
                              <td style={{ padding: "3px 0 3px 16px", fontSize: 10, fontWeight: 600, color: PALETTE.discount, textAlign: "right", border: "none", whiteSpace: "nowrap" }}>– ₹{activeDiscount}</td>
                            </tr>
                          )}
                          {Number(data.home_visit_charges || 0) > 0 && (
                            <tr>
                              <td style={{ padding: "3px 0", fontSize: 10, color: PALETTE.blue, textAlign: "left", border: "none", whiteSpace: "nowrap" }}>Home Visit Charges</td>
                              <td style={{ padding: "3px 0 3px 16px", fontSize: 10, color: PALETTE.blue, textAlign: "right", border: "none", whiteSpace: "nowrap" }}>+ ₹{data.home_visit_charges}</td>
                            </tr>
                          )}
                        </>
                      )}
                      <tr>
                        <td style={{ padding: "8px 0 3px", fontSize: 12, fontWeight: 800, color: PALETTE.blueDark, textAlign: "left", border: "none", whiteSpace: "nowrap" }}>Net Payable</td>
                        <td style={{ padding: "8px 0 3px 16px", fontSize: 13, fontWeight: 800, color: PALETTE.blueDark, textAlign: "right", border: "none", whiteSpace: "nowrap" }}>₹{activeFinal}</td>
                      </tr>
                    </tbody>
                  </table>
                  <div style={{ marginTop: 8, background: "#E8ECF8", borderRadius: 8, padding: "8px 10px" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                      <tbody>
                        <tr>
                          <td style={{ padding: "2px 0", fontSize: 10, fontWeight: 600, color: PALETTE.blue, textAlign: "left", border: "none", whiteSpace: "nowrap" }}>Paid Amount</td>
                          <td style={{ padding: "2px 0 2px 12px", fontSize: 10, fontWeight: 600, color: PALETTE.blue, textAlign: "right", border: "none", whiteSpace: "nowrap" }}>₹{paidAmt}</td>
                        </tr>
                        {dueAmt > 0 && (
                          <>
                            <tr>
                              <td colSpan={2} style={{ padding: "4px 0", border: "none" }}>
                                <div style={{ height: 1, background: PALETTE.blueLine }} />
                              </td>
                            </tr>
                            <tr>
                              <td style={{ padding: "2px 0", fontSize: 10, fontWeight: 700, color: PALETTE.blue, textAlign: "left", border: "none", whiteSpace: "nowrap" }}>Balance Due</td>
                              <td style={{ padding: "2px 0 2px 12px", fontSize: 10, fontWeight: 700, color: PALETTE.red, textAlign: "right", border: "none", whiteSpace: "nowrap" }}>₹{dueAmt}</td>
                            </tr>
                          </>
                        )}
                      </tbody>
                    </table>
                    <div
                      style={{
                        marginTop: 8,
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        background: PALETTE.white,
                        border: `1px solid ${PALETTE.blueLine}`,
                        borderRadius: 8,
                        padding: "5px 8px",
                      }}
                    >
                      <CheckCircle2 style={{ width: 14, height: 14, color: statusFg }} />
                      <div style={{ lineHeight: 1.15 }}>
                        <div style={{ fontSize: 9, fontWeight: 800, color: statusFg, letterSpacing: "0.04em" }}>{status.label}</div>
                        {dueAmt > 0 && status.tone !== "cancelled" && (
                          <div style={{ fontSize: 10, fontWeight: 800, color: statusFg }}>₹{dueAmt} DUE</div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
                  );
                })()}
              </div>

              <div
                style={{
                  flex: "1 1 220px",
                  maxWidth: 320,
                  border: `1px solid ${PALETTE.blueLine}`,
                  borderRadius: 8,
                  overflow: "hidden",
                  background: PALETTE.white,
                  minWidth: 220,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 5,
                    padding: "5px 8px",
                    background: PALETTE.blueSoft,
                    borderBottom: `1px solid ${PALETTE.blueLine}`,
                  }}
                >
                  <Wallet style={{ width: 12, height: 12, color: PALETTE.blue }} />
                  <span style={{ fontSize: 10, fontWeight: 800, color: PALETTE.blue }}>Payment Details</span>
                </div>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <th style={{ padding: "4px 6px", fontSize: 8, fontWeight: 700, letterSpacing: "0.03em", textTransform: "uppercase", color: PALETTE.blue, background: PALETTE.blueSoft, borderBottom: `1px solid ${PALETTE.blueLine}`, textAlign: "left", whiteSpace: "nowrap" }}>Date</th>
                      <th style={{ padding: "4px 6px", fontSize: 8, fontWeight: 700, letterSpacing: "0.03em", textTransform: "uppercase", color: PALETTE.blue, background: PALETTE.blueSoft, borderBottom: `1px solid ${PALETTE.blueLine}`, textAlign: "left", whiteSpace: "nowrap" }}>Mode</th>
                      <th style={{ padding: "4px 6px", fontSize: 8, fontWeight: 700, letterSpacing: "0.03em", textTransform: "uppercase", color: PALETTE.blue, background: PALETTE.blueSoft, borderBottom: `1px solid ${PALETTE.blueLine}`, textAlign: "right", whiteSpace: "nowrap" }}>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payments.length === 0 && !(Number(data.refund_amount || 0) > 0) ? (
                      <tr>
                        <td colSpan={3} style={{ padding: 6, fontSize: 9, color: PALETTE.muted, textAlign: "left", borderBottom: `1px solid ${PALETTE.line}` }}>No payments</td>
                      </tr>
                    ) : (
                      <>
                        {payments.map((pay: any, i: number) => (
                          <tr key={`pay-${i}`}>
                            <td style={{ padding: "4px 6px", fontSize: 9, color: PALETTE.ink, borderBottom: `1px solid ${PALETTE.line}`, whiteSpace: "nowrap", lineHeight: 1.25 }}>{paymentDetailsDateLabel(pay, createdAt)}</td>
                            <td style={{ padding: "4px 6px", fontSize: 9, color: PALETTE.ink, borderBottom: `1px solid ${PALETTE.line}`, whiteSpace: "nowrap", lineHeight: 1.25 }}>{pay.mode || "Payment"}</td>
                            <td style={{ padding: "4px 6px", fontSize: 9, fontWeight: 700, color: PALETTE.ink, borderBottom: `1px solid ${PALETTE.line}`, textAlign: "right", whiteSpace: "nowrap", lineHeight: 1.25 }}>₹{pay.amount}</td>
                          </tr>
                        ))}
                        {Number(data.refund_amount || 0) > 0 && (
                          <tr>
                            <td style={{ padding: "4px 6px", fontSize: 9, color: PALETTE.ink, borderBottom: `1px solid ${PALETTE.line}`, whiteSpace: "nowrap", lineHeight: 1.25 }}>
                              {data.refund_date ? format(new Date(data.refund_date), "dd MMM yyyy hh:mm a") : "—"}
                            </td>
                            <td style={{ padding: "4px 6px", fontSize: 9, color: PALETTE.ink, borderBottom: `1px solid ${PALETTE.line}`, whiteSpace: "nowrap", lineHeight: 1.25 }}>
                              {refundModeLabel(data.refund_mode)}
                            </td>
                            <td style={{ padding: "4px 6px", fontSize: 9, fontWeight: 700, color: PALETTE.orange, borderBottom: `1px solid ${PALETTE.line}`, textAlign: "right", whiteSpace: "nowrap", lineHeight: 1.25 }}>
                              -₹{data.refund_amount}
                            </td>
                          </tr>
                        )}
                      </>
                    )}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={2} style={{ padding: "5px 6px", fontSize: 9, fontWeight: 800, color: PALETTE.blue, background: PALETTE.blueSoft, borderTop: `1px solid ${PALETTE.blueLine}` }}>Total Paid</td>
                      <td style={{ padding: "5px 6px", fontSize: 10, fontWeight: 800, color: PALETTE.blue, background: PALETTE.blueSoft, borderTop: `1px solid ${PALETTE.blueLine}`, textAlign: "right" }}>₹{data.paid_amount || 0}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
            {Number(data.paid_amount || 0) > 0 && (
              <div style={{ fontSize: 10, marginTop: 6, color: PALETTE.muted, lineHeight: 1.25, textAlign: "left" }}>
                Received with thanks from <strong style={{ color: PALETTE.ink }}>{patientDisplayName(data)}</strong> a sum of Rs. {Number(data.paid_amount).toFixed(2)}/- ({numberToWords(Number(data.paid_amount))} Rupees)
              </div>
            )}
            {cancelledTests.length > 0 && (
              <div style={{ fontSize: 9, color: PALETTE.muted, marginTop: 2, textAlign: "left" }}>
                Cancelled Tests: {cancelledTests.map((ct: any) => ct.test_name || ct.test_id).join(", ")}
              </div>
            )}
            {hvcRefund > 0 && (
              <div style={{ fontSize: 9, color: PALETTE.muted, marginTop: 1, textAlign: "left" }}>
                Home Visit Charges Refunded: ₹{hvcRefund}
              </div>
            )}
          </div>

          <div style={{ textAlign: "center", fontSize: 10, color: PALETTE.muted, marginTop: 4, lineHeight: 1.3 }}>
            <p style={{ margin: 0, fontWeight: 700, color: PALETTE.blue }}>Thank you for choosing PH PathLabs</p>
            <p style={{ margin: "2px 0 0", fontSize: 9, color: PALETTE.muted }}>This is an electronically generated receipt and does not require a signature</p>
          </div>
          <div style={{ height: 1, background: PALETTE.line, width: "100%", marginTop: 3 }} />
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: PALETTE.muted, marginTop: 2, lineHeight: 1.25 }}>
            <div>Prepared by {data.registered_by || "—"} · {format(createdAt, "dd-MM-yyyy hh:mm a")}</div>
            <div>Printed by {getCurrentUserName() || "—"} · {format(new Date(), "dd-MM-yyyy hh:mm a")}</div>
          </div>
        </div>

        <div className="flex gap-2 mt-2 flex-wrap">
          {statusHint ? (
            <p className="w-full text-sm text-primary font-medium">{statusHint}</p>
          ) : null}
          {!hidePrint && (
            <Button className="flex-1" variant="outline" onClick={handlePrint} disabled={!fontsReady || !brandReady}>
              <Printer className="h-4 w-4 mr-2" />Print
            </Button>
          )}
          {!isPickupInvoice(data) && (
            <Button
              className="flex-1"
              onClick={() => void queueInvoiceViaWaApi()}
              disabled={waSending || !data?.mobile_number || !fontsReady || !brandReady}
            >
              {waSending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Send className="h-4 w-4 mr-2" />
              )}
              {waSending ? "Queuing…" : consoleQueued ? "WhatsApp (resend)" : "WhatsApp"}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default InvoicePreviewLegacy;
