import { useRef, useState, useEffect, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Printer, Send } from "lucide-react";
import { format } from "date-fns";
import html2canvas from "html2canvas";
import JsBarcode from "jsbarcode";
import { shareOnWhatsApp } from "@/lib/whatsapp";
import { logMessageSend } from "@/lib/messageLog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { getCurrentUserName } from "@/lib/auth";

interface InvoicePreviewProps {
  data: any;
  open: boolean;
  onClose: () => void;
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
};

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

const InvoicePreview = ({ data, open, onClose }: InvoicePreviewProps) => {
  const receiptRef = useRef<HTMLDivElement>(null);
  const barcodeRef = useRef<SVGSVGElement>(null);
  const [brand, setBrand] = useState<Record<string, string>>(DEFAULTS);
  const [channelName, setChannelName] = useState("");

  useEffect(() => {
    if (!open) return;
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
  }, [open]);

  useEffect(() => {
    if (!open || !data?.channel_id) { setChannelName(""); return; }
    (async () => {
      const { data: ch } = await supabase.from("channels").select("name").eq("id", data.channel_id).maybeSingle();
      setChannelName(ch?.name || "");
    })();
  }, [open, data?.channel_id]);

  useEffect(() => {
    if (!open || !data?.umr_number) return;
    const timer = setTimeout(() => {
      if (!barcodeRef.current) return;
      try {
        JsBarcode(barcodeRef.current, data.umr_number, {
          format: "CODE128",
          height: 24,
          width: 1.2,
          displayValue: false,
          fontSize: 8,
          margin: 0,
        });
      } catch { /* ignore invalid barcode */ }
    }, 200);
    return () => clearTimeout(timer);
  }, [open, data?.umr_number]);

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

    const FIRST_PAGE_TESTS = 10;
    const SUBSEQUENT_PAGE_TESTS = 18;

    // Split tests into page chunks
    const pages: any[][] = [];
    if (tests.length <= FIRST_PAGE_TESTS) {
      pages.push(tests);
    } else {
      pages.push(tests.slice(0, FIRST_PAGE_TESTS));
      let idx = FIRST_PAGE_TESTS;
      while (idx < tests.length) {
        pages.push(tests.slice(idx, idx + SUBSEQUENT_PAGE_TESTS));
        idx += SUBSEQUENT_PAGE_TESTS;
      }
    }

    const totalPages = pages.length;

    const headerHtml = () => {
      let h = '';
      if (brand.invoice_logo_url) {
        h += `<div style="text-align:${brand.invoice_logo_align}"><img src="${brand.invoice_logo_url}" style="max-height:40px;display:inline-block;margin-bottom:4px" /></div>`;
      }
      if (labVisible) {
        h += `<h2 style="margin:0;color:#0d9488;font-size:16px;text-align:${brand.invoice_lab_name_align}">${brand.invoice_lab_name}</h2>`;
      }
      if (brand.invoice_contact) {
        h += `<p style="margin:2px 0;font-size:10px;color:#666;text-align:${brand.invoice_lab_name_align}">${brand.invoice_contact}</p>`;
      }
      if (brand.invoice_address) {
        h += `<p style="margin:2px 0;font-size:9px;color:#888;white-space:pre-line;text-align:${brand.invoice_address_align}">${brand.invoice_address}</p>`;
      }
      h += `<p style="margin:2px 0;font-size:9px;color:#888;text-align:${brand.invoice_tagline_align}">${brand.invoice_tagline}</p>`;
      return h;
    };

    const demographicsHtml = () => {
      let d = `<div style="display:grid;grid-template-columns:1fr 1fr;gap:3px;font-size:11px;margin-bottom:8px">`;
      d += `<div><strong>Invoice #:</strong> ${data.invoice_number}</div>`;
      d += `<div><strong>Date:</strong> ${format(createdAt, "dd-MM-yyyy HH:mm")}</div>`;
      d += `<div><strong>Patient:</strong> ${data.title || ""} ${data.patient_name}</div>`;
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
        h += `<th style="${thStyle};text-align:right;width:1%;white-space:nowrap">MRP</th>`;
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
        summaryHtml = `<div style="font-size:11px;margin-top:6px">`;
        if (showGross) {
          summaryHtml += `<div style="display:flex;justify-content:space-between"><span>Gross Amount:</span><span>₹${activeGross}</span></div>`;
          if (activeDiscount > 0) summaryHtml += `<div style="display:flex;justify-content:space-between;color:green"><span>Discount:</span><span>-₹${activeDiscount}</span></div>`;
          if (Number(data.home_visit_charges || 0) > 0) summaryHtml += `<div style="display:flex;justify-content:space-between"><span>Home Visit Charges:</span><span>+₹${data.home_visit_charges}</span></div>`;
        }
        summaryHtml += `<div style="display:flex;justify-content:space-between;font-weight:bold;${showGross ? 'border-top:1px solid #ddd;padding-top:3px;margin-top:3px' : ''}"><span>Final Amount:</span><span>₹${activeFinal}</span></div>`;
        if (payments.length > 0) {
          summaryHtml += `<div style="margin-top:3px">`;
          payments.forEach((p: any) => {
            summaryHtml += `<div style="display:flex;justify-content:space-between;font-size:10px"><span>${p.mode}${p.date ? ` (${format(new Date(p.date), "dd-MM-yyyy hh:mm a")})` : ""}:</span><span>₹${p.amount}</span></div>`;
          });
          summaryHtml += `</div>`;
        }
        summaryHtml += `<div style="display:flex;justify-content:space-between;font-weight:bold;margin-top:3px"><span>Paid:</span><span>₹${data.paid_amount}</span></div>`;
        if (Number(data.paid_amount || 0) > 0) {
          summaryHtml += `<div style="font-size:10px;margin-top:4px;font-style:italic;color:#444">Received with thanks from ${data.title ? data.title + " " : ""}${data.patient_name} a sum of Rs. ${Number(data.paid_amount).toFixed(2)}/- (${numberToWords(Number(data.paid_amount))} Rupees)</div>`;
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

      pagesHtml += `<div style="${pageBreak}">`;
      pagesHtml += `<div style="margin-bottom:10px">${headerHtml()}</div>`;
      pagesHtml += demographicsHtml();
      pagesHtml += `<table style="width:100%;border-collapse:collapse;margin:6px 0"><thead>${tableHeaderHtml()}</thead><tbody>${tableRows}${subtotalRow}</tbody></table>`;
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

  const handleWhatsApp = async () => {
    if (!receiptRef.current) return;
    try {
      const canvas = await html2canvas(receiptRef.current, { backgroundColor: "#ffffff", scale: 2, useCORS: true, width: 560, windowWidth: 560 });
      canvas.toBlob((blob) => {
        if (!blob) return;
        const file = new File([blob], `invoice-${data.invoice_number}.jpg`, { type: "image/jpeg" });
        if (navigator.share && navigator.canShare?.({ files: [file] })) {
          navigator.share({ files: [file], title: `Invoice ${data.invoice_number}` }).catch(() => {
            downloadAndShare(canvas);
          });
        } else {
          downloadAndShare(canvas);
        }
      }, "image/jpeg", 0.95);
    } catch {
      toast.error("Could not generate invoice image");
    }
  };

  const downloadAndShare = (canvas: HTMLCanvasElement) => {
    const link = document.createElement("a");
    link.download = `invoice-${data.invoice_number}.jpg`;
    link.href = canvas.toDataURL("image/jpeg", 0.95);
    link.click();
    toast.success("Invoice image downloaded — share it on WhatsApp");
    if (data.mobile_number) {
      const msg = `📋 *${brand.invoice_lab_name} — Invoice*\nInvoice No: ${data.invoice_number}\nPatient: ${data.title || ""} ${data.patient_name}\nAmount: ₹${data.final_amount}`;
      shareOnWhatsApp(data.mobile_number, msg);
      logMessageSend(data.mobile_number, data.patient_name, "Invoice", data.umr_number);
    }
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
              <h2 style={{ margin: 0, color: "#0d9488", fontSize: 16, textAlign: brand.invoice_lab_name_align as any }}>{brand.invoice_lab_name}</h2>
            )}
            {brand.invoice_contact && (
              <p style={{ margin: "2px 0", fontSize: 10, color: "#666", textAlign: brand.invoice_lab_name_align as any }}>{brand.invoice_contact}</p>
            )}
            {brand.invoice_address && (
              <p style={{ margin: "2px 0", fontSize: 9, color: "#888", whiteSpace: "pre-line", textAlign: brand.invoice_address_align as any }}>{brand.invoice_address}</p>
            )}
            <p style={{ margin: "2px 0", fontSize: 9, color: "#888", textAlign: brand.invoice_tagline_align as any }}>{brand.invoice_tagline}</p>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 3, fontSize: 11, marginBottom: 8 }}>
            <div><strong>Invoice #:</strong> {data.invoice_number}</div>
            <div><strong>Date:</strong> {format(createdAt, "dd-MM-yyyy HH:mm")}</div>
            <div><strong>Patient:</strong> {data.title} {data.patient_name}</div>
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
                    <th style={{ border: "1px solid #ddd", padding: 4, fontSize: 10, textAlign: "right", width: "1%", whiteSpace: "nowrap" }}>MRP</th>
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

          <div style={{ fontSize: 11, marginTop: 6 }}>
            {showGross && (
              <>
                <div style={{ display: "flex", justifyContent: "space-between" }}><span>Gross Amount:</span><span>₹{activeGross}</span></div>
                {activeDiscount > 0 && <div style={{ display: "flex", justifyContent: "space-between", color: "green" }}><span>Discount:</span><span>-₹{activeDiscount}</span></div>}
                {Number(data.home_visit_charges || 0) > 0 && <div style={{ display: "flex", justifyContent: "space-between" }}><span>Home Visit Charges:</span><span>+₹{data.home_visit_charges}</span></div>}
              </>
            )}
            <div style={{ display: "flex", justifyContent: "space-between", fontWeight: "bold", borderTop: showGross ? "1px solid #ddd" : "none", paddingTop: showGross ? 3 : 0, marginTop: showGross ? 3 : 0 }}>
              <span>Final Amount:</span><span>₹{activeFinal}</span>
            </div>
            {payments.length > 0 && (
              <div style={{ marginTop: 3 }}>
                {payments.map((p: any, i: number) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 10 }}>
                    <span>{p.mode}{p.date ? ` (${format(new Date(p.date), "dd-MM-yyyy hh:mm a")})` : ""}:</span><span>₹{p.amount}</span>
                  </div>
                ))}
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "space-between", fontWeight: "bold", marginTop: 3 }}>
              <span>Paid:</span><span>₹{data.paid_amount}</span>
            </div>
            {Number(data.paid_amount || 0) > 0 && (
              <div style={{ fontSize: 10, marginTop: 4, fontStyle: "italic", color: "#444" }}>
                Received with thanks from {data.title ? `${data.title} ` : ""}{data.patient_name} a sum of Rs. {Number(data.paid_amount).toFixed(2)}/- ({numberToWords(Number(data.paid_amount))} Rupees)
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
                <svg ref={barcodeRef} style={{ display: "block", margin: "0 auto" }} />
              </div>
            )}
            <p style={{ margin: "4px 0 0", fontSize: 8, color: "#888" }}>This is an Electronically Generated Receipt &amp; Does Not Require Signature</p>
          </div>
        </div>

        <div className="flex gap-2 mt-2">
          <Button className="flex-1" variant="outline" onClick={handlePrint}>
            <Printer className="h-4 w-4 mr-2" />Print
          </Button>
          <Button className="flex-1" onClick={handleWhatsApp}>
            <Send className="h-4 w-4 mr-2" />WhatsApp
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default InvoicePreview;
