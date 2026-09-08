import { useRef, useState, useEffect, useCallback, useLayoutEffect, type CSSProperties, type ReactNode } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Printer, Send, Loader2, CheckCircle2, Heart, Info } from "lucide-react";
import { format } from "date-fns";
import { toJpeg, getFontEmbedCSS } from "html-to-image";
import JsBarcode from "jsbarcode";
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
import { createShareLink } from "@/lib/reportShareLinks";
import { renderInvoiceQrPng } from "@/lib/invoiceQrPng";
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
  autoQueueWhatsApp?: boolean;
  hidePrint?: boolean;
  queueRequest?: InvoiceQueueToken | null;
  onReady?: (invoiceNumber: string) => void;
  onQueueSettled?: (result: { ok: boolean; error?: string; invoiceNumber?: string }) => void;
  statusHint?: string;
}

/** A5 @ ~96dpi — one pixel sheet for screen / WA / print clone parity. */
const A5_W = 560;
const A5_H = 794;

const PALETTE = {
  blue: "#2E3192",
  blueDark: "#23266F",
  blueSoft: "#F0F1FA",
  blueLine: "#D8DBF0",
  cyan: "#0EA5B7",
  red: "#E41E26",
  orange: "#F7941D",
  ink: "#111827",
  muted: "#6B7280",
  line: "#E5E7EB",
  soft: "#F8FAFC",
  white: "#FFFFFF",
  discount: "#059669",
};

const INVOICE_FONT =
  '"Noto Sans", "IBM Plex Sans", "Segoe UI", system-ui, sans-serif';

const INVOICE_FONT_CSS_HREF =
  "https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=Noto+Sans:wght@400;500;600;700&display=swap";

function invoiceLineAmount(t: any): number {
  return Number(t?.price || 0);
}

function invoiceLineNet(t: any): number {
  const net = t?.discounted_price ?? t?.discountedPrice;
  if (net !== undefined && net !== null && net !== "") return Number(net) || 0;
  return Number(t?.price || 0);
}

function invoiceLineDiscount(t: any): number {
  return Number(t?.discount || 0);
}

function paymentDateLabel(p: { date?: string; payment_date?: string; collected_at?: string } | null | undefined): string {
  const raw = p?.date || p?.payment_date || p?.collected_at;
  if (!raw) return "—";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return "—";
  return format(d, "dd-MM-yyyy hh:mm a");
}

function isInvoicePackageLine(t: any, packageTestsById: Map<string, string[]>): boolean {
  if (String(t?.item_type || "").toLowerCase() === "package") return true;
  const id = String(t?.test_id || "");
  if (id && packageTestsById.has(id)) return true;
  const nameKey = String(t?.test_name || "").trim().toLowerCase().replace(/\s+/g, " ");
  return !!(nameKey && packageTestsById.has(nameKey));
}

function sortInvoiceLines(lines: any[], packageTestsById: Map<string, string[]>): any[] {
  return [...lines].sort((a, b) => {
    const aPkg = isInvoicePackageLine(a, packageTestsById) ? 0 : 1;
    const bPkg = isInvoicePackageLine(b, packageTestsById) ? 0 : 1;
    if (aPkg !== bPkg) return aPkg - bPkg;
    return invoiceLineAmount(b) - invoiceLineAmount(a);
  });
}

function formatVisitType(vt: string | undefined) {
  if (!vt) return "";
  const map: Record<string, string> = {
    home_visit: "Home Visit",
    lab_visit: "Lab",
    pickup_point: "Pickup Point",
  };
  return map[vt] || vt.replace(/_/g, " ");
}

function paymentStatus(data: any): { label: string; tone: "paid" | "partial" | "due" | "cancelled" } {
  if (data?.bill_cancelled) return { label: "CANCELLED", tone: "cancelled" };
  const due = Number(data?.due_amount || 0);
  const paid = Number(data?.paid_amount || 0);
  if (due > 0 && paid > 0) return { label: "PARTIALLY PAID", tone: "partial" };
  if (due > 0) return { label: "DUE", tone: "due" };
  return { label: "PAID", tone: "paid" };
}

async function ensureInvoiceFontsReady(): Promise<void> {
  if (typeof document === "undefined" || !document.fonts) return;
  try {
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

void ensureInvoiceFontsReady();

function Field({
  label,
  value,
}: {
  label: string;
  value: ReactNode;
}) {
  return (
    <div style={{ marginBottom: 4, lineHeight: 1.25 }}>
      <div style={{ fontSize: 8, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: PALETTE.blue }}>{label}</div>
      <div style={{ fontSize: 11, fontWeight: 600, color: PALETTE.ink, wordBreak: "break-word" }}>{value || "—"}</div>
    </div>
  );
}

function MoneyRow({
  label,
  amount,
  emphasize,
  danger,
  discount,
}: {
  label: string;
  amount: string;
  emphasize?: boolean;
  danger?: boolean;
  discount?: boolean;
}) {
  const color = danger ? PALETTE.red : discount ? PALETTE.discount : PALETTE.ink;
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: 10,
        alignItems: "baseline",
        padding: emphasize ? "5px 0" : "2px 0",
        borderTop: emphasize ? `1px solid ${PALETTE.blueLine}` : undefined,
        marginTop: emphasize ? 4 : 0,
        fontSize: emphasize ? 12 : 10,
        fontWeight: emphasize ? 800 : 500,
        color,
        lineHeight: 1.3,
      }}
    >
      <span>{label}</span>
      <span style={{ whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{amount}</span>
    </div>
  );
}

const InvoicePreviewV2 = ({
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
  const sheetRef = useRef<HTMLDivElement>(null);
  const barcodeRef = useRef<HTMLCanvasElement>(null);
  const queuedInvoiceRef = useRef<string | null>(null);
  const autoQueuedRef = useRef<string | null>(null);
  const [brand, setBrand] = useState<Record<string, string>>(INVOICE_BRAND_DEFAULTS);
  const [logoSrc, setLogoSrc] = useState("");
  const [consoleQueued, setConsoleQueued] = useState(false);
  const [waSending, setWaSending] = useState(false);
  const [packageTestsById, setPackageTestsById] = useState<Map<string, string[]>>(new Map());
  const [packageNamesReady, setPackageNamesReady] = useState(false);
  const [fontsReady, setFontsReady] = useState(false);
  const [brandReady, setBrandReady] = useState(false);
  const [qrPng, setQrPng] = useState("");
  const [sheetScale, setSheetScale] = useState(1);

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
      setQrPng("");
      setSheetScale(1);
      return;
    }
    const invoiceNo = String(data?.invoice_number || "").trim();
    setConsoleQueued(queuedInvoiceRef.current === invoiceNo);
    setPackageNamesReady(false);
    setFontsReady(false);
    setBrandReady(false);
    setLogoSrc("");
    setQrPng("");
    let cancelled = false;
    let fontsOk = false;
    let packagesOk = false;
    let brandOk = false;
    const maybeReady = () => {
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
        const bundle = await getInvoiceBrandCached();
        if (cancelled) return bundle;
        setBrand(bundle.brand);
        setLogoSrc(bundle.logoSrc || bundle.brand.invoice_logo_url || "");
        return bundle;
      })();
      const qrPromise = (async () => {
        try {
          if (!data?.id || !invoiceNo) return;
          const created = await createShareLink(data.id, invoiceNo, getCurrentUserName() || "invoice");
          const png = await renderInvoiceQrPng(created.url, 140);
          if (!cancelled) setQrPng(png);
        } catch (e) {
          console.warn("invoice report QR failed", e);
          if (!cancelled) setQrPng("");
        }
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
      await qrPromise;
    })();
    return () => {
      cancelled = true;
    };
  }, [open, data?.invoice_number, data?.id]);

  const renderBarcode = useCallback(() => {
    if (!barcodeRef.current || !data?.umr_number) return false;
    try {
      JsBarcode(barcodeRef.current, data.umr_number, {
        format: "CODE128",
        height: 28,
        width: 1.15,
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
    const timer = setTimeout(() => renderBarcode(), 50);
    return () => clearTimeout(timer);
  }, [open, data?.umr_number, fontsReady, renderBarcode]);

  useLayoutEffect(() => {
    if (!open || !sheetRef.current) return;
    const el = sheetRef.current;
    const fit = () => {
      const h = el.scrollHeight;
      if (h <= A5_H) {
        setSheetScale(1);
        el.style.transform = "none";
        el.style.width = "100%";
        return;
      }
      const scale = Math.max(0.42, A5_H / h);
      setSheetScale(scale);
      el.style.transformOrigin = "top left";
      el.style.transform = `scale(${scale})`;
      el.style.width = `${100 / scale}%`;
    };
    fit();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => fit()) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [open, data, packageTestsById, brandReady, fontsReady, qrPng]);

  const isPickupInvoice = useCallback((row: any) => {
    if (!row) return false;
    if (row.visit_type === "pickup_point") return true;
    if (row.pickup_point_id) return true;
    return false;
  }, []);

  const prepareCloneForCapture = useCallback(() => {
    const source = receiptRef.current;
    if (!source) return null;
    renderBarcode();
    const clone = source.cloneNode(true) as HTMLElement;
    clone.style.margin = "0";
    clone.style.borderRadius = "0";
    clone.style.boxShadow = "none";
    clone.style.width = `${A5_W}px`;
    clone.style.maxWidth = `${A5_W}px`;
    clone.style.background = "#ffffff";
    clone.style.color = PALETTE.ink;
    clone.style.fontFamily = INVOICE_FONT;

    const srcCanvas = barcodeRef.current;
    const cloneCanvas = clone.querySelector("canvas");
    if (srcCanvas && cloneCanvas && srcCanvas.width > 0) {
      const img = document.createElement("img");
      img.src = srcCanvas.toDataURL("image/png");
      img.alt = "";
      img.style.cssText =
        cloneCanvas.getAttribute("style") ||
        "display:inline-block;max-width:100%;height:28px;vertical-align:middle";
      cloneCanvas.replaceWith(img);
    } else if (cloneCanvas) {
      cloneCanvas.remove();
    }
    return { source, clone };
  }, [renderBarcode]);

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
    if (!brandReady) {
      toast.error("Invoice header still loading — try again in a moment");
      settle(false, "brand not ready");
      return;
    }
    setWaSending(true);
    const host = document.createElement("div");
    try {
      await new Promise((r) => setTimeout(r, 80));
      const prepared = prepareCloneForCapture();
      if (!prepared) {
        toast.error("Invoice not ready yet");
        settle(false, "not ready");
        return;
      }
      const { source, clone } = prepared;
      host.setAttribute("data-invoice-wa-capture", "1");
      host.style.cssText =
        `position:fixed;left:-10000px;top:0;width:${A5_W}px;background:#ffffff;z-index:-1;pointer-events:none;`;
      host.appendChild(clone);
      document.body.appendChild(host);

      await waitForImagesIn(source);
      await waitForImagesIn(clone);
      await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
      await ensureInvoiceFontsReady();
      let fontEmbedCSS = "";
      try {
        fontEmbedCSS = await getFontEmbedCSS(clone);
      } catch {
        fontEmbedCSS = "";
      }

      const width = A5_W;
      const height = Math.max(clone.scrollHeight, clone.offsetHeight, 1);
      let dataUrl = "";
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          dataUrl = await toJpeg(clone, {
            quality: 0.95,
            pixelRatio: 2,
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
          // retry
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
        `Amount: ₹${data.final_amount ?? activeFinalSafe(data)}`;
      const res = await enqueueInvoiceForWhatsAppConsole({
        phone: data.mobile_number,
        caption,
        imageBlob: blob,
        fileName: `invoice-${invoiceNo}.jpg`,
        invoiceNumber: invoiceNo,
        patientName: patientLabel,
      });
      if (!res.ok) {
        toast.error(res.error || "Failed to queue invoice for WhatsApp");
        settle(false, res.error || "queue");
        return;
      }
      queuedInvoiceRef.current = invoiceNo;
      setConsoleQueued(true);
      toast.success("Invoice queued to WhatsApp Console");
      settle(true);
    } catch (e: any) {
      toast.error(e?.message || "WhatsApp send failed");
      settle(false, e?.message || "error");
    } finally {
      host.remove();
      setWaSending(false);
    }
  }, [open, data, brandReady, brand, isPickupInvoice, prepareCloneForCapture, onQueueSettled]);

  // Auto / parent-driven queue — same gates as legacy
  useEffect(() => {
    if (!open || !data || !fontsReady || !packageNamesReady || !brandReady) return;
    const invoiceNo = String(data.invoice_number || "");
    if (!invoiceNo) return;
    if (autoQueueWhatsApp && autoQueuedRef.current !== invoiceNo && !isPickupInvoice(data)) {
      autoQueuedRef.current = invoiceNo;
      void queueInvoiceViaWaApi();
    }
  }, [open, data, fontsReady, packageNamesReady, brandReady, autoQueueWhatsApp, isPickupInvoice, queueInvoiceViaWaApi]);

  useEffect(() => {
    if (!open || !queueRequest || !data) return;
    if (!shouldFireBoundInvoiceQueue(queueRequest, String(data.invoice_number || ""))) return;
    if (!fontsReady || !packageNamesReady || !brandReady) return;
    void queueInvoiceViaWaApi();
  }, [open, queueRequest, data, fontsReady, packageNamesReady, brandReady, queueInvoiceViaWaApi]);

  const handlePrint = useCallback(async () => {
    const prepared = prepareCloneForCapture();
    if (!prepared) {
      toast.error("Invoice not ready yet");
      return;
    }
    const { clone } = prepared;
    // Reset on-screen fit-scale so the print iframe can scale once for A5.
    clone.querySelectorAll('[id="invoice-sheet"]').forEach((el) => {
      const node = el as HTMLElement;
      node.style.transform = "none";
      node.style.width = "100%";
    });
    await waitForImagesIn(clone);
    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      toast.error("Popup blocked — allow popups to print");
      return;
    }
    const html = `<!DOCTYPE html><html><head><title>Invoice ${data?.invoice_number || ""}</title>
      <link rel="stylesheet" href="${INVOICE_FONT_CSS_HREF}" />
      <style>
        @page { size: A5 portrait; margin: 8mm 10mm; }
        * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; box-sizing: border-box; }
        html, body { margin: 0; padding: 0; background: #fff; }
        body { font-family: ${INVOICE_FONT}; color: ${PALETTE.ink}; }
        #invoice-page { width: 128mm; height: 194mm; overflow: hidden; margin: 0 auto; }
        #invoice-sheet { width: 100%; transform-origin: top left; }
      </style></head><body>
      <div id="invoice-page"><div id="invoice-sheet">${clone.innerHTML}</div></div>
      <script>
        (function(){
          function fit(){
            var page = document.getElementById('invoice-page');
            var sheet = document.getElementById('invoice-sheet');
            if(!page||!sheet) return;
            var maxH = page.clientHeight || 1;
            var h = sheet.scrollHeight || 1;
            if(h > maxH){
              var s = Math.max(0.42, maxH / h);
              sheet.style.transform = 'scale(' + s + ')';
              sheet.style.width = (100 / s) + '%';
            }
          }
          fit();
          setTimeout(function(){ fit(); window.focus(); window.print(); }, 250);
        })();
      </script>
      </body></html>`;
    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
  }, [prepareCloneForCapture, data?.invoice_number]);

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
  const activeGross = tests.reduce((sum: number, t: any) => sum + invoiceLineAmount(t), 0);
  const activeNet = tests.reduce((sum: number, t: any) => sum + invoiceLineNet(t), 0);
  const activeDiscount = activeGross - activeNet;
  const hvc = Number(data.home_visit_charges || 0);
  const activeFinal = activeNet + hvc;
  const hvcRefund = computeHvcRefundAmount(data);
  const hasAnyDiscount = tests.some((t: any) => Number(t.discount || 0) > 0);
  const labVisible = brand.invoice_lab_name_visible !== "false";
  const visitLabel = formatVisitType(data.visit_type);
  const ageDisplay = formatPatientAge(data);
  const status = paymentStatus(data);
  const paidAmt = Number(data.paid_amount || 0);
  const dueAmt = Number(data.due_amount || 0);
  const ready = fontsReady && brandReady && packageNamesReady;

  const includedTestsLine = (t: any) =>
    formatPackageIncludedTests(
      packageTestsById.get(String(t?.test_id || ""))
      || packageTestsById.get(String(t?.test_name || "").trim().toLowerCase().replace(/\s+/g, " ")),
    );

  const statusBg =
    status.tone === "paid" ? "#ECFDF5"
    : status.tone === "partial" ? "#EFF6FF"
    : status.tone === "cancelled" ? "#FEF2F2"
    : "#FEF2F2";
  const statusFg =
    status.tone === "paid" ? PALETTE.discount
    : status.tone === "partial" ? PALETTE.blue
    : PALETTE.red;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-[620px] max-h-[95vh] overflow-y-auto p-3 sm:p-4">
        <DialogHeader>
          <DialogTitle className="text-base">
            Invoice Generated — {data.invoice_number}
          </DialogTitle>
        </DialogHeader>

        {!ready && (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading invoice…
          </div>
        )}

        <div
          ref={receiptRef}
          style={{
            width: A5_W,
            maxWidth: "100%",
            margin: "0 auto",
            background: PALETTE.white,
            color: PALETTE.ink,
            fontFamily: INVOICE_FONT,
            visibility: ready ? "visible" : "hidden",
            height: ready ? "auto" : 0,
            overflow: ready ? "visible" : "hidden",
          }}
        >
          <div
            style={{
              width: A5_W,
              height: A5_H,
              overflow: "hidden",
              background: PALETTE.white,
              border: `1px solid ${PALETTE.line}`,
            }}
          >
            <div ref={sheetRef} id="invoice-sheet" style={{ width: "100%", padding: "14px 16px 10px" }}>
              {/* Header */}
              <div style={{ display: "flex", gap: 12, alignItems: "flex-start", marginBottom: 8 }}>
                <div style={{ flex: "0 0 auto", textAlign: (brand.invoice_logo_align as any) || "left" }}>
                  {(logoSrc || brand.invoice_logo_url) ? (
                    <img
                      src={logoSrc || brand.invoice_logo_url}
                      alt="logo"
                      style={{ maxHeight: 48, maxWidth: 150, objectFit: "contain", display: "block" }}
                    />
                  ) : labVisible ? (
                    <div style={{ fontSize: 18, fontWeight: 800, color: PALETTE.blue, lineHeight: 1.1 }}>
                      {brand.invoice_lab_name || "PH PathLabs"}
                    </div>
                  ) : null}
                  {labVisible && (logoSrc || brand.invoice_logo_url) && (
                    <div style={{ fontSize: 11, fontWeight: 800, color: PALETTE.blue, marginTop: 2, lineHeight: 1.15 }}>
                      {brand.invoice_lab_name || "PH PathLabs"}
                    </div>
                  )}
                  {brand.invoice_tagline && brand.invoice_tagline !== "Invoice / Sample Receipt" && (
                    <div style={{ fontSize: 8, color: PALETTE.muted, marginTop: 2, letterSpacing: "0.02em" }}>
                      {brand.invoice_tagline}
                    </div>
                  )}
                </div>
                <div style={{ flex: 1, textAlign: "right", fontSize: 9, color: PALETTE.muted, lineHeight: 1.35 }}>
                  {brand.invoice_contact && <div style={{ fontWeight: 600, color: PALETTE.ink }}>{brand.invoice_contact}</div>}
                  {brand.invoice_address && (
                    <div style={{ whiteSpace: "pre-line", marginTop: 2 }}>{brand.invoice_address}</div>
                  )}
                </div>
              </div>

              {/* Meta strip */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1.1fr 1.2fr 1fr",
                  gap: 8,
                  background: PALETTE.blueSoft,
                  border: `1px solid ${PALETTE.blueLine}`,
                  borderRadius: 8,
                  padding: "8px 10px",
                  marginBottom: 8,
                }}
              >
                <div>
                  <div style={{ fontSize: 8, fontWeight: 700, color: PALETTE.blue, textTransform: "uppercase" }}>Invoice No.</div>
                  <div style={{ fontSize: 12, fontWeight: 800, color: PALETTE.ink }}>{data.invoice_number}</div>
                </div>
                <div>
                  <div style={{ fontSize: 8, fontWeight: 700, color: PALETTE.blue, textTransform: "uppercase" }}>Invoice Date & Time</div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: PALETTE.ink }}>
                    {format(createdAt, "dd MMM yyyy")} · {format(createdAt, "hh:mm a")}
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  {visitLabel && (
                    <span
                      style={{
                        display: "inline-block",
                        background: PALETTE.white,
                        color: PALETTE.blue,
                        border: `1px solid ${PALETTE.blueLine}`,
                        fontSize: 8,
                        fontWeight: 700,
                        padding: "2px 8px",
                        borderRadius: 999,
                        textTransform: "uppercase",
                      }}
                    >
                      {visitLabel}
                    </span>
                  )}
                  <div style={{ marginTop: 4 }}>
                    <canvas ref={barcodeRef} style={{ display: data.umr_number ? "inline-block" : "none", maxWidth: "100%", height: 28 }} />
                  </div>
                  {data.umr_number && (
                    <div style={{ fontSize: 9, fontWeight: 700, color: PALETTE.ink, marginTop: 1 }}>{data.umr_number}</div>
                  )}
                </div>
              </div>

              {/* Patient + Generated By */}
              <div style={{ display: "grid", gridTemplateColumns: "1.4fr 0.9fr", gap: 8, marginBottom: 8 }}>
                <div style={{ background: PALETTE.soft, border: `1px solid ${PALETTE.line}`, borderRadius: 8, padding: "8px 10px" }}>
                  <div style={{ fontSize: 9, fontWeight: 800, color: PALETTE.blue, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                    Patient Details
                  </div>
                  <Field label="Name" value={patientDisplayName(data)} />
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                    <Field label="UMR / Patient ID" value={data.umr_number || "—"} />
                    <Field label="Age / Gender" value={[ageDisplay, data.gender].filter(Boolean).join(" · ") || "—"} />
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                    <Field label="Mobile No." value={data.mobile_number || "—"} />
                    <Field label="Referring Doctor" value={data.doctor_name || "SELF"} />
                  </div>
                </div>
                <div style={{ background: PALETTE.soft, border: `1px solid ${PALETTE.line}`, borderRadius: 8, padding: "8px 10px" }}>
                  <div style={{ fontSize: 9, fontWeight: 800, color: PALETTE.blue, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                    Visit Details
                  </div>
                  <Field label="Generated By" value={data.registered_by || "—"} />
                </div>
              </div>

              {/* Body: tests + sidebar */}
              <div style={{ display: "grid", gridTemplateColumns: "1.55fr 1fr", gap: 8, alignItems: "start" }}>
                <div>
                  <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
                    <thead>
                      <tr style={{ background: PALETTE.blueSoft }}>
                        <th style={thStyle(28)}>#</th>
                        <th style={{ ...thStyle(), textAlign: "left" }}>Test / Investigation</th>
                        {hasAnyDiscount ? (
                          <>
                            <th style={thStyle(58)}>Price</th>
                            <th style={thStyle(52)}>Disc</th>
                            <th style={thStyle(58)}>Net</th>
                          </>
                        ) : (
                          <th style={thStyle(72)}>Amount</th>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {tests.map((t: any, i: number) => {
                        const included = includedTestsLine(t);
                        return (
                          <tr key={i}>
                            <td style={tdStyle(true)}>{i + 1}</td>
                            <td style={{ ...tdStyle(), textAlign: "left", fontWeight: 600, whiteSpace: "normal", wordBreak: "break-word" }}>
                              {t.test_name}
                              {included ? (
                                <div style={{ fontSize: 8, fontStyle: "italic", fontWeight: 400, color: PALETTE.muted, marginTop: 1 }}>
                                  {included}
                                </div>
                              ) : null}
                            </td>
                            {hasAnyDiscount ? (
                              <>
                                <td style={tdStyle(true)}>₹{t.price}</td>
                                <td style={{ ...tdStyle(true), color: PALETTE.discount }}>
                                  {Number(t.discount || 0) > 0 ? `-₹${t.discount}` : "—"}
                                </td>
                                <td style={{ ...tdStyle(true), fontWeight: 700 }}>₹{invoiceLineNet(t)}</td>
                              </>
                            ) : (
                              <td style={{ ...tdStyle(true), fontWeight: 700 }}>₹{t.price}</td>
                            )}
                          </tr>
                        );
                      })}
                      {tests.length > 0 && (
                        <tr>
                          <td colSpan={2} style={{ ...tdStyle(), fontWeight: 800, borderTop: `2px solid ${PALETTE.blue}` }}>
                            Total ({tests.length})
                          </td>
                          {hasAnyDiscount ? (
                            <>
                              <td style={{ ...tdStyle(true), fontWeight: 800, borderTop: `2px solid ${PALETTE.blue}` }}>₹{activeGross}</td>
                              <td style={{ ...tdStyle(true), fontWeight: 800, color: PALETTE.discount, borderTop: `2px solid ${PALETTE.blue}` }}>
                                {activeDiscount > 0 ? `-₹${activeDiscount}` : "—"}
                              </td>
                              <td style={{ ...tdStyle(true), fontWeight: 800, borderTop: `2px solid ${PALETTE.blue}` }}>₹{activeNet}</td>
                            </>
                          ) : (
                            <td style={{ ...tdStyle(true), fontWeight: 800, borderTop: `2px solid ${PALETTE.blue}` }}>₹{activeGross}</td>
                          )}
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ background: PALETTE.blueSoft, border: `1px solid ${PALETTE.blueLine}`, borderRadius: 8, padding: "8px 10px" }}>
                    <div style={{ fontSize: 9, fontWeight: 800, color: PALETTE.blue, marginBottom: 4, textTransform: "uppercase" }}>
                      Payment Summary
                    </div>
                    <MoneyRow label="Gross Amount" amount={`₹${activeGross}`} />
                    {activeDiscount > 0 && (
                      <MoneyRow label="Total Discount" amount={`-₹${activeDiscount}`} discount />
                    )}
                    {hvc > 0 && (
                      <MoneyRow label="Home Visit Charges" amount={`+₹${hvc}`} />
                    )}
                    <MoneyRow label="Net Payable" amount={`₹${activeFinal}`} emphasize />
                    <MoneyRow label="Paid Amount" amount={`₹${paidAmt}`} />
                    {dueAmt > 0 && (
                      <MoneyRow label="Balance Due" amount={`₹${dueAmt}`} danger />
                    )}
                    <div
                      style={{
                        marginTop: 6,
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                        background: statusBg,
                        color: statusFg,
                        borderRadius: 999,
                        padding: "3px 8px",
                        fontSize: 9,
                        fontWeight: 800,
                      }}
                    >
                      <CheckCircle2 style={{ width: 11, height: 11 }} />
                      {status.label}
                      {dueAmt > 0 && status.tone === "partial" ? ` · Due ₹${dueAmt}` : ""}
                    </div>
                  </div>

                  <div style={{ border: `1px solid ${PALETTE.line}`, borderRadius: 8, padding: "6px 8px" }}>
                    <div style={{ fontSize: 9, fontWeight: 800, color: PALETTE.blue, marginBottom: 4, textTransform: "uppercase" }}>
                      Payment Details
                    </div>
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                      <thead>
                        <tr>
                          <th style={{ ...thStyle(), textAlign: "left", fontSize: 8 }}>Date & Time</th>
                          <th style={{ ...thStyle(), textAlign: "left", fontSize: 8 }}>Mode</th>
                          <th style={{ ...thStyle(), textAlign: "right", fontSize: 8 }}>Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {payments.length === 0 ? (
                          <tr>
                            <td colSpan={3} style={{ ...tdStyle(), textAlign: "left", color: PALETTE.muted }}>No payments</td>
                          </tr>
                        ) : (
                          payments.map((p: any, i: number) => (
                            <tr key={i}>
                              <td style={{ ...tdStyle(), textAlign: "left", fontSize: 8 }}>{paymentDateLabel(p)}</td>
                              <td style={{ ...tdStyle(), textAlign: "left", fontSize: 9 }}>{p.mode || "Payment"}</td>
                              <td style={{ ...tdStyle(true), fontSize: 9 }}>₹{p.amount}</td>
                            </tr>
                          ))
                        )}
                        <tr>
                          <td colSpan={2} style={{ ...tdStyle(), textAlign: "left", fontWeight: 800, borderTop: `1px solid ${PALETTE.line}` }}>
                            Total Paid
                          </td>
                          <td style={{ ...tdStyle(true), fontWeight: 800, borderTop: `1px solid ${PALETTE.line}` }}>₹{paidAmt}</td>
                        </tr>
                      </tbody>
                    </table>
                    {Number(data.refund_amount || 0) > 0 && (
                      <div style={{ marginTop: 6, fontSize: 9, color: PALETTE.orange }}>
                        <div style={{ fontWeight: 700 }}>Refund Amount: ₹{data.refund_amount}</div>
                        <div>Mode: {data.refund_mode || "—"}</div>
                        {data.refund_date && (
                          <div>Date: {format(new Date(data.refund_date), "dd-MM-yyyy hh:mm a")}</div>
                        )}
                        {hvcRefund > 0 && (
                          <div style={{ color: PALETTE.muted }}>Home Visit Charges Refunded: ₹{hvcRefund}</div>
                        )}
                      </div>
                    )}
                  </div>

                  {qrPng && (
                    <div style={{ textAlign: "center", border: `1px solid ${PALETTE.line}`, borderRadius: 8, padding: 8 }}>
                      <img src={qrPng} alt="Report QR" style={{ width: 88, height: 88, margin: "0 auto", display: "block" }} />
                      <div style={{ fontSize: 8, color: PALETTE.muted, marginTop: 4, lineHeight: 1.25 }}>
                        Scan to view / download reports
                      </div>
                    </div>
                  )}

                  <div style={{ display: "flex", gap: 6, alignItems: "flex-start", fontSize: 8, color: PALETTE.muted, lineHeight: 1.3 }}>
                    <Heart style={{ width: 12, height: 12, color: PALETTE.red, flexShrink: 0, marginTop: 1 }} />
                    <span>Thank you for choosing {brand.invoice_lab_name || "PH PathLabs"}. We are committed to your health and well-being.</span>
                  </div>
                </div>
              </div>

              {/* Notes + trust */}
              <div style={{ marginTop: 8, displayTop: `1px solid ${PALETTE.line}`, paddingTop: 6 }}>
                <div style={{ display: "flex", gap: 6, alignItems: "flex-start", marginBottom: 6 }}>
                  <Info style={{ width: 12, height: 12, color: PALETTE.blue, flexShrink: 0, marginTop: 1 }} />
                  <div style={{ fontSize: 8, color: PALETTE.muted, lineHeight: 1.35 }}>
                    <div style={{ fontWeight: 700, color: PALETTE.blue, marginBottom: 2 }}>Important Notes</div>
                    <div>• Please retain this invoice for your records and future reference.</div>
                    <div>• Reports are available via the secure link / QR once approved and dispatched.</div>
                    <div>• For queries contact {brand.invoice_contact || "the lab"}.</div>
                  </div>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 8, color: PALETTE.blue, fontWeight: 700 }}>
                  <span>Accurate Results</span>
                  <span>Trusted by Doctors</span>
                  <span>Caring for You</span>
                </div>
              </div>

              <div
                style={{
                  marginTop: 6,
                  borderTop: `1px solid ${PALETTE.line}`,
                  paddingTop: 4,
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 8,
                  fontSize: 8,
                  color: PALETTE.muted,
                  lineHeight: 1.25,
                }}
              >
                <div>
                  Prepared by {data.registered_by || "—"} · {format(createdAt, "dd-MM-yyyy hh:mm a")}
                </div>
                <div>
                  Printed by {getCurrentUserName() || "—"} · {format(new Date(), "dd-MM-yyyy hh:mm a")}
                  {sheetScale < 0.999 ? ` · fit ${Math.round(sheetScale * 100)}%` : ""}
                </div>
              </div>
            </div>
          </div>
        </div>

        {statusHint && (
          <p className="text-xs text-muted-foreground mt-2">{statusHint}</p>
        )}

        <div className="flex gap-2 mt-3 flex-wrap">
          {!hidePrint && (
            <Button className="flex-1" variant="outline" onClick={handlePrint} disabled={!ready}>
              <Printer className="h-4 w-4 mr-2" /> Print
            </Button>
          )}
          <Button
            className="flex-1"
            onClick={() => void queueInvoiceViaWaApi()}
            disabled={!ready || waSending || isPickupInvoice(data)}
          >
            {waSending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
            {consoleQueued ? "Queued" : "WhatsApp"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

function thStyle(width?: number): CSSProperties {
  return {
    padding: "5px 4px",
    fontSize: 9,
    fontWeight: 700,
    letterSpacing: "0.03em",
    textTransform: "uppercase",
    color: PALETTE.blue,
    borderBottom: `2px solid ${PALETTE.blue}`,
    textAlign: "right",
    whiteSpace: "nowrap",
    width: width ? `${width}px` : undefined,
  };
}

function tdStyle(right?: boolean): CSSProperties {
  return {
    padding: "4px 4px",
    fontSize: 10,
    color: PALETTE.ink,
    borderBottom: `1px solid ${PALETTE.line}`,
    textAlign: right ? "right" : "center",
    whiteSpace: "nowrap",
    verticalAlign: "top",
    lineHeight: 1.25,
    fontVariantNumeric: "tabular-nums",
  };
}

function activeFinalSafe(data: any): number {
  const tests = Array.isArray(data?.tests) ? data.tests : [];
  const cancelled = new Set(
    (Array.isArray(data?.cancelled_tests) ? data.cancelled_tests : []).map((ct: any) => ct.test_id),
  );
  const net = tests
    .filter((t: any) => !cancelled.has(t.test_id))
    .reduce((sum: number, t: any) => sum + invoiceLineNet(t), 0);
  return net + Number(data?.home_visit_charges || 0);
}

export default InvoicePreviewV2;
