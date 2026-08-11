import { useRef, useState, useEffect, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Printer, Send, Loader2 } from "lucide-react";
import { format } from "date-fns";
import html2canvas from "html2canvas";
import JsBarcode from "jsbarcode";
import { logMessageSend } from "@/lib/messageLog";
import { enqueueInvoiceForWhatsAppConsole } from "@/lib/whatsappConsoleBridge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { getCurrentUserName } from "@/lib/auth";
import { patientDisplayName } from "@/lib/patientDisplayName";

interface InvoicePreviewProps {
  data: any;
  open: boolean;
  onClose: () => void;
  /** After registration: auto-enqueue invoice to WhatsApp Console outbox once. */
  autoQueueWhatsApp?: boolean;
  /** Hide Print (e.g. home-visit completion receipt — WhatsApp only). */
  hidePrint?: boolean;
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
  invoice_lab_name_color: "#0d9488",
  invoice_contact_size: "10",
  invoice_contact_bold: "false",
  invoice_contact_color: "#666666",
  invoice_address_size: "9",
  invoice_address_bold: "false",
  invoice_address_color: "#888888",
  invoice_tagline_size: "9",
  invoice_tagline_bold: "false",
  invoice_tagline_color: "#888888",
};

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

const InvoicePreview = ({ data, open, onClose, autoQueueWhatsApp = false, hidePrint = false }: InvoicePreviewProps) => {
  const receiptRef = useRef<HTMLDivElement>(null);
  const barcodeRef = useRef<HTMLCanvasElement>(null);
  const queuedInvoiceRef = useRef<string | null>(null);
  const autoQueuedRef = useRef<string | null>(null);
  const [brand, setBrand] = useState<Record<string, string>>(DEFAULTS);
  const [channelName, setChannelName] = useState("");
  const [consoleQueued, setConsoleQueued] = useState(false);
  const [waSending, setWaSending] = useState(false);

  useEffect(() => {
    if (!open) {
      setConsoleQueued(false);
      setWaSending(false);
      return;
    }
    setConsoleQueued(queuedInvoiceRef.current === String(data?.invoice_number || ""));
    (async () => {
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
        height: 28,
        width: 1.4,
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
    if (!open || !invoiceNo || !data?.mobile_number) {
      toast.error("Mobile number required to send on WhatsApp");
      return;
    }
    if (isPickupInvoice(data)) {
      toast.error("Pickup point invoices are not sent on WhatsApp");
      return;
    }
    if (!receiptRef.current) {
      toast.error("Invoice not ready yet");
      return;
    }
    setWaSending(true);
    try {
      // Canvas barcode captures reliably in html2canvas (SVG often blank).
      renderBarcode();
      await new Promise((r) => setTimeout(r, 50));
      const canvas = await html2canvas(receiptRef.current, {
        backgroundColor: "#ffffff",
        scale: 2,
        useCORS: true,
        width: 560,
        windowWidth: 560,
        // Keep cloned layout metrics close to on-screen so summary spacing matches preview.
        logging: false,
        onclone: (_doc, cloned) => {
          const root = cloned as HTMLElement;
          root.style.lineHeight = "1.55";
          root.querySelectorAll("div").forEach((el) => {
            const style = (el as HTMLElement).style;
            // Ensure tiny paddings aren't lost when borders sit between flex rows.
            if (style.borderTop && style.borderTop !== "none" && style.borderTop !== "") {
              if (!style.marginTop || style.marginTop === "0px") style.marginTop = "8px";
            }
          });
        },
      });
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob((b) => resolve(b), "image/jpeg", 0.95),
      );
      if (!blob) {
        toast.error("Could not generate invoice image for WhatsApp");
        return;
      }
      const lab = brand.invoice_lab_name || "PH PathLabs";
      const caption =
        `📋 *${lab} — Invoice*\n` +
        `Invoice No: ${invoiceNo}\n` +
        `Patient: ${patientDisplayName(data)}\n` +
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
        return;
      }
      queuedInvoiceRef.current = invoiceNo;
      setConsoleQueued(true);
      logMessageSend(data.mobile_number, data.patient_name, "Invoice", data.umr_number);
      toast.success("Invoice queued for WhatsApp (WA API)", {
        description: `Sending to ${String(data.mobile_number).replace(/\D/g, "").slice(-10)} via WhatsApp Console`,
      });
    } catch (e: any) {
      toast.error(e?.message || "WhatsApp WA API queue failed");
    } finally {
      setWaSending(false);
    }
  }, [open, data, brand.invoice_lab_name, renderBarcode, isPickupInvoice]);

  // New registration: queue invoice to durable outbox once barcode/layout is ready.
  useEffect(() => {
    if (!autoQueueWhatsApp || !open || !data?.invoice_number || !data?.mobile_number) return;
    if (isPickupInvoice(data)) return;
    const invoiceNo = String(data.invoice_number);
    if (autoQueuedRef.current === invoiceNo || queuedInvoiceRef.current === invoiceNo) return;
    const timer = setTimeout(() => {
      if (autoQueuedRef.current === invoiceNo || queuedInvoiceRef.current === invoiceNo) return;
      autoQueuedRef.current = invoiceNo;
      void queueInvoiceViaWaApi();
    }, 900);
    return () => clearTimeout(timer);
  }, [autoQueueWhatsApp, open, data, data?.invoice_number, data?.mobile_number, queueInvoiceViaWaApi, isPickupInvoice]);

  if (!data) return null;

  const allTests = data.tests || [];
  const cancelledTests = Array.isArray(data.cancelled_tests) ? data.cancelled_tests : [];
  const cancelledTestIds = new Set(cancelledTests.map((ct: any) => ct.test_id));
  const tests = allTests.filter((t: any) => !cancelledTestIds.has(t.test_id));
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

  const handlePrint = () => {
    const printWindow = window.open("", "_blank");
    if (!printWindow) return;

    // Dynamic pagination: estimate heights in mm relative to A5 usable area
    const ROW_HEIGHT = 6; // mm per test row
    const USABLE_HEIGHT = 186; // A5 (210mm) minus 24mm margins
    const HEADER_HEIGHT = 70; // logo + demographics + table header + page footer

    // Estimate summary section height based on actual data
    let summaryRows = 3; // final amount + paid + thank-you footer
    if (showGross) summaryRows += 1;
    if (activeDiscount > 0) summaryRows += 1;
    if (Number(data.home_visit_charges || 0) > 0) summaryRows += 1;
    summaryRows += payments.length;
    if (Number(data.paid_amount || 0) > 0) summaryRows += 1; // "received with thanks"
    if (data.due_amount > 0) summaryRows += 1;
    if (data.refund_amount > 0) {
      summaryRows += 2; // refund amount + mode
      if (data.refund_date) summaryRows += 1;
      if (cancelledTests.length > 0) summaryRows += 1;
      if (hvcRefund > 0) summaryRows += 1;
    }
    if (data.umr_number) summaryRows += 2; // barcode
    const SUMMARY_HEIGHT = summaryRows * 5 + 30; // base padding + rows

    const normalPageCapacity = Math.max(5, Math.floor((USABLE_HEIGHT - HEADER_HEIGHT) / ROW_HEIGHT));
    const lastPageCapacity = Math.max(3, Math.floor((USABLE_HEIGHT - HEADER_HEIGHT - SUMMARY_HEIGHT) / ROW_HEIGHT));

    // Extra safety buffer for complex summaries
    const hasRefund = data.refund_amount > 0;
    const hasMultiplePayments = payments.length > 2;
    const safetyBuffer = (hasRefund ? 3 : 0) + (hasMultiplePayments ? 2 : 0) + (cancelledTests.length > 0 ? 1 : 0);
    const safeLastPageCapacity = Math.max(1, lastPageCapacity - safetyBuffer);

    // Build pages: fill each page to normalPageCapacity, last page gets summary
    const pages: any[][] = [];
    const totalTests = tests.length;
    if (totalTests <= safeLastPageCapacity) {
      // Everything fits on one page with summary
      pages.push(tests);
    } else {
      let idx = 0;
      let remaining = totalTests;
      // Fill pages forward until remainder fits on last page with summary
      while (remaining > safeLastPageCapacity) {
        const take = Math.min(normalPageCapacity, remaining);
        pages.push(tests.slice(idx, idx + take));
        idx += take;
        remaining -= take;
      }
      if (remaining > 0) {
        pages.push(tests.slice(idx)); // last page with summary
      }
    }

    // If last page is at or above safe capacity, push summary to dedicated page
    if (pages.length > 0 && pages[pages.length - 1].length >= safeLastPageCapacity && pages[pages.length - 1].length >= lastPageCapacity) {
      pages.push([]); // empty page just for summary
    }

    const totalPages = pages.length;

    const headerHtml = () => {
      let h = '';
      if (brand.invoice_logo_url) {
        h += `<div style="text-align:${brand.invoice_logo_align}"><img src="${brand.invoice_logo_url}" style="max-height:40px;display:inline-block;margin-bottom:4px" /></div>`;
      }
      if (labVisible) {
        h += `<h2 style="margin:0;${textStyleCss(brand, "invoice_lab_name", "16", "#0d9488")};text-align:${brand.invoice_lab_name_align}">${brand.invoice_lab_name}</h2>`;
      }
      if (brand.invoice_contact) {
        h += `<p style="margin:2px 0;${textStyleCss(brand, "invoice_contact", "10", "#666666")};text-align:${brand.invoice_lab_name_align}">${brand.invoice_contact}</p>`;
      }
      if (brand.invoice_address) {
        h += `<p style="margin:2px 0;${textStyleCss(brand, "invoice_address", "9", "#888888")};white-space:pre-line;text-align:${brand.invoice_address_align}">${brand.invoice_address}</p>`;
      }
      h += `<p style="margin:2px 0;${textStyleCss(brand, "invoice_tagline", "9", "#888888")};text-align:${brand.invoice_tagline_align}">${brand.invoice_tagline}</p>`;
      return h;
    };

    const demographicsHtml = () => {
      let d = `<div style="display:grid;grid-template-columns:1fr 1fr;gap:3px;font-size:11px;margin-bottom:8px">`;
      d += `<div><strong>Invoice #:</strong> ${data.invoice_number}</div>`;
      d += `<div><strong>Date:</strong> ${format(createdAt, "dd-MM-yyyy HH:mm")}</div>`;
      d += `<div><strong>Patient:</strong> ${patientDisplayName(data)}</div>`;
      d += `<div><strong>Mobile:</strong> ${data.mobile_number}</div>`;
      if (data.gender) d += `<div><strong>Gender:</strong> ${data.gender}</div>`;
      if (age) d += `<div><strong>Age:</strong> ${age}</div>`;
      if (data.doctor_name) d += `<div><strong>Doctor:</strong> ${data.doctor_name}</div>`;
      if (data.umr_number) d += `<div><strong>UMR:</strong> ${data.umr_number}</div>`;
      d += `<div><strong>Visit:</strong> ${visitLabel}</div>`;
      d += `</div>`;
      return d;
    };

    const tableHeaderHtml = () => {
      const thStyle = `border:1px solid #ddd;padding:4px;font-size:10px`;
      let h = `<tr style="background:#f5f5f5">`;
      h += `<th style="${thStyle};width:1%;white-space:nowrap">#</th>`;
      h += `<th style="${thStyle};text-align:left">Test</th>`;
      if (hasAnyDiscount) {
        h += `<th style="${thStyle};text-align:right;width:1%;white-space:nowrap">Price</th>`;
        h += `<th style="${thStyle};text-align:right;width:1%;white-space:nowrap">Disc</th>`;
        h += `<th style="${thStyle};text-align:right;width:1%;white-space:nowrap">Net</th>`;
      } else {
        h += `<th style="${thStyle};text-align:right;width:1%;white-space:nowrap">Amount</th>`;
      }
      h += `</tr>`;
      return h;
    };

    const testRowHtml = (t: any, globalIndex: number) => {
      const tdStyle = `border:1px solid #ddd;padding:4px;font-size:10px`;
      let r = `<tr>`;
      r += `<td style="${tdStyle};text-align:center;width:1%;white-space:nowrap">${globalIndex + 1}</td>`;
      r += `<td style="${tdStyle}">${t.test_name}</td>`;
      if (hasAnyDiscount) {
        r += `<td style="${tdStyle};text-align:right;white-space:nowrap">₹${t.price}</td>`;
        r += `<td style="${tdStyle};text-align:right;white-space:nowrap">${Number(t.discount || 0) > 0 ? `-₹${t.discount}` : "—"}</td>`;
        r += `<td style="${tdStyle};text-align:right;white-space:nowrap">₹${t.discounted_price || t.discountedPrice}</td>`;
      } else {
        r += `<td style="${tdStyle};text-align:right;white-space:nowrap">₹${t.price}</td>`;
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

      // Subtotal row on non-last pages
      const colSpan = hasAnyDiscount ? 4 : 2;
      const subtotalRow = !isLast ? `<tr style="background:#f9f9f9"><td colspan="${colSpan}" style="border:1px solid #ddd;padding:4px;font-size:10px;text-align:right;font-weight:bold">Subtotal:</td><td style="border:1px solid #ddd;padding:4px;font-size:10px;text-align:right;font-weight:bold;white-space:nowrap">₹${pageSubtotal}</td></tr>` : '';

      // Payment summary only on last page
      let summaryHtml = '';
      if (isLast) {
        summaryHtml = `<div style="font-size:11px;margin-top:6px;line-height:1.55">`;
        if (showGross) {
          summaryHtml += `<div style="display:flex;justify-content:space-between;padding:2px 0"><span>Gross Amount:</span><span>₹${activeGross}</span></div>`;
          if (activeDiscount > 0) summaryHtml += `<div style="display:flex;justify-content:space-between;color:green;padding:2px 0"><span>Discount:</span><span>-₹${activeDiscount}</span></div>`;
          if (Number(data.home_visit_charges || 0) > 0) summaryHtml += `<div style="display:flex;justify-content:space-between;padding:2px 0"><span>Home Visit Charges:</span><span>+₹${data.home_visit_charges}</span></div>`;
          summaryHtml += `<div style="border-top:1px solid #ddd;margin:8px 0 0;height:0;overflow:hidden;font-size:0;line-height:0"></div>`;
        }
        summaryHtml += `<div style="display:flex;justify-content:space-between;font-weight:bold;padding:8px 0 2px"><span>Final Amount:</span><span>₹${activeFinal}</span></div>`;
        if (payments.length > 0) {
          summaryHtml += `<div style="margin-top:4px">`;
          payments.forEach((p: any) => {
            summaryHtml += `<div style="display:flex;justify-content:space-between;font-size:10px;padding:2px 0"><span>${p.mode}${p.date ? ` (${format(new Date(p.date), "dd-MM-yyyy hh:mm a")})` : ""}:</span><span>₹${p.amount}</span></div>`;
          });
          summaryHtml += `</div>`;
        }
        summaryHtml += `<div style="display:flex;justify-content:space-between;font-weight:bold;margin-top:4px;padding:2px 0"><span>Paid:</span><span>₹${data.paid_amount}</span></div>`;
        if (Number(data.paid_amount || 0) > 0) {
          summaryHtml += `<div style="font-size:10px;margin-top:4px;font-style:italic;color:#444">Received with thanks from ${patientDisplayName(data)} a sum of Rs. ${Number(data.paid_amount).toFixed(2)}/- (${numberToWords(Number(data.paid_amount))} Rupees)</div>`;
        }
        if (data.due_amount > 0) {
          summaryHtml += `<div style="display:flex;justify-content:space-between;color:red;font-weight:bold;margin-top:3px"><span>Due:</span><span>₹${data.due_amount}</span></div>`;
        }
        if (data.refund_amount > 0) {
          summaryHtml += `<div style="margin-top:6px;border-top:1px solid #ddd;padding-top:4px">`;
          summaryHtml += `<div style="display:flex;justify-content:space-between;color:#ea580c;font-weight:bold"><span>Refund Amount:</span><span>₹${data.refund_amount}</span></div>`;
          summaryHtml += `<div style="display:flex;justify-content:space-between;font-size:10px"><span>Refund Mode:</span><span>${data.refund_mode || "—"}</span></div>`;
          if (data.refund_date) summaryHtml += `<div style="display:flex;justify-content:space-between;font-size:10px"><span>Refund Date:</span><span>${format(new Date(data.refund_date), "dd-MM-yyyy hh:mm a")}</span></div>`;
          if (cancelledTests.length > 0) summaryHtml += `<div style="font-size:9px;color:#888;margin-top:3px">Cancelled Tests: ${cancelledTests.map((ct: any) => ct.test_name || ct.test_id).join(", ")}</div>`;
          if (hvcRefund > 0) summaryHtml += `<div style="font-size:9px;color:#888;margin-top:3px">Home Visit Charges Refunded: ₹${hvcRefund}</div>`;
          summaryHtml += `</div>`;
        }
        summaryHtml += `</div>`;

        // Barcode as PNG for print reliability
        const barcodePng = barcodeRef.current?.toDataURL?.("image/png");
        if (barcodePng) {
          summaryHtml += `<div style="margin-top:6px;text-align:center"><img src="${barcodePng}" style="height:28px;display:inline-block" /></div>`;
        }

        // Footer
        summaryHtml += `<div style="text-align:center;font-size:9px;color:#888;margin-top:10px">`;
        summaryHtml += `<p style="margin:2px 0">Thank you for choosing us</p>`;
        summaryHtml += `<p style="margin:4px 0 0;font-size:8px;color:#888">This is an Electronically Generated Receipt &amp; Does Not Require Signature</p>`;
        summaryHtml += `</div>`;
      }

      const printNow = format(new Date(), "dd-MM-yyyy hh:mm a");
      const preparedDate = format(createdAt, "dd-MM-yyyy hh:mm a");
      const currentUser = getCurrentUserName() || "—";
      const preparedPrintedFooter = `<div style="display:flex;justify-content:space-between;font-size:9px;color:#888;margin-top:10px;border-top:1px solid #eee;padding-top:4px">
        <div>Prepared by: ${data.registered_by || "—"} | ${preparedDate}</div>
        <div>Printed by: ${currentUser} | ${printNow}</div>
      </div>`;

      pagesHtml += `<div style="${pageBreak}${pageIdx > 0 ? 'padding-top:8mm;' : ''}">`;
      pagesHtml += `<div style="margin-bottom:10px">${headerHtml()}</div>`;
      pagesHtml += demographicsHtml();
      if (pageTests.length > 0) {
        pagesHtml += `<table style="width:100%;border-collapse:collapse;margin:6px 0"><thead>${tableHeaderHtml()}</thead><tbody>${tableRows}${subtotalRow}</tbody></table>`;
      }
      pagesHtml += summaryHtml;
      pagesHtml += preparedPrintedFooter;
      pagesHtml += `<div style="text-align:center;font-size:8px;color:#aaa;margin-top:8px">Page ${pageIdx + 1} of ${totalPages}</div>`;
      pagesHtml += `</div>`;
    });

    printWindow.document.write(`
      <html><head><title>Invoice ${data.invoice_number}</title>
      <style>
        @page { size: A5; margin: 12mm; }
        body { font-family: Arial, sans-serif; padding: 8mm; max-width: 148mm; margin: auto; font-size: 10px; line-height: 1.6; }
        table { width: 100%; border-collapse: collapse; margin: 6px 0; }
        th, td { border: 1px solid #ddd; padding: 4px; text-align: left; font-size: 10px; line-height: 1.5; }
        th { background: #f5f5f5; }
      </style></head><body>
      ${pagesHtml}
      <script>window.print(); window.close();<\/script>
      </body></html>
    `);
    printWindow.document.close();
  };

  const age = data.dob ? `${Math.floor((Date.now() - new Date(data.dob).getTime()) / (365.25 * 24 * 60 * 60 * 1000))} Years` : "";

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Invoice Generated — {data.invoice_number}</DialogTitle>
        </DialogHeader>

        <div ref={receiptRef} className="bg-white text-black rounded" style={{ fontFamily: "Arial, sans-serif", width: 560, margin: "0 auto", padding: 32 }}>
          <div style={{ marginBottom: 10 }}>
            {brand.invoice_logo_url && (
              <div style={{ textAlign: brand.invoice_logo_align as any }}>
                <img src={brand.invoice_logo_url} alt="Logo" style={{ maxHeight: 40, display: "inline-block", marginBottom: 4 }} />
              </div>
            )}
            {labVisible && (
              <h2 style={{ margin: 0, textAlign: brand.invoice_lab_name_align as any, ...textStyle(brand, "invoice_lab_name", "16", "#0d9488") }}>{brand.invoice_lab_name}</h2>
            )}
            {brand.invoice_contact && (
              <p style={{ margin: "2px 0", textAlign: brand.invoice_lab_name_align as any, ...textStyle(brand, "invoice_contact", "10", "#666666") }}>{brand.invoice_contact}</p>
            )}
            {brand.invoice_address && (
              <p style={{ margin: "2px 0", whiteSpace: "pre-line", textAlign: brand.invoice_address_align as any, ...textStyle(brand, "invoice_address", "9", "#888888") }}>{brand.invoice_address}</p>
            )}
            <p style={{ margin: "2px 0", textAlign: brand.invoice_tagline_align as any, ...textStyle(brand, "invoice_tagline", "9", "#888888") }}>{brand.invoice_tagline}</p>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 3, fontSize: 11, marginBottom: 8 }}>
            <div><strong>Invoice #:</strong> {data.invoice_number}</div>
            <div><strong>Date:</strong> {format(createdAt, "dd-MM-yyyy HH:mm")}</div>
            <div><strong>Patient:</strong> {patientDisplayName(data)}</div>
            <div><strong>Mobile:</strong> {data.mobile_number}</div>
            {data.gender && <div><strong>Gender:</strong> {data.gender}</div>}
            {age && <div><strong>Age:</strong> {age}</div>}
            {data.doctor_name && <div><strong>Doctor:</strong> {data.doctor_name}</div>}
            {data.umr_number && <div><strong>UMR:</strong> {data.umr_number}</div>}
            <div><strong>Visit:</strong> {visitLabel}</div>
          </div>

          <table style={{ width: "100%", borderCollapse: "collapse", margin: "6px 0" }}>
            <thead>
              <tr style={{ background: "#f5f5f5" }}>
                <th style={{ border: "1px solid #ddd", padding: 4, fontSize: 10, width: "1%", whiteSpace: "nowrap" }}>#</th>
                <th style={{ border: "1px solid #ddd", padding: 4, fontSize: 10, textAlign: "left" }}>Test</th>
                {hasAnyDiscount ? (
                  <>
                    <th style={{ border: "1px solid #ddd", padding: 4, fontSize: 10, textAlign: "right", width: "1%", whiteSpace: "nowrap" }}>Price</th>
                    <th style={{ border: "1px solid #ddd", padding: 4, fontSize: 10, textAlign: "right", width: "1%", whiteSpace: "nowrap" }}>Disc</th>
                    <th style={{ border: "1px solid #ddd", padding: 4, fontSize: 10, textAlign: "right", width: "1%", whiteSpace: "nowrap" }}>Net</th>
                  </>
                ) : (
                  <th style={{ border: "1px solid #ddd", padding: 4, fontSize: 10, textAlign: "right", width: "1%", whiteSpace: "nowrap" }}>Amount</th>
                )}
              </tr>
            </thead>
            <tbody>
              {tests.map((t: any, i: number) => (
                <tr key={i}>
                  <td style={{ border: "1px solid #ddd", padding: 4, fontSize: 10, textAlign: "center", width: "1%", whiteSpace: "nowrap" }}>{i + 1}</td>
                  <td style={{ border: "1px solid #ddd", padding: 4, fontSize: 10 }}>{t.test_name}</td>
                  {hasAnyDiscount ? (
                    <>
                      <td style={{ border: "1px solid #ddd", padding: 4, fontSize: 10, textAlign: "right", whiteSpace: "nowrap" }}>₹{t.price}</td>
                      <td style={{ border: "1px solid #ddd", padding: 4, fontSize: 10, textAlign: "right", whiteSpace: "nowrap" }}>{Number(t.discount || 0) > 0 ? `-₹${t.discount}` : "—"}</td>
                      <td style={{ border: "1px solid #ddd", padding: 4, fontSize: 10, textAlign: "right", whiteSpace: "nowrap" }}>₹{t.discounted_price || t.discountedPrice}</td>
                    </>
                  ) : (
                    <td style={{ border: "1px solid #ddd", padding: 4, fontSize: 10, textAlign: "right", whiteSpace: "nowrap" }}>₹{t.price}</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>

          <div style={{ fontSize: 11, marginTop: 6, lineHeight: 1.55 }}>
            {showGross && (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "2px 0" }}><span>Gross Amount:</span><span>₹{activeGross}</span></div>
                {activeDiscount > 0 && <div style={{ display: "flex", justifyContent: "space-between", color: "green", padding: "2px 0" }}><span>Discount:</span><span>-₹{activeDiscount}</span></div>}
                {Number(data.home_visit_charges || 0) > 0 && <div style={{ display: "flex", justifyContent: "space-between", padding: "2px 0" }}><span>Home Visit Charges:</span><span>+₹{data.home_visit_charges}</span></div>}
                {/* Separate border node — html2canvas collapses border-top on flex rows */}
                <div style={{ borderTop: "1px solid #ddd", margin: "8px 0 0", height: 0, overflow: "hidden", fontSize: 0, lineHeight: 0 }} aria-hidden />
              </>
            )}
            <div style={{ display: "flex", justifyContent: "space-between", fontWeight: "bold", padding: "8px 0 2px" }}>
              <span>Final Amount:</span><span>₹{activeFinal}</span>
            </div>
            {payments.length > 0 && (
              <div style={{ marginTop: 4 }}>
                {payments.map((p: any, i: number) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 10, padding: "2px 0" }}>
                    <span>{p.mode}{p.date ? ` (${format(new Date(p.date), "dd-MM-yyyy hh:mm a")})` : ""}:</span><span>₹{p.amount}</span>
                  </div>
                ))}
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "space-between", fontWeight: "bold", marginTop: 4, padding: "2px 0" }}>
              <span>Paid:</span><span>₹{data.paid_amount}</span>
            </div>
            {Number(data.paid_amount || 0) > 0 && (
              <div style={{ fontSize: 10, marginTop: 4, fontStyle: "italic", color: "#444" }}>
                Received with thanks from {patientDisplayName(data)} a sum of Rs. {Number(data.paid_amount).toFixed(2)}/- ({numberToWords(Number(data.paid_amount))} Rupees)
              </div>
            )}
            {data.due_amount > 0 && (
              <div style={{ display: "flex", justifyContent: "space-between", color: "red", fontWeight: "bold", marginTop: 3 }}>
                <span>Due:</span><span>₹{data.due_amount}</span>
              </div>
            )}
            {data.refund_amount > 0 && (
              <div style={{ marginTop: 6, borderTop: "1px solid #ddd", paddingTop: 4 }}>
                <div style={{ display: "flex", justifyContent: "space-between", color: "#ea580c", fontWeight: "bold" }}>
                  <span>Refund Amount:</span><span>₹{data.refund_amount}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10 }}>
                  <span>Refund Mode:</span><span>{data.refund_mode || "—"}</span>
                </div>
                {data.refund_date && (
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10 }}>
                    <span>Refund Date:</span><span>{format(new Date(data.refund_date), "dd-MM-yyyy hh:mm a")}</span>
                  </div>
                )}
                {cancelledTests.length > 0 && (
                  <div style={{ fontSize: 9, color: "#888", marginTop: 3 }}>
                    <span>Cancelled Tests: {cancelledTests.map((ct: any) => ct.test_name || ct.test_id).join(", ")}</span>
                  </div>
                )}
                {hvcRefund > 0 && (
                  <div style={{ fontSize: 9, color: "#888", marginTop: 3 }}>
                    <span>Home Visit Charges Refunded: ₹{hvcRefund}</span>
                  </div>
                )}
              </div>
            )}
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: "#888", marginTop: 10, borderTop: "1px solid #eee", paddingTop: 4 }}>
            <div>Prepared by: {data.registered_by || "—"} | {format(createdAt, "dd-MM-yyyy hh:mm a")}</div>
            <div>Printed by: {getCurrentUserName() || "—"} | {format(new Date(), "dd-MM-yyyy hh:mm a")}</div>
          </div>
          <div style={{ textAlign: "center", fontSize: 9, color: "#888", marginTop: 6 }}>
            <p style={{ margin: "2px 0" }}>Thank you for choosing us</p>
            {data.umr_number && (
              <div style={{ marginTop: 6, textAlign: "center" }}>
                <canvas ref={barcodeRef} style={{ display: "block", margin: "0 auto", maxWidth: "100%" }} />
              </div>
            )}
            <p style={{ margin: "4px 0 0", fontSize: 8, color: "#888" }}>This is an Electronically Generated Receipt &amp; Does Not Require Signature</p>
          </div>
        </div>

        <div className="flex gap-2 mt-2">
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
