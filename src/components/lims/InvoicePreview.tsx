import { useRef, useState, useEffect, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Printer, Send, Loader2 } from "lucide-react";
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

interface InvoicePreviewProps {
  data: any;
  open: boolean;
  onClose: () => void;
  /** After registration: auto-enqueue invoice to WhatsApp Console outbox once. */
  autoQueueWhatsApp?: boolean;
  /** Hide Print (e.g. home-visit completion receipt — WhatsApp only). */
  hidePrint?: boolean;
  /** Increment to trigger a WhatsApp queue from parent (batch send). */
  queueRequestId?: number;
  /** Called when a triggered / button queue finishes. */
  onQueueSettled?: (result: { ok: boolean; error?: string }) => void;
  /** Optional status line shown above actions (e.g. batch send progress). */
  statusHint?: string;
}

function invoiceLineAmount(t: any): number {
  return Number(t?.price || 0);
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

const SETTING_KEYS = [
  "invoice_lab_name",
  "invoice_address",
  "invoice_contact",
  "invoice_tagline",
  "invoice_logo_url",
  "invoice_logo_align",
  "invoice_lab_name_align",
  "invoice_lab_name_visible",
  "invoice_tagline_align",
  "invoice_address_align",
  "invoice_lab_name_size",
  "invoice_lab_name_bold",
  "invoice_lab_name_color",
  "invoice_contact_size",
  "invoice_contact_bold",
  "invoice_contact_color",
  "invoice_address_size",
  "invoice_address_bold",
  "invoice_address_color",
  "invoice_tagline_size",
  "invoice_tagline_bold",
  "invoice_tagline_color",
];

const DEFAULTS: Record<string, string> = {
  invoice_lab_name: "PH PathLabs",
  invoice_address: "",
  invoice_contact: "LabLine: 6356 55 66 99",
  invoice_tagline: "Invoice / Sample Receipt",
  invoice_logo_url: "",
  invoice_logo_align: "center",
  invoice_lab_name_align: "center",
  invoice_lab_name_visible: "true",
  invoice_tagline_align: "center",
  invoice_address_align: "center",
  invoice_lab_name_size: "16",
  invoice_lab_name_bold: "true",
  invoice_lab_name_color: "#2E3192",
  invoice_contact_size: "10",
  invoice_contact_bold: "false",
  invoice_contact_color: "#6b7280",
  invoice_address_size: "9",
  invoice_address_bold: "false",
  invoice_address_color: "#6b7280",
  invoice_tagline_size: "9",
  invoice_tagline_bold: "false",
  invoice_tagline_color: "#6b7280",
};

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
 * Fonts that include U+20B9 (₹). Avoid Arial — it often has no rupee glyph (shows □).
 * IBM Plex Sans is the app font; Noto Sans is the reliable ₹ fallback for print/WA capture.
 */
const INVOICE_FONT =
  '"IBM Plex Sans", "Noto Sans", "Segoe UI", system-ui, sans-serif';

const INVOICE_FONT_CSS_HREF =
  "https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=Noto+Sans:wght@400;500;600;700&display=swap";

async function ensureInvoiceFontsReady(): Promise<void> {
  try {
    if (typeof document !== "undefined" && document.fonts?.ready) {
      await document.fonts.ready;
      // Warm the faces used for ₹ so html-to-image can embed them.
      await Promise.all([
        document.fonts.load(`400 12px "IBM Plex Sans"`),
        document.fonts.load(`700 12px "IBM Plex Sans"`),
        document.fonts.load(`400 12px "Noto Sans"`),
        document.fonts.load(`700 12px "Noto Sans"`),
      ]);
    }
  } catch {
    // non-fatal — capture still proceeds
  }
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

const InvoicePreview = ({
  data,
  open,
  onClose,
  autoQueueWhatsApp = false,
  hidePrint = false,
  queueRequestId = 0,
  onQueueSettled,
  statusHint,
}: InvoicePreviewProps) => {
  const receiptRef = useRef<HTMLDivElement>(null);
  const barcodeRef = useRef<HTMLCanvasElement>(null);
  const queuedInvoiceRef = useRef<string | null>(null);
  const autoQueuedRef = useRef<string | null>(null);
  const [brand, setBrand] = useState<Record<string, string>>(DEFAULTS);
  const [channelName, setChannelName] = useState("");
  const [consoleQueued, setConsoleQueued] = useState(false);
  const [waSending, setWaSending] = useState(false);
  const [packageTestsById, setPackageTestsById] = useState<Map<string, string[]>>(new Map());
  const [packageNamesReady, setPackageNamesReady] = useState(false);

  useEffect(() => {
    if (!open) {
      setConsoleQueued(false);
      setWaSending(false);
      setPackageNamesReady(false);
      return;
    }
    setConsoleQueued(queuedInvoiceRef.current === String(data?.invoice_number || ""));
    setPackageNamesReady(false);
    (async () => {
      const lines = Array.isArray(data?.tests) ? data.tests : [];
      try {
        setPackageTestsById(await fetchPackageIncludedTestNamesFromLines(lines));
      } catch {
        setPackageTestsById(new Map());
      }
      setPackageNamesReady(true);
      const { data: rows } = await supabase
        .from("app_settings")
        .select("setting_key, setting_value")
        .in("setting_key", SETTING_KEYS);
      if (rows) {
        const merged = { ...DEFAULTS };
        rows.forEach((r) => { merged[r.setting_key] = r.setting_value; });
        setBrand(merged);
      }
    })();
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
    if (!open || !data?.umr_number) return;
    const timer = setTimeout(() => {
      renderBarcode();
    }, 200);
    return () => clearTimeout(timer);
  }, [open, data?.umr_number, renderBarcode]);

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
      onQueueSettled?.({ ok, error });
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

      const imgs = Array.from(clone.querySelectorAll("img"));
      await Promise.all(
        imgs.map(
          (img) =>
            img.complete
              ? Promise.resolve()
              : new Promise<void>((resolve) => {
                  img.onload = () => resolve();
                  img.onerror = () => resolve();
                }),
        ),
      );

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
            cacheBust: true,
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
  }, [open, data, brand, renderBarcode, isPickupInvoice, onQueueSettled]);

  // Parent-driven batch queue (e.g. home-visit multi-invoice send).
  const lastQueueReq = useRef(0);
  useEffect(() => {
    if (!queueRequestId || queueRequestId === lastQueueReq.current) return;
    if (!open || !data?.invoice_number || !packageNamesReady) return;
    lastQueueReq.current = queueRequestId;
    void queueInvoiceViaWaApi();
  }, [queueRequestId, open, data?.invoice_number, packageNamesReady, queueInvoiceViaWaApi]);

  // New registration: queue invoice to durable outbox once barcode/layout is ready.
  useEffect(() => {
    if (!autoQueueWhatsApp || !open || !data?.invoice_number || !data?.mobile_number) return;
    if (!packageNamesReady) return;
    if (isPickupInvoice(data)) return;
    const invoiceNo = String(data.invoice_number);
    if (autoQueuedRef.current === invoiceNo || queuedInvoiceRef.current === invoiceNo) return;
    const timer = setTimeout(() => {
      if (autoQueuedRef.current === invoiceNo || queuedInvoiceRef.current === invoiceNo) return;
      autoQueuedRef.current = invoiceNo;
      void queueInvoiceViaWaApi();
    }, 900);
    return () => clearTimeout(timer);
  }, [autoQueueWhatsApp, open, data, data?.invoice_number, data?.mobile_number, queueInvoiceViaWaApi, isPickupInvoice, packageNamesReady]);

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
  const activeNet = tests.reduce((sum: number, t: any) => sum + Number(t.discounted_price || t.discountedPrice || t.price || 0), 0);
  const activeDiscount = activeGross - activeNet;
  const activeFinal = activeNet + Number(data.home_visit_charges || 0);

  const cancelledTestRefundTotal = cancelledTests.reduce((sum: number, ct: any) => sum + Number(ct.price || 0), 0);
  const hvcRefund = Math.max(0, Number(data.refund_amount || 0) - cancelledTestRefundTotal);

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
      if (brand.invoice_logo_url) {
        h += `<div style="text-align:${brand.invoice_logo_align};line-height:0"><img src="${brand.invoice_logo_url}" style="max-height:40px;display:inline-block" /></div>`;
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
      const th = `padding:5px 4px;font-size:10px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;color:${PALETTE.blue};border-bottom:2px solid ${PALETTE.blue};background:transparent`;
      let h = `<tr>`;
      h += `<th style="${th};width:1%;white-space:nowrap;text-align:center">#</th>`;
      h += `<th style="${th};text-align:left">Test / Investigation</th>`;
      if (hasAnyDiscount) {
        h += `<th style="${th};text-align:right;width:1%;white-space:nowrap">Price</th>`;
        h += `<th style="${th};text-align:right;width:1%;white-space:nowrap">Disc</th>`;
        h += `<th style="${th};text-align:right;width:1%;white-space:nowrap">Net</th>`;
      } else {
        h += `<th style="${th};text-align:right;width:1%;white-space:nowrap">Amount</th>`;
      }
      h += `</tr>`;
      return h;
    };

    const testRowHtml = (t: any, globalIndex: number) => {
      const td = `padding:5px 4px;font-size:12px;color:${PALETTE.ink};border-bottom:1px solid ${PALETTE.line};line-height:1.25;vertical-align:top`;
      const included = includedTestsLine(t);
      let r = `<tr>`;
      r += `<td style="${td};text-align:center;width:1%;white-space:nowrap;color:${PALETTE.muted}">${globalIndex + 1}</td>`;
      r += `<td style="${td};font-weight:600">${escapeInvoiceHtml(String(t.test_name || ""))}`;
      if (included) {
        r += `<div style="font-size:9px;font-style:italic;font-weight:400;color:${PALETTE.muted};line-height:1.3;margin-top:2px">${escapeInvoiceHtml(included)}</div>`;
      }
      r += `</td>`;
      if (hasAnyDiscount) {
        r += `<td style="${td};text-align:right;white-space:nowrap">₹${t.price}</td>`;
        r += `<td style="${td};text-align:right;white-space:nowrap;color:${PALETTE.discount}">${Number(t.discount || 0) > 0 ? `-₹${t.discount}` : "—"}</td>`;
        r += `<td style="${td};text-align:right;white-space:nowrap;font-weight:700">₹${t.discounted_price || t.discountedPrice}</td>`;
      } else {
        r += `<td style="${td};text-align:right;white-space:nowrap;font-weight:700">₹${t.price}</td>`;
      }
      r += `</tr>`;
      return r;
    };

    let pagesHtml = '';
    let globalTestIndex = 0;

    pages.forEach((pageTests, pageIdx) => {
      const isLast = pageIdx === totalPages - 1;
      const pageBreak = isLast ? '' : 'page-break-after:always;';

      // Calculate subtotal for this page's tests
      const pageSubtotal = pageTests.reduce((sum: number, t: any) => sum + Number(t.discounted_price || t.discountedPrice || t.price || 0), 0);

      let tableRows = '';
      pageTests.forEach((t: any) => {
        tableRows += testRowHtml(t, globalTestIndex);
        globalTestIndex++;
      });

      const colSpan = hasAnyDiscount ? 4 : 2;
      const subtotalRow = !isLast
        ? `<tr><td colspan="${colSpan}" style="padding:8px 6px;font-size:10px;text-align:right;font-weight:700;color:${PALETTE.blue};border-bottom:1px solid ${PALETTE.line}">Subtotal</td><td style="padding:8px 6px;font-size:10px;text-align:right;font-weight:700;white-space:nowrap;color:${PALETTE.ink};border-bottom:1px solid ${PALETTE.line}">₹${pageSubtotal}</td></tr>`
        : "";

      // Payment summary only on last page — use tables (print engines break flex alignment)
      let summaryHtml = '';
      if (isLast) {
        const moneyRow = (
          label: string,
          amount: string,
          opts?: { color?: string; weight?: string; bg?: string; size?: string; amountSize?: string },
        ) => {
          const color = opts?.color || PALETTE.ink;
          const weight = opts?.weight || "600";
          const bg = opts?.bg || "transparent";
          const size = opts?.size || "11px";
          const amountSize = opts?.amountSize || size;
          const pad = "1px 0";
          return `<tr>
            <td style="padding:${pad};font-size:${size};font-weight:${weight};color:${color};background:${bg};text-align:left;vertical-align:middle;border:0;width:70%;line-height:1.2">${label}</td>
            <td style="padding:${pad};font-size:${amountSize};font-weight:${weight};color:${color};background:${bg};text-align:right;vertical-align:middle;white-space:nowrap;border:0;width:30%;line-height:1.2">${amount}</td>
          </tr>`;
        };

        summaryHtml = `<div style="margin-top:3px;padding:0">`;
        summaryHtml += `<table style="width:100%;border-collapse:collapse;table-layout:fixed">`;
        if (showGross) {
          summaryHtml += moneyRow("Gross Amount", `₹${activeGross}`, { color: PALETTE.muted, weight: "500", size: "10px" });
          if (activeDiscount > 0) {
            summaryHtml += moneyRow("Discount", `-₹${activeDiscount}`, { color: PALETTE.discount, weight: "600", size: "10px" });
          }
          if (Number(data.home_visit_charges || 0) > 0) {
            summaryHtml += moneyRow("Home Visit Charges", `+₹${data.home_visit_charges}`, { color: PALETTE.muted, weight: "500", size: "10px" });
          }
        }
        summaryHtml += moneyRow("Final Amount", `₹${activeFinal}`, { color: PALETTE.ink, weight: "800", size: "11px", amountSize: "11px" });
        if (payments.length > 0) {
          payments.forEach((p: any) => {
            summaryHtml += moneyRow(
              `${p.mode}${p.date ? ` (${format(new Date(p.date), "dd-MM-yyyy hh:mm a")})` : ""}`,
              `₹${p.amount}`,
              { color: PALETTE.muted, weight: "500", size: "9px" },
            );
          });
        }
        summaryHtml += moneyRow("Paid", `₹${data.paid_amount}`, { color: PALETTE.ink, weight: "700", size: "10px" });
        if (data.due_amount > 0) {
          summaryHtml += moneyRow("Due", `₹${data.due_amount}`, { color: PALETTE.red, weight: "800", size: "10px" });
        }
        if (data.refund_amount > 0) {
          summaryHtml += moneyRow("Refund Amount", `₹${data.refund_amount}`, { color: PALETTE.orange, weight: "700", size: "10px" });
          summaryHtml += moneyRow("Refund Mode", `${data.refund_mode || "—"}`, { color: PALETTE.muted, weight: "500", size: "9px" });
          if (data.refund_date) {
            summaryHtml += moneyRow("Refund Date", format(new Date(data.refund_date), "dd-MM-yyyy hh:mm a"), {
              color: PALETTE.muted,
              weight: "500",
              size: "9px",
            });
          }
        }
        summaryHtml += `</table>`;
        if (Number(data.paid_amount || 0) > 0) {
          summaryHtml += `<div style="font-size:8px;margin-top:2px;color:${PALETTE.muted};line-height:1.2">Received with thanks from <strong style="color:${PALETTE.ink}">${patientDisplayName(data)}</strong> a sum of Rs. ${Number(data.paid_amount).toFixed(2)}/- (${numberToWords(Number(data.paid_amount))} Rupees)</div>`;
        }
        if (cancelledTests.length > 0) {
          summaryHtml += `<div style="font-size:7px;color:${PALETTE.muted};margin-top:1px">Cancelled Tests: ${cancelledTests.map((ct: any) => ct.test_name || ct.test_id).join(", ")}</div>`;
        }
        if (hvcRefund > 0) {
          summaryHtml += `<div style="font-size:7px;color:${PALETTE.muted};margin-top:1px">Home Visit Charges Refunded: ₹${hvcRefund}</div>`;
        }
        summaryHtml += `</div>`;

        summaryHtml += `<div style="text-align:center;font-size:7px;color:${PALETTE.muted};margin-top:3px;line-height:1.2">`;
        summaryHtml += `<p style="margin:0;font-weight:600;color:${PALETTE.blue}">Thank you for choosing PH PathLabs</p>`;
        summaryHtml += `<p style="margin:1px 0 0;font-size:6px">This is an electronically generated receipt and does not require a signature</p>`;
        summaryHtml += `</div>`;
      }

      const printNow = format(new Date(), "dd-MM-yyyy hh:mm a");
      const preparedDate = format(createdAt, "dd-MM-yyyy hh:mm a");
      const currentUser = getCurrentUserName() || "—";
      const preparedPrintedFooter = `<table style="width:100%;border-collapse:collapse;margin-top:3px;border-top:1px solid ${PALETTE.line}">
        <tr>
          <td style="padding-top:2px;font-size:6px;color:${PALETTE.muted};text-align:left;border:0;line-height:1.2">Prepared by ${data.registered_by || "—"} · ${preparedDate}</td>
          <td style="padding-top:2px;font-size:6px;color:${PALETTE.muted};text-align:right;border:0;line-height:1.2">Printed by ${currentUser} · ${printNow}</td>
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
        @page { size: A5; margin: 5mm; }
        * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; box-sizing: border-box; }
        html, body { margin: 0; padding: 0; }
        body { font-family: ${INVOICE_FONT}; color: ${PALETTE.ink}; }
        /* A5 printable area (210mm - 10mm margins). Clip so scale never creates page 2. */
        #invoice-page {
          width: 138mm;
          height: 200mm;
          overflow: hidden;
          margin: 0 auto;
          page-break-after: avoid;
          page-break-inside: avoid;
        }
        #invoice-sheet {
          width: 100%;
          transform-origin: top left;
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
            var maxH = page.clientHeight || Math.round((200 / 25.4) * 96);
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
            var pending = imgs.filter(function (img) { return !img.complete; }).length;
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
            setTimeout(go, 2500);
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

        <div
          ref={receiptRef}
          className="bg-white text-black rounded"
          style={{
            fontFamily: INVOICE_FONT,
            width: 560,
            margin: "0 auto",
            padding: "10px 16px 12px",
            color: PALETTE.ink,
          }}
        >
          {/* Brand header — solid red rule (not CSS border: html2canvas thickens borders) */}
          <div style={{ padding: "20px 0 4px" }}>
            {brand.invoice_logo_url && (
              <div style={{ textAlign: brand.invoice_logo_align as any, lineHeight: 0 }}>
                <img src={brand.invoice_logo_url} alt="Logo" style={{ maxHeight: 44, display: "inline-block" }} />
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

          <table style={{ width: "100%", borderCollapse: "collapse", margin: 0, tableLayout: "fixed" }}>
            <thead>
              <tr>
                <th style={{ padding: "5px 4px", fontSize: 10, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: PALETTE.blue, borderBottom: `2px solid ${PALETTE.blue}`, background: PALETTE.blueSoft, width: "8%", whiteSpace: "nowrap", textAlign: "center" }}>#</th>
                <th style={{ padding: "5px 4px", fontSize: 10, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: PALETTE.blue, borderBottom: `2px solid ${PALETTE.blue}`, background: PALETTE.blueSoft, textAlign: "left" }}>Test / Investigation</th>
                {hasAnyDiscount ? (
                  <>
                    <th style={{ padding: "5px 4px", fontSize: 10, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: PALETTE.blue, borderBottom: `2px solid ${PALETTE.blue}`, background: PALETTE.blueSoft, textAlign: "right", width: "16%", whiteSpace: "nowrap" }}>Price</th>
                    <th style={{ padding: "5px 4px", fontSize: 10, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: PALETTE.blue, borderBottom: `2px solid ${PALETTE.blue}`, background: PALETTE.blueSoft, textAlign: "right", width: "14%", whiteSpace: "nowrap" }}>Disc</th>
                    <th style={{ padding: "5px 4px", fontSize: 10, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: PALETTE.blue, borderBottom: `2px solid ${PALETTE.blue}`, background: PALETTE.blueSoft, textAlign: "right", width: "16%", whiteSpace: "nowrap" }}>Net</th>
                  </>
                ) : (
                  <th style={{ padding: "5px 4px", fontSize: 10, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: PALETTE.blue, borderBottom: `2px solid ${PALETTE.blue}`, background: PALETTE.blueSoft, textAlign: "right", width: "22%", whiteSpace: "nowrap" }}>Amount</th>
                )}
              </tr>
            </thead>
            <tbody>
              {tests.map((t: any, i: number) => {
                const included = includedTestsLine(t);
                return (
                <tr key={i}>
                  <td style={{ padding: "5px 4px", fontSize: 12, textAlign: "center", whiteSpace: "nowrap", color: PALETTE.muted, borderBottom: `1px solid ${PALETTE.line}`, lineHeight: 1.25, verticalAlign: "top" }}>{i + 1}</td>
                  <td style={{ padding: "5px 4px", fontSize: 12, borderBottom: `1px solid ${PALETTE.line}`, fontWeight: 600, lineHeight: 1.25, verticalAlign: "top" }}>
                    {t.test_name}
                    {included ? (
                      <div style={{ fontSize: 9, fontStyle: "italic", fontWeight: 400, color: PALETTE.muted, lineHeight: 1.3, marginTop: 2 }}>
                        {included}
                      </div>
                    ) : null}
                  </td>
                  {hasAnyDiscount ? (
                    <>
                      <td style={{ padding: "5px 4px", fontSize: 12, textAlign: "right", whiteSpace: "nowrap", borderBottom: `1px solid ${PALETTE.line}`, lineHeight: 1.25 }}>₹{t.price}</td>
                      <td style={{ padding: "5px 4px", fontSize: 12, textAlign: "right", whiteSpace: "nowrap", color: PALETTE.discount, borderBottom: `1px solid ${PALETTE.line}`, fontWeight: 600, lineHeight: 1.25 }}>{Number(t.discount || 0) > 0 ? `-₹${t.discount}` : "—"}</td>
                      <td style={{ padding: "5px 4px", fontSize: 12, textAlign: "right", whiteSpace: "nowrap", fontWeight: 700, borderBottom: `1px solid ${PALETTE.line}`, lineHeight: 1.25 }}>₹{t.discounted_price || t.discountedPrice}</td>
                    </>
                  ) : (
                    <td style={{ padding: "5px 4px", fontSize: 12, textAlign: "right", whiteSpace: "nowrap", fontWeight: 700, borderBottom: `1px solid ${PALETTE.line}`, lineHeight: 1.25 }}>₹{t.price}</td>
                  )}
                </tr>
                );
              })}
            </tbody>
          </table>

          <div style={{ marginTop: 4, padding: 0 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
              <colgroup>
                <col style={{ width: "70%" }} />
                <col style={{ width: "30%" }} />
              </colgroup>
              <tbody>
                {showGross && (
                  <>
                    <tr>
                      <td style={{ padding: "1px 0", fontSize: 11, color: PALETTE.muted, textAlign: "left", border: "none", lineHeight: 1.2 }}>Gross Amount</td>
                      <td style={{ padding: "1px 0", fontSize: 11, color: PALETTE.ink, textAlign: "right", whiteSpace: "nowrap", border: "none", lineHeight: 1.2 }}>₹{activeGross}</td>
                    </tr>
                    {activeDiscount > 0 && (
                      <tr>
                        <td style={{ padding: "1px 0", fontSize: 11, color: PALETTE.discount, fontWeight: 600, textAlign: "left", border: "none", lineHeight: 1.2 }}>Discount</td>
                        <td style={{ padding: "1px 0", fontSize: 11, color: PALETTE.discount, fontWeight: 600, textAlign: "right", whiteSpace: "nowrap", border: "none", lineHeight: 1.2 }}>-₹{activeDiscount}</td>
                      </tr>
                    )}
                    {Number(data.home_visit_charges || 0) > 0 && (
                      <tr>
                        <td style={{ padding: "1px 0", fontSize: 11, color: PALETTE.muted, textAlign: "left", border: "none", lineHeight: 1.2 }}>Home Visit Charges</td>
                        <td style={{ padding: "1px 0", fontSize: 11, color: PALETTE.ink, textAlign: "right", whiteSpace: "nowrap", border: "none", lineHeight: 1.2 }}>+₹{data.home_visit_charges}</td>
                      </tr>
                    )}
                  </>
                )}
                <tr>
                  <td style={{ padding: "1px 0", fontSize: 12, fontWeight: 800, color: PALETTE.ink, textAlign: "left", border: "none", lineHeight: 1.2 }}>Final Amount</td>
                  <td style={{ padding: "1px 0", fontSize: 12, fontWeight: 800, color: PALETTE.ink, textAlign: "right", whiteSpace: "nowrap", border: "none", lineHeight: 1.2 }}>₹{activeFinal}</td>
                </tr>
                {payments.map((p: any, i: number) => (
                  <tr key={i}>
                    <td style={{ padding: "1px 0", fontSize: 10, color: PALETTE.muted, textAlign: "left", border: "none", lineHeight: 1.2 }}>
                      {p.mode}{p.date ? ` (${format(new Date(p.date), "dd-MM-yyyy hh:mm a")})` : ""}
                    </td>
                    <td style={{ padding: "1px 0", fontSize: 10, color: PALETTE.ink, textAlign: "right", whiteSpace: "nowrap", border: "none", lineHeight: 1.2 }}>₹{p.amount}</td>
                  </tr>
                ))}
                <tr>
                  <td style={{ padding: "1px 0", fontSize: 11, fontWeight: 700, color: PALETTE.ink, textAlign: "left", border: "none", lineHeight: 1.2 }}>Paid</td>
                  <td style={{ padding: "1px 0", fontSize: 11, fontWeight: 700, color: PALETTE.ink, textAlign: "right", whiteSpace: "nowrap", border: "none", lineHeight: 1.2 }}>₹{data.paid_amount}</td>
                </tr>
                {data.due_amount > 0 && (
                  <tr>
                    <td style={{ padding: "1px 0", fontSize: 11, fontWeight: 800, color: PALETTE.red, background: "#FEF2F2", textAlign: "left", border: "none", lineHeight: 1.2 }}>Due</td>
                    <td style={{ padding: "1px 0", fontSize: 11, fontWeight: 800, color: PALETTE.red, background: "#FEF2F2", textAlign: "right", whiteSpace: "nowrap", border: "none", lineHeight: 1.2 }}>₹{data.due_amount}</td>
                  </tr>
                )}
              </tbody>
            </table>
            {Number(data.paid_amount || 0) > 0 && (
              <div style={{ fontSize: 9, marginTop: 2, color: PALETTE.muted, lineHeight: 1.2 }}>
                Received with thanks from <strong style={{ color: PALETTE.ink }}>{patientDisplayName(data)}</strong> a sum of Rs. {Number(data.paid_amount).toFixed(2)}/- ({numberToWords(Number(data.paid_amount))} Rupees)
              </div>
            )}
            {data.refund_amount > 0 && (
              <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed", marginTop: 4, borderTop: `1px solid ${PALETTE.line}` }}>
                <colgroup>
                  <col style={{ width: "70%" }} />
                  <col style={{ width: "30%" }} />
                </colgroup>
                <tbody>
                  <tr>
                    <td style={{ padding: "4px 0 1px", fontSize: 11, fontWeight: 700, color: PALETTE.orange, textAlign: "left", border: "none" }}>Refund Amount</td>
                    <td style={{ padding: "4px 0 1px", fontSize: 11, fontWeight: 700, color: PALETTE.orange, textAlign: "right", whiteSpace: "nowrap", border: "none" }}>₹{data.refund_amount}</td>
                  </tr>
                  <tr>
                    <td style={{ padding: "1px 0", fontSize: 10, color: PALETTE.muted, textAlign: "left", border: "none" }}>Refund Mode</td>
                    <td style={{ padding: "1px 0", fontSize: 10, color: PALETTE.muted, textAlign: "right", border: "none" }}>{data.refund_mode || "—"}</td>
                  </tr>
                  {data.refund_date && (
                    <tr>
                      <td style={{ padding: "1px 0", fontSize: 10, color: PALETTE.muted, textAlign: "left", border: "none" }}>Refund Date</td>
                      <td style={{ padding: "1px 0", fontSize: 10, color: PALETTE.muted, textAlign: "right", border: "none" }}>{format(new Date(data.refund_date), "dd-MM-yyyy hh:mm a")}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
            {cancelledTests.length > 0 && (
              <div style={{ fontSize: 9, color: PALETTE.muted, marginTop: 2 }}>
                Cancelled Tests: {cancelledTests.map((ct: any) => ct.test_name || ct.test_id).join(", ")}
              </div>
            )}
            {hvcRefund > 0 && (
              <div style={{ fontSize: 9, color: PALETTE.muted, marginTop: 1 }}>
                Home Visit Charges Refunded: ₹{hvcRefund}
              </div>
            )}
          </div>

          <div style={{ textAlign: "center", fontSize: 8, color: PALETTE.muted, marginTop: 3, lineHeight: 1.2 }}>
            <p style={{ margin: 0, fontWeight: 600, color: PALETTE.blue }}>Thank you for choosing PH PathLabs</p>
            <p style={{ margin: "1px 0 0", fontSize: 7 }}>This is an electronically generated receipt and does not require a signature</p>
          </div>
          <div style={{ height: 1, background: PALETTE.line, width: "100%", marginTop: 3 }} />
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 7, color: PALETTE.muted, marginTop: 2 }}>
            <div>Prepared by {data.registered_by || "—"} · {format(createdAt, "dd-MM-yyyy hh:mm a")}</div>
            <div>Printed by {getCurrentUserName() || "—"} · {format(new Date(), "dd-MM-yyyy hh:mm a")}</div>
          </div>
        </div>

        <div className="flex gap-2 mt-2 flex-wrap">
          {statusHint ? (
            <p className="w-full text-sm text-primary font-medium">{statusHint}</p>
          ) : null}
          {!hidePrint && (
            <Button className="flex-1" variant="outline" onClick={handlePrint}>
              <Printer className="h-4 w-4 mr-2" />Print
            </Button>
          )}
          {!isPickupInvoice(data) && (
            <Button
              className="flex-1"
              onClick={() => void queueInvoiceViaWaApi()}
              disabled={waSending || !data?.mobile_number}
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

export default InvoicePreview;
