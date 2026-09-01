import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Download, X, Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import jsPDF from "jspdf";
import { toJpeg, getFontEmbedCSS } from "html-to-image";
import { getInvoiceItems, getInvoiceLedger, amountInWords, type PickupInvoice } from "@/lib/pickupBilling";
import { getCurrentUserName } from "@/lib/auth";
import { enqueueReportForWhatsAppConsole } from "@/lib/whatsappConsoleBridge";

/** A4 at 96dpi — preview width matches capture width. */
const A4_WIDTH_MM = 210;
const A4_HEIGHT_MM = 297;
const MM_TO_PX = 96 / 25.4;
const A4_WIDTH_PX = Math.round(A4_WIDTH_MM * MM_TO_PX);
const A4_HEIGHT_PX = Math.round(A4_HEIGHT_MM * MM_TO_PX);
const PAGE_PADDING_TOP_MM = 10;
const PAGE_PADDING_BOTTOM_MM = 14;
const PAGE_CHROME_FOOTER_MM = 12;
/** First invoice page table top margin (must be subtracted from pack budget). */
const TABLE_FIRST_MARGIN_TOP_PX = 12;
/** Leave slack so the next row never peeks as a clipped sliver under overflow:hidden. */
const PACK_SAFETY_PX = 40;
const CONTENT_HEIGHT_PX = Math.round(
  (A4_HEIGHT_MM - PAGE_PADDING_TOP_MM - PAGE_PADDING_BOTTOM_MM - PAGE_CHROME_FOOTER_MM) * MM_TO_PX,
);

const INVOICE_FONT =
  '"Noto Sans", "IBM Plex Sans", "Segoe UI", system-ui, sans-serif';
const INVOICE_FONT_CSS =
  "https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=Noto+Sans:wght@400;500;600;700&display=swap";
const BRAND = "#2E3192";
const HEADER_BG = "#F0F1FA";

const th: CSSProperties = {
  padding: "8px 6px",
  textAlign: "left",
  border: "1px solid #d4d6e8",
  fontSize: 12,
  fontWeight: 700,
  verticalAlign: "middle",
  color: BRAND,
  background: HEADER_BG,
};
const td: CSSProperties = {
  padding: "8px 6px",
  border: "1px solid #e5e7eb",
  verticalAlign: "top",
  fontSize: 12,
};

const SETTING_KEYS = [
  "invoice_lab_name",
  "invoice_address",
  "invoice_contact",
  "invoice_logo_url",
  "bank_account_name",
  "bank_account_number",
  "bank_name",
  "bank_branch",
  "bank_ifsc",
  "bank_micr",
  "bank_pan",
  "pickup_invoice_default_reminder_days",
  "pickup_invoice_declaration",
];

const paperStyle = (extra?: CSSProperties): CSSProperties => ({
  width: `${A4_WIDTH_MM}mm`,
  height: `${A4_HEIGHT_MM}mm`,
  margin: "0 auto",
  padding: `${PAGE_PADDING_TOP_MM}mm 12mm ${PAGE_PADDING_BOTTOM_MM}mm`,
  background: "#ffffff",
  color: "#111",
  fontFamily: INVOICE_FONT,
  fontSize: 13,
  boxSizing: "border-box",
  overflow: "hidden",
  boxShadow: "0 1px 4px rgba(0,0,0,0.12)",
  display: "flex",
  flexDirection: "column",
  ...extra,
});

const formatInr = (n: number) =>
  `\u20b9${Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

async function ensureRupeeFontsReady(): Promise<void> {
  if (typeof document === "undefined" || !document.fonts) return;
  try {
    if (!document.querySelector('link[data-pickup-invoice-fonts="1"]')) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = INVOICE_FONT_CSS;
      link.setAttribute("data-pickup-invoice-fonts", "1");
      document.head.appendChild(link);
    }
    await document.fonts.ready;
    const specs = [
      '400 12px "Noto Sans"',
      '700 12px "Noto Sans"',
      '400 12px "IBM Plex Sans"',
      '700 12px "IBM Plex Sans"',
    ];
    await Promise.all(specs.map((spec) => document.fonts.load(spec, "\u20b9").catch(() => undefined)));
    for (let i = 0; i < 40; i++) {
      if (
        document.fonts.check('400 12px "Noto Sans"', "\u20b9") ||
        document.fonts.check('400 12px "IBM Plex Sans"', "\u20b9")
      ) {
        return;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
  } catch {
    // non-fatal
  }
}

const waitForImages = async (root: HTMLElement) => {
  const imgs = Array.from(root.querySelectorAll("img"));
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
};

interface InvoiceItemRow {
  id?: string;
  registration_date: string | null;
  registration_invoice: string | null;
  patient_name: string | null;
  test_names: string | null;
  net_amount: number;
}

interface LedgerRow {
  date: string;
  voucher_type: string;
  voucher_no: string;
  debit: number;
  credit: number;
  balance: number;
}

interface PickupPoint {
  name: string;
  address?: string | null;
  contact_person?: string | null;
  phone?: string | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  invoice: PickupInvoice | null;
  /** When true, build PDF after layout and queue WhatsApp Console delivery, then close. */
  autoQueueWhatsApp?: boolean;
}

/** Pack row indices into pages; never split a row across pages. */
function packRowIndices(
  rowHeights: number[],
  firstBudget: number,
  contBudget: number,
  footerReserve = 0,
): number[][] {
  if (rowHeights.length === 0) return [[]];

  const pages: number[][] = [];
  let idx = 0;

  while (idx < rowHeights.length) {
    const isFirstPage = pages.length === 0;
    const baseBudget = Math.max(0, (isFirstPage ? firstBudget : contBudget) - PACK_SAFETY_PX);
    const page: number[] = [];
    let used = 0;

    while (idx < rowHeights.length) {
      const h = rowHeights[idx];
      const rowsAfterThis = rowHeights.length - idx - 1;
      const footerOnThisPage = rowsAfterThis === 0 ? footerReserve : 0;
      const effectiveBudget = baseBudget - footerOnThisPage;

      if (page.length > 0 && used + h > effectiveBudget) break;
      if (page.length === 0 && h > effectiveBudget) {
        // Row taller than one page — keep whole row on its own page.
        page.push(idx);
        idx++;
        break;
      }
      if (used + h > effectiveBudget) break;

      page.push(idx);
      used += h;
      idx++;
    }

    pages.push(page);
  }

  return pages;
}

function ItemsTableColgroup() {
  return (
    <colgroup>
      <col style={{ width: "4%" }} />
      <col style={{ width: "14%" }} />
      <col style={{ width: "14%" }} />
      <col style={{ width: "22%" }} />
      <col style={{ width: "34%" }} />
      <col style={{ width: "12%" }} />
    </colgroup>
  );
}

function ItemsTableHead() {
  return (
    <thead>
      <tr style={{ background: HEADER_BG, color: BRAND }}>
        <th style={th}>#</th>
        <th style={{ ...th, whiteSpace: "nowrap" }}>Reg. Date</th>
        <th style={th}>Invoice No</th>
        <th style={th}>Patient Name</th>
        <th style={th}>Tests</th>
        <th style={{ ...th, textAlign: "right", whiteSpace: "nowrap" }}>Amount ({`\u20b9`})</th>
      </tr>
    </thead>
  );
}

function formatTestNames(raw: string | null) {
  if (!raw) return null;
  const parts = raw
    .split(/\s*,\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;
  return parts.map((name, i) => (
    <span key={`${i}-${name}`}>
      {i > 0 ? ", " : null}
      <span style={{ whiteSpace: "nowrap" }}>{name}</span>
    </span>
  ));
}

function ItemDataRow({ item, index }: { item: InvoiceItemRow; index: number }) {
  return (
    <tr style={{ background: index % 2 ? "#fafafa" : "#fff", verticalAlign: "top" }}>
      <td style={td}>{index + 1}</td>
      <td style={{ ...td, whiteSpace: "nowrap" }}>
        {item.registration_date ? format(new Date(item.registration_date), "dd-MM-yyyy") : ""}
      </td>
      <td style={{ ...td, wordBreak: "break-word" }}>{item.registration_invoice}</td>
      <td style={{ ...td, whiteSpace: "normal", wordBreak: "break-word", lineHeight: 1.35 }}>
        {item.patient_name}
      </td>
      <td
        style={{
          ...td,
          fontSize: 11,
          whiteSpace: "normal",
          wordBreak: "normal",
          overflowWrap: "normal",
          lineHeight: 1.4,
        }}
      >
        {formatTestNames(item.test_names)}
      </td>
      <td style={{ ...td, textAlign: "right", whiteSpace: "nowrap" }}>
        {Number(item.net_amount).toFixed(2)}
      </td>
    </tr>
  );
}

function PageChromeFooter({
  page,
  totalPages,
  preparedBy,
  preparedAt,
}: {
  page: number;
  totalPages: number;
  preparedBy: string;
  preparedAt: string;
}) {
  return (
    <div
      style={{
        marginTop: "auto",
        paddingTop: 10,
        borderTop: "1px solid #ddd",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 12,
        fontSize: 10,
        color: "#555",
        lineHeight: 1.35,
      }}
    >
      <span style={{ flex: 1 }}>
        Prepared by {preparedBy} · {preparedAt}
      </span>
      <span style={{ whiteSpace: "nowrap", fontWeight: 600 }}>
        Page {page} of {totalPages}
      </span>
    </div>
  );
}

const PickupInvoicePDF = ({ open, onClose, invoice, autoQueueWhatsApp = false }: Props) => {
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [pickup, setPickup] = useState<PickupPoint | null>(null);
  const [items, setItems] = useState<InvoiceItemRow[]>([]);
  const [ledger, setLedger] = useState<LedgerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [sendingWa, setSendingWa] = useState(false);
  const [invoiceItemPages, setInvoiceItemPages] = useState<number[][]>([[]]);
  const [ledgerPages, setLedgerPages] = useState<number[][]>([[]]);
  const [layoutReady, setLayoutReady] = useState(false);
  const [preparedBy, setPreparedBy] = useState("—");
  const [preparedAt, setPreparedAt] = useState("");
  const waAutoQueuedRef = useRef(false);

  const measureRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || !invoice) return;
    setLoading(true);
    setLayoutReady(false);
    waAutoQueuedRef.current = false;
    setPreparedBy(getCurrentUserName() || "—");
    setPreparedAt(format(new Date(), "dd-MM-yyyy hh:mm a"));
    (async () => {
      await ensureRupeeFontsReady();
      const [s, pp, it, lg] = await Promise.all([
        supabase.from("app_settings").select("setting_key, setting_value").in("setting_key", SETTING_KEYS),
        supabase.from("pickup_points").select("*").eq("id", invoice.pickup_point_id).single(),
        getInvoiceItems(invoice.id),
        getInvoiceLedger(invoice.pickup_point_id),
      ]);
      const map: Record<string, string> = {};
      (s.data || []).forEach((r: { setting_key: string; setting_value: string }) => {
        map[r.setting_key] = r.setting_value;
      });
      setSettings(map);
      setPickup(pp.data as PickupPoint | null);
      setItems(it as InvoiceItemRow[]);
      setLedger(lg as LedgerRow[]);
      setLoading(false);
    })();
  }, [open, invoice]);

  useLayoutEffect(() => {
    if (loading || !invoice || !pickup || !measureRef.current) return;

    const root = measureRef.current;
    const q = (sel: string) => root.querySelector(sel) as HTMLElement | null;
    const h = (el: HTMLElement | null) => el?.offsetHeight ?? 0;

    const headerH = h(q('[data-measure="header"]'));
    const metaH = h(q('[data-measure="meta"]'));
    const bankH = h(q('[data-measure="bank"]'));
    const theadH = h(q('[data-measure="items-thead"]'));
    const continuedH = h(q('[data-measure="continued"]'));
    const grandTotalH = h(q('[data-measure="grand-total"]'));
    const footerH = h(q('[data-measure="footer"]'));
    const ledgerTitleH = h(q('[data-measure="ledger-title"]'));
    const ledgerTheadH = h(q('[data-measure="ledger-thead"]'));
    const ledgerContinuedH = h(q('[data-measure="ledger-continued"]'));

    const itemRowEls = Array.from(root.querySelectorAll('[data-measure="item-row"]')) as HTMLElement[];
    // Use offsetTop deltas so collapsed table borders aren't under-counted (which packs an extra clipped row).
    const itemRowHeights = itemRowEls.map((el, i) => {
      if (i < itemRowEls.length - 1) {
        return Math.max(1, itemRowEls[i + 1].offsetTop - el.offsetTop);
      }
      return Math.ceil(el.getBoundingClientRect().height);
    });

    const ledgerRowEls = Array.from(root.querySelectorAll('[data-measure="ledger-row"]')) as HTMLElement[];
    const ledgerRowHeights = ledgerRowEls.map((el, i) => {
      if (i < ledgerRowEls.length - 1) {
        return Math.max(1, ledgerRowEls[i + 1].offsetTop - el.offsetTop);
      }
      return Math.ceil(el.getBoundingClientRect().height);
    });

    const firstInvoiceBudget = Math.floor(
      CONTENT_HEIGHT_PX - headerH - metaH - bankH - theadH - TABLE_FIRST_MARGIN_TOP_PX,
    );
    const contInvoiceBudget = Math.floor(CONTENT_HEIGHT_PX - continuedH - theadH);
    const invoiceFooterReserve = Math.ceil(grandTotalH + footerH);

    const invPages = packRowIndices(
      itemRowHeights,
      firstInvoiceBudget,
      contInvoiceBudget,
      invoiceFooterReserve,
    );
    setInvoiceItemPages(invPages);

    const firstLedgerBudget = Math.floor(CONTENT_HEIGHT_PX - ledgerTitleH - ledgerTheadH);
    const contLedgerBudget = Math.floor(CONTENT_HEIGHT_PX - ledgerContinuedH - ledgerTheadH);
    const ledPages = packRowIndices(ledgerRowHeights, firstLedgerBudget, contLedgerBudget, 0);
    setLedgerPages(ledPages.length ? ledPages : [[]]);
    setLayoutReady(true);
  }, [loading, invoice, pickup, items, ledger, settings]);

  const capturePage = async (node: HTMLElement) => {
    await ensureRupeeFontsReady();
    await waitForImages(node);

    const clone = node.cloneNode(true) as HTMLElement;
    clone.style.width = `${A4_WIDTH_PX}px`;
    clone.style.height = `${A4_HEIGHT_PX}px`;
    clone.style.maxWidth = `${A4_WIDTH_PX}px`;
    clone.style.minHeight = `${A4_HEIGHT_PX}px`;
    clone.style.margin = "0";
    clone.style.boxShadow = "none";
    clone.style.background = "#ffffff";
    clone.style.overflow = "hidden";
    clone.style.fontFamily = INVOICE_FONT;

    const host = document.createElement("div");
    host.style.cssText = `position:fixed;left:-10000px;top:0;width:${A4_WIDTH_PX}px;height:${A4_HEIGHT_PX}px;background:#ffffff;z-index:-1;pointer-events:none;overflow:hidden;`;
    host.appendChild(clone);
    document.body.appendChild(host);

    try {
      await waitForImages(clone);
      await new Promise((r) => setTimeout(r, 80));

      let fontEmbedCSS = "";
      try {
        fontEmbedCSS = await getFontEmbedCSS(clone);
      } catch {
        fontEmbedCSS = "";
      }

      let dataUrl = "";
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          dataUrl = await toJpeg(clone, {
            quality: 0.95,
            pixelRatio: 2,
            cacheBust: true,
            backgroundColor: "#ffffff",
            width: A4_WIDTH_PX,
            height: A4_HEIGHT_PX,
            fontEmbedCSS: fontEmbedCSS || undefined,
            style: {
              transform: "none",
              transformOrigin: "top left",
              margin: "0",
              width: `${A4_WIDTH_PX}px`,
              height: `${A4_HEIGHT_PX}px`,
              maxWidth: `${A4_WIDTH_PX}px`,
              boxShadow: "none",
              overflow: "hidden",
              fontFamily: INVOICE_FONT,
            },
          });
          if (dataUrl && dataUrl.length > 8000) break;
        } catch {
          // retry
        }
        await new Promise((r) => setTimeout(r, 200));
      }
      return dataUrl || null;
    } finally {
      host.remove();
    }
  };

  const buildPdfBlob = async (): Promise<{ blob: Blob; filename: string }> => {
    if (!invoice || !pickup) throw new Error("Invoice not ready");
    await ensureRupeeFontsReady();
    await new Promise((r) => setTimeout(r, 100));

    const pageNodes = Array.from(
      document.querySelectorAll<HTMLElement>('[data-invoice-a4-page]'),
    ).sort(
      (a, b) =>
        Number(a.getAttribute("data-invoice-a4-page") || 0) -
        Number(b.getAttribute("data-invoice-a4-page") || 0),
    );
    if (pageNodes.length === 0) throw new Error("No invoice pages to capture");

    const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();

    for (let i = 0; i < pageNodes.length; i++) {
      const dataUrl = await capturePage(pageNodes[i]);
      if (!dataUrl) throw new Error(`Could not render page ${i + 1}`);
      if (i > 0) pdf.addPage();
      pdf.addImage(dataUrl, "JPEG", 0, 0, pageW, pageH, undefined, "FAST");
    }

    const safeName = (pickup.name || "PICKUP").replace(/[^A-Z0-9_-]/gi, "_");
    const filename = `${safeName}_${invoice.invoice_number}.pdf`;
    return { blob: pdf.output("blob"), filename };
  };

  const buildWhatsAppCaption = () => {
    const labName = (pickup?.name || "Pickup Point").trim();
    const amount = Number(invoice?.total_amount || 0).toLocaleString("en-IN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    const period =
      invoice?.period_from && invoice?.period_to
        ? `${format(new Date(invoice.period_from), "dd-MM-yyyy")} to ${format(new Date(invoice.period_to), "dd-MM-yyyy")}`
        : "—";
    return (
      `*${labName}*\n` +
      `Invoice No: ${invoice?.invoice_number || "—"}\n` +
      `Amount: ₹${amount}\n` +
      `Period: ${period}\n` +
      `\n*PH PathLabs - Vesu*`
    );
  };

  const sendWhatsApp = async (opts?: { closeAfter?: boolean }) => {
    if (!invoice || !pickup) return;
    const phone = String(pickup.phone || "").replace(/\D/g, "").slice(-10);
    if (phone.length !== 10) {
      toast.error("Pickup point has no valid WhatsApp number");
      return;
    }
    setSendingWa(true);
    try {
      const { blob, filename } = await buildPdfBlob();
      const res = await enqueueReportForWhatsAppConsole({
        phone,
        patient_name: pickup.name,
        invoice_number: invoice.invoice_number,
        caption: buildWhatsAppCaption(),
        blob,
        filename,
      });
      if (!res.ok) throw new Error(res.error || "Failed to queue WhatsApp");
      toast.success("Invoice PDF queued for WhatsApp Console");
      if (opts?.closeAfter) onClose();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "WhatsApp send failed";
      toast.error(msg);
    } finally {
      setSendingWa(false);
    }
  };

  const download = async () => {
    if (!invoice || !pickup) return;
    setDownloading(true);
    try {
      const { blob, filename } = await buildPdfBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("A4 PDF downloaded");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Download failed";
      toast.error(msg);
    } finally {
      setDownloading(false);
    }
  };

  useEffect(() => {
    if (!open || !autoQueueWhatsApp || !layoutReady || loading || sendingWa) return;
    if (waAutoQueuedRef.current) return;
    waAutoQueuedRef.current = true;
    void sendWhatsApp({ closeAfter: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, autoQueueWhatsApp, layoutReady, loading]);

  if (!invoice) return null;

  const showBank = !!(settings.bank_account_number || settings.bank_name);
  const addressLine = [
    (settings.invoice_address || "").replace(/\s+/g, " ").trim(),
    (settings.invoice_contact || "").replace(/\s+/g, " ").trim(),
  ]
    .filter(Boolean)
    .join("  |  ");

  const totalInvoicePages = invoiceItemPages.length;
  const pageOffset = totalInvoicePages;
  const totalDocumentPages = totalInvoicePages + ledgerPages.length;

  const renderHeader = () => (
    <div data-measure="header" style={{ position: "relative", borderBottom: `2px solid ${BRAND}`, paddingBottom: 8 }}>
      <div
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          fontSize: 26,
          fontWeight: 800,
          letterSpacing: 2,
          color: "#111827",
        }}
      >
        INVOICE
      </div>
      <div style={{ display: "flex", justifyContent: "center", padding: "0 90px" }}>
        {settings.invoice_logo_url && (
          <img
            src={settings.invoice_logo_url}
            alt="Logo"
            style={{ height: 60, objectFit: "contain" }}
            crossOrigin="anonymous"
          />
        )}
      </div>
      {addressLine && (
        <div
          style={{
            marginTop: 6,
            fontSize: 11,
            color: "#374151",
            lineHeight: 1.3,
            textAlign: "center",
            width: "100%",
            whiteSpace: "nowrap",
            overflow: "hidden",
          }}
        >
          {addressLine}
        </div>
      )}
    </div>
  );

  const renderMeta = () => (
    <div
      data-measure="meta"
      style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}
    >
      <div style={{ border: "1px solid #ddd", borderRadius: 4, padding: 8 }}>
        <div
          style={{
            fontSize: 11,
            color: "#666",
            textTransform: "uppercase",
            marginBottom: 4,
            letterSpacing: 0.4,
          }}
        >
          Bill To
        </div>
        <div style={{ fontWeight: 700, fontSize: 15 }}>{pickup?.name}</div>
        {pickup?.address && <div style={{ fontSize: 12, lineHeight: 1.4 }}>{pickup.address}</div>}
        {pickup?.contact_person && <div style={{ fontSize: 12 }}>Attn: {pickup.contact_person}</div>}
        {pickup?.phone && <div style={{ fontSize: 12 }}>Phone: {pickup.phone}</div>}
      </div>
      <div style={{ border: "1px solid #ddd", borderRadius: 4, padding: 8 }}>
        <table style={{ width: "100%", fontSize: 13 }}>
          <tbody>
            <tr>
              <td style={{ color: "#666" }}>Invoice No</td>
              <td style={{ textAlign: "right", fontWeight: 700 }}>{invoice.invoice_number}</td>
            </tr>
            <tr>
              <td style={{ color: "#666" }}>Invoice Date</td>
              <td style={{ textAlign: "right" }}>{format(new Date(invoice.created_at), "dd-MM-yyyy")}</td>
            </tr>
            <tr>
              <td style={{ color: "#666" }}>Period From</td>
              <td style={{ textAlign: "right" }}>{format(new Date(invoice.period_from), "dd-MM-yyyy")}</td>
            </tr>
            <tr>
              <td style={{ color: "#666" }}>Period To</td>
              <td style={{ textAlign: "right" }}>{format(new Date(invoice.period_to), "dd-MM-yyyy")}</td>
            </tr>
            <tr>
              <td style={{ color: "#666" }}>Patients</td>
              <td style={{ textAlign: "right" }}>{invoice.patient_count}</td>
            </tr>
            <tr>
              <td style={{ color: "#111", fontWeight: 700, paddingTop: 4 }}>Amount</td>
              <td style={{ textAlign: "right", fontWeight: 700, paddingTop: 4, whiteSpace: "nowrap" }}>
                {formatInr(Number(invoice.total_amount))}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );

  const renderBank = () =>
    showBank ? (
      <div
        data-measure="bank"
        style={{ marginTop: 12, border: "1px solid #ddd", borderRadius: 4, padding: 8, background: "#fafafa" }}
      >
        <div
          style={{
            fontSize: 11,
            color: "#666",
            textTransform: "uppercase",
            marginBottom: 4,
            letterSpacing: 0.4,
          }}
        >
          Bank Details
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, fontSize: 12, lineHeight: 1.45 }}>
          {settings.bank_account_name && (
            <div>
              <b>A/c Name:</b> {settings.bank_account_name}
            </div>
          )}
          {settings.bank_account_number && (
            <div>
              <b>A/c No:</b> {settings.bank_account_number}
            </div>
          )}
          {settings.bank_name && (
            <div>
              <b>Bank:</b> {settings.bank_name}
            </div>
          )}
          {settings.bank_branch && (
            <div>
              <b>Branch:</b> {settings.bank_branch}
            </div>
          )}
          {settings.bank_ifsc && (
            <div>
              <b>IFSC:</b> {settings.bank_ifsc}
            </div>
          )}
          {settings.bank_micr && (
            <div>
              <b>MICR:</b> {settings.bank_micr}
            </div>
          )}
          {settings.bank_pan && (
            <div>
              <b>PAN:</b> {settings.bank_pan}
            </div>
          )}
        </div>
      </div>
    ) : (
      <div data-measure="bank" style={{ display: "none" }} />
    );

  const renderContinued = () => (
    <div
      data-measure="continued"
      style={{
        marginBottom: 8,
        padding: "6px 10px",
        background: HEADER_BG,
        border: `1px solid ${BRAND}`,
        borderRadius: 4,
        fontSize: 12,
        fontWeight: 600,
        color: BRAND,
      }}
    >
      Invoice {invoice.invoice_number} — Continued
    </div>
  );

  const renderGrandTotal = () => (
    <tr data-measure="grand-total" style={{ background: HEADER_BG, fontWeight: 700 }}>
      <td style={td} colSpan={5}>
        Grand Total
      </td>
      <td style={{ ...td, textAlign: "right" }}>{formatInr(Number(invoice.total_amount))}</td>
    </tr>
  );

  const renderFooter = () => (
    <div data-measure="footer">
      <div style={{ marginTop: 8, fontSize: 12, fontStyle: "italic" }}>
        Amount in words: <b>{amountInWords(Number(invoice.total_amount))}</b>
      </div>
      <div
        style={{
          marginTop: 18,
          fontSize: 11,
          color: "#444",
          borderTop: "1px solid #ddd",
          paddingTop: 8,
          lineHeight: 1.45,
        }}
      >
        {settings.pickup_invoice_declaration && (
          <div style={{ marginBottom: 4 }}>{settings.pickup_invoice_declaration}</div>
        )}
        <div>
          Please pay within {settings.pickup_invoice_default_reminder_days || "15"} days of invoice date. For billing
          queries, contact {settings.invoice_contact || ""}.
        </div>
      </div>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-[900px] max-h-[92vh] overflow-y-auto p-0">
        <div className="flex items-center justify-between p-3 border-b sticky top-0 bg-background z-10">
          <div className="font-semibold">Invoice — {invoice.invoice_number}</div>
          <div className="flex gap-2">
            <Button
              size="sm"
              className="bg-[#2E3192] hover:bg-[#23266F] text-white"
              onClick={download}
              disabled={downloading || sendingWa || loading || !layoutReady}
            >
              {downloading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Download className="h-4 w-4 mr-1" />}
              Download PDF
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="border-[#2E3192] text-[#2E3192]"
              onClick={() => void sendWhatsApp()}
              disabled={downloading || sendingWa || loading || !layoutReady}
              title="Send invoice PDF on WhatsApp"
            >
              {sendingWa ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Send className="h-4 w-4 mr-1" />}
              WhatsApp
            </Button>
            <Button size="sm" variant="ghost" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="p-12 text-center text-sm text-muted-foreground">Loading…</div>
        ) : (
          <>
            {/* Off-screen measurement block — same A4 content width */}
            <div
              ref={measureRef}
              aria-hidden
              style={{
                position: "fixed",
                left: -10000,
                top: 0,
                width: `${A4_WIDTH_MM}mm`,
                padding: `${PAGE_PADDING_TOP_MM}mm 12mm ${PAGE_PADDING_BOTTOM_MM}mm`,
                boxSizing: "border-box",
                fontFamily: INVOICE_FONT,
                fontSize: 13,
                visibility: "hidden",
                pointerEvents: "none",
              }}
            >
              {renderHeader()}
              {renderMeta()}
              {renderBank()}
              {renderContinued()}
              <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 12, fontSize: 12, tableLayout: "fixed" }}>
                <ItemsTableColgroup />
                <thead data-measure="items-thead">
                  <tr style={{ background: HEADER_BG, color: BRAND }}>
                    <th style={th}>#</th>
                    <th style={{ ...th, whiteSpace: "nowrap" }}>Reg. Date</th>
                    <th style={th}>Invoice No</th>
                    <th style={th}>Patient Name</th>
                    <th style={th}>Tests</th>
                    <th style={{ ...th, textAlign: "right", whiteSpace: "nowrap" }}>Amount ({`\u20b9`})</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it, i) => (
                    <tr
                      key={it.id || i}
                      data-measure="item-row"
                      style={{ background: i % 2 ? "#fafafa" : "#fff", verticalAlign: "top" }}
                    >
                      <td style={td}>{i + 1}</td>
                      <td style={{ ...td, whiteSpace: "nowrap" }}>
                        {it.registration_date ? format(new Date(it.registration_date), "dd-MM-yyyy") : ""}
                      </td>
                      <td style={{ ...td, wordBreak: "break-word" }}>{it.registration_invoice}</td>
                      <td style={{ ...td, whiteSpace: "normal", wordBreak: "break-word", lineHeight: 1.35 }}>
                        {it.patient_name}
                      </td>
                      <td
                        style={{
                          ...td,
                          fontSize: 11,
                          whiteSpace: "normal",
                          wordBreak: "normal",
                          overflowWrap: "normal",
                          lineHeight: 1.4,
                        }}
                      >
                        {formatTestNames(it.test_names)}
                      </td>
                      <td style={{ ...td, textAlign: "right", whiteSpace: "nowrap" }}>
                        {Number(it.net_amount).toFixed(2)}
                      </td>
                    </tr>
                  ))}
                  {renderGrandTotal()}
                </tbody>
              </table>
              {renderFooter()}

              <div data-measure="ledger-title" style={{ fontSize: 16, fontWeight: 700, marginBottom: 8, color: BRAND }}>
                Ledger Report — {pickup?.name}
              </div>
              <div
                data-measure="ledger-continued"
                style={{
                  marginBottom: 8,
                  padding: "6px 10px",
                  background: HEADER_BG,
                  border: `1px solid ${BRAND}`,
                  borderRadius: 4,
                  fontSize: 12,
                  fontWeight: 600,
                  color: BRAND,
                }}
              >
                Ledger Report — Continued
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead data-measure="ledger-thead">
                  <tr style={{ background: HEADER_BG, color: BRAND }}>
                    <th style={th}>Date</th>
                    <th style={th}>Voucher Type</th>
                    <th style={th}>Voucher No</th>
                    <th style={{ ...th, textAlign: "right" }}>Debit</th>
                    <th style={{ ...th, textAlign: "right" }}>Credit</th>
                    <th style={{ ...th, textAlign: "right" }}>Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {ledger.map((r, i) => (
                    <tr key={i} data-measure="ledger-row" style={{ background: i % 2 ? "#fafafa" : "#fff" }}>
                      <td style={{ ...td, whiteSpace: "nowrap" }}>
                        {r.date ? format(new Date(r.date), "dd-MM-yyyy") : ""}
                      </td>
                      <td style={td}>{r.voucher_type}</td>
                      <td style={{ ...td, fontSize: 11, wordBreak: "break-word" }}>{r.voucher_no}</td>
                      <td style={{ ...td, textAlign: "right" }}>{r.debit ? r.debit.toFixed(2) : ""}</td>
                      <td style={{ ...td, textAlign: "right" }}>{r.credit ? r.credit.toFixed(2) : ""}</td>
                      <td style={{ ...td, textAlign: "right", fontWeight: 600 }}>{r.balance.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="p-4 bg-muted/40 space-y-4">
              <div className="text-center text-[11px] text-muted-foreground">
                A4 preview (210 × 297 mm) — {layoutReady ? invoiceItemPages.length + ledgerPages.length : "…"} page
                {(invoiceItemPages.length + ledgerPages.length) !== 1 ? "s" : ""}
              </div>

              {layoutReady &&
                invoiceItemPages.map((pageIndices, pageIdx) => {
                  const isFirst = pageIdx === 0;
                  const isLast = pageIdx === invoiceItemPages.length - 1;
                  const pageNo = pageIdx + 1;
                  return (
                    <div
                      key={`inv-page-${pageIdx}`}
                      data-invoice-a4-page={pageNo}
                      style={paperStyle()}
                    >
                      <div style={{ flex: "0 0 auto", overflow: "visible" }}>
                        {isFirst && (
                          <>
                            {renderHeader()}
                            {renderMeta()}
                            {renderBank()}
                          </>
                        )}
                        {!isFirst && renderContinued()}
                        <table
                          style={{
                            width: "100%",
                            borderCollapse: "collapse",
                            marginTop: isFirst ? TABLE_FIRST_MARGIN_TOP_PX : 0,
                            fontSize: 12,
                            tableLayout: "fixed",
                          }}
                        >
                          <ItemsTableColgroup />
                          <ItemsTableHead />
                          <tbody>
                            {pageIndices.map((itemIdx) => (
                              <ItemDataRow key={items[itemIdx]?.id || itemIdx} item={items[itemIdx]} index={itemIdx} />
                            ))}
                            {isLast && (
                              <tr style={{ background: HEADER_BG, fontWeight: 700 }}>
                                <td style={td} colSpan={5}>
                                  Grand Total
                                </td>
                                <td style={{ ...td, textAlign: "right" }}>
                                  {formatInr(Number(invoice.total_amount))}
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                        {isLast && (
                          <>
                            <div style={{ marginTop: 8, fontSize: 12, fontStyle: "italic" }}>
                              Amount in words: <b>{amountInWords(Number(invoice.total_amount))}</b>
                            </div>
                            <div
                              style={{
                                marginTop: 18,
                                fontSize: 11,
                                color: "#444",
                                borderTop: "1px solid #ddd",
                                paddingTop: 8,
                                lineHeight: 1.45,
                              }}
                            >
                              {settings.pickup_invoice_declaration && (
                                <div style={{ marginBottom: 4 }}>{settings.pickup_invoice_declaration}</div>
                              )}
                              <div>
                                Please pay within {settings.pickup_invoice_default_reminder_days || "15"} days of invoice
                                date. For billing queries, contact {settings.invoice_contact || ""}.
                              </div>
                            </div>
                          </>
                        )}
                      </div>
                      <PageChromeFooter
                        page={pageNo}
                        totalPages={totalDocumentPages}
                        preparedBy={preparedBy}
                        preparedAt={preparedAt}
                      />
                    </div>
                  );
                })}

              {layoutReady &&
                ledgerPages.map((pageIndices, pageIdx) => {
                  const isFirst = pageIdx === 0;
                  const pageNo = pageOffset + pageIdx + 1;
                  return (
                    <div
                      key={`ledger-page-${pageIdx}`}
                      data-invoice-a4-page={pageNo}
                      style={paperStyle()}
                    >
                      <div style={{ flex: "0 0 auto", overflow: "visible" }}>
                        {isFirst ? (
                          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8, color: BRAND }}>
                            Ledger Report — {pickup?.name}
                          </div>
                        ) : (
                          <div
                            style={{
                              marginBottom: 8,
                              padding: "6px 10px",
                              background: HEADER_BG,
                              border: `1px solid ${BRAND}`,
                              borderRadius: 4,
                              fontSize: 12,
                              fontWeight: 600,
                              color: BRAND,
                            }}
                          >
                            Ledger Report — Continued
                          </div>
                        )}
                        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                          <thead>
                            <tr style={{ background: HEADER_BG, color: BRAND }}>
                              <th style={th}>Date</th>
                              <th style={th}>Voucher Type</th>
                              <th style={th}>Voucher No</th>
                              <th style={{ ...th, textAlign: "right" }}>Debit</th>
                              <th style={{ ...th, textAlign: "right" }}>Credit</th>
                              <th style={{ ...th, textAlign: "right" }}>Balance</th>
                            </tr>
                          </thead>
                          <tbody>
                            {pageIndices.length === 0 && isFirst ? (
                              <tr>
                                <td style={td} colSpan={6}>
                                  No ledger entries
                                </td>
                              </tr>
                            ) : (
                              pageIndices.map((rowIdx) => {
                                const r = ledger[rowIdx];
                                return (
                                  <tr key={rowIdx} style={{ background: rowIdx % 2 ? "#fafafa" : "#fff" }}>
                                    <td style={{ ...td, whiteSpace: "nowrap" }}>
                                      {r.date ? format(new Date(r.date), "dd-MM-yyyy") : ""}
                                    </td>
                                    <td style={td}>{r.voucher_type}</td>
                                    <td style={{ ...td, fontSize: 11, wordBreak: "break-word" }}>{r.voucher_no}</td>
                                    <td style={{ ...td, textAlign: "right" }}>
                                      {r.debit ? r.debit.toFixed(2) : ""}
                                    </td>
                                    <td style={{ ...td, textAlign: "right" }}>
                                      {r.credit ? r.credit.toFixed(2) : ""}
                                    </td>
                                    <td style={{ ...td, textAlign: "right", fontWeight: 600 }}>
                                      {r.balance.toFixed(2)}
                                    </td>
                                  </tr>
                                );
                              })
                            )}
                          </tbody>
                        </table>
                      </div>
                      <PageChromeFooter
                        page={pageNo}
                        totalPages={totalDocumentPages}
                        preparedBy={preparedBy}
                        preparedAt={preparedAt}
                      />
                    </div>
                  );
                })}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default PickupInvoicePDF;
