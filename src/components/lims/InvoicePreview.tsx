import { useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Printer, Send, X } from "lucide-react";
import { format } from "date-fns";
import html2canvas from "html2canvas";
import { shareOnWhatsApp } from "@/lib/whatsapp";
import { logMessageSend } from "@/lib/messageLog";
import { toast } from "sonner";

interface InvoicePreviewProps {
  data: any;
  open: boolean;
  onClose: () => void;
}

const InvoicePreview = ({ data, open, onClose }: InvoicePreviewProps) => {
  const receiptRef = useRef<HTMLDivElement>(null);

  if (!data) return null;

  const allTests = data.tests || [];
  const cancelledTests = Array.isArray(data.cancelled_tests) ? data.cancelled_tests : [];
  const cancelledTestIds = new Set(cancelledTests.map((ct: any) => ct.test_id));
  const tests = allTests.filter((t: any) => !cancelledTestIds.has(t.test_id));
  const createdAt = data.created_at ? new Date(data.created_at) : new Date();
  const payments = Array.isArray(data.payments) ? data.payments : [];

  // Recalculate amounts based on active tests only
  const activeGross = tests.reduce((sum: number, t: any) => sum + Number(t.price || 0), 0);
  const activeNet = tests.reduce((sum: number, t: any) => sum + Number(t.discounted_price || t.discountedPrice || t.price || 0), 0);
  const activeDiscount = activeGross - activeNet;
  const activeFinal = activeNet + Number(data.home_visit_charges || 0);

  // Derive HVC refund: total refund minus sum of cancelled test prices
  const cancelledTestRefundTotal = cancelledTests.reduce((sum: number, ct: any) => sum + Number(ct.price || 0), 0);
  const hvcRefund = Math.max(0, Number(data.refund_amount || 0) - cancelledTestRefundTotal);

  const handlePrint = () => {
    const printWindow = window.open("", "_blank");
    if (!printWindow || !receiptRef.current) return;
    printWindow.document.write(`
      <html><head><title>Invoice ${data.invoice_number}</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 20px; max-width: 800px; margin: auto; }
        table { width: 100%; border-collapse: collapse; margin: 10px 0; }
        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; font-size: 13px; }
        th { background: #f5f5f5; }
        .header { text-align: center; margin-bottom: 15px; }
        .header h2 { margin: 0; color: #0d9488; }
        .header p { margin: 2px 0; font-size: 12px; color: #666; }
        .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 5px; font-size: 13px; margin-bottom: 10px; }
        .total-row { font-weight: bold; background: #f0fdf4; }
        .footer { text-align: center; font-size: 11px; color: #888; margin-top: 15px; }
        @media print { body { padding: 0; } }
      </style></head><body>
      ${receiptRef.current.innerHTML}
      <script>window.print(); window.close();</script>
      </body></html>
    `);
    printWindow.document.close();
  };

  const handleWhatsApp = async () => {
    if (!receiptRef.current) return;
    try {
      const canvas = await html2canvas(receiptRef.current, { backgroundColor: "#ffffff", scale: 2, useCORS: true });
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
      const msg = `📋 *PH PathLabs — Invoice*\nInvoice No: ${data.invoice_number}\nPatient: ${data.title || ""} ${data.patient_name}\nAmount: ₹${data.final_amount}`;
      shareOnWhatsApp(data.mobile_number, msg);
      logMessageSend(data.mobile_number, data.patient_name, "Invoice", data.umr_number);
    }
  };

  const age = data.dob ? `${Math.floor((Date.now() - new Date(data.dob).getTime()) / (365.25 * 24 * 60 * 60 * 1000))} Years` : "";

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Invoice Generated — {data.invoice_number}</DialogTitle>
        </DialogHeader>

        <div ref={receiptRef} className="bg-white text-black p-4 rounded" style={{ fontFamily: "Arial, sans-serif" }}>
          <div className="header" style={{ textAlign: "center", marginBottom: 15 }}>
            <h2 style={{ margin: 0, color: "#0d9488", fontSize: 20 }}>PH PathLabs</h2>
            <p style={{ margin: "2px 0", fontSize: 12, color: "#666" }}>LabLine: 6356 55 66 99</p>
            <p style={{ margin: "2px 0", fontSize: 11, color: "#888" }}>Invoice / Sample Receipt</p>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, fontSize: 13, marginBottom: 10 }}>
            <div><strong>Invoice #:</strong> {data.invoice_number}</div>
            <div><strong>Date:</strong> {format(createdAt, "dd-MM-yyyy HH:mm")}</div>
            <div><strong>Patient:</strong> {data.title} {data.patient_name}</div>
            <div><strong>Mobile:</strong> {data.mobile_number}</div>
            {data.gender && <div><strong>Gender:</strong> {data.gender}</div>}
            {age && <div><strong>Age:</strong> {age}</div>}
            {data.doctor_name && <div><strong>Doctor:</strong> {data.doctor_name}</div>}
            {data.umr_number && <div><strong>UMR:</strong> {data.umr_number}</div>}
            <div><strong>Visit:</strong> {data.visit_type?.replace("_", " ")}</div>
          </div>

          <table style={{ width: "100%", borderCollapse: "collapse", margin: "10px 0" }}>
            <thead>
              <tr style={{ background: "#f5f5f5" }}>
                <th style={{ border: "1px solid #ddd", padding: 6, fontSize: 12 }}>#</th>
                <th style={{ border: "1px solid #ddd", padding: 6, fontSize: 12, textAlign: "left" }}>Test</th>
                <th style={{ border: "1px solid #ddd", padding: 6, fontSize: 12, textAlign: "right" }}>MRP</th>
                <th style={{ border: "1px solid #ddd", padding: 6, fontSize: 12, textAlign: "right" }}>Disc</th>
                <th style={{ border: "1px solid #ddd", padding: 6, fontSize: 12, textAlign: "right" }}>Net</th>
              </tr>
            </thead>
            <tbody>
              {tests.map((t: any, i: number) => (
                <tr key={i}>
                  <td style={{ border: "1px solid #ddd", padding: 6, fontSize: 12, textAlign: "center" }}>{i + 1}</td>
                  <td style={{ border: "1px solid #ddd", padding: 6, fontSize: 12 }}>{t.test_name}</td>
                  <td style={{ border: "1px solid #ddd", padding: 6, fontSize: 12, textAlign: "right" }}>₹{t.price}</td>
                  <td style={{ border: "1px solid #ddd", padding: 6, fontSize: 12, textAlign: "right" }}>{t.discount > 0 ? `-₹${t.discount}` : "—"}</td>
                  <td style={{ border: "1px solid #ddd", padding: 6, fontSize: 12, textAlign: "right" }}>₹{t.discounted_price || t.discountedPrice}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div style={{ fontSize: 13, marginTop: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}><span>Gross Amount:</span><span>₹{activeGross}</span></div>
            {activeDiscount > 0 && <div style={{ display: "flex", justifyContent: "space-between", color: "green" }}><span>Discount:</span><span>-₹{activeDiscount}</span></div>}
            {data.home_visit_charges > 0 && <div style={{ display: "flex", justifyContent: "space-between" }}><span>Home Visit Charges:</span><span>+₹{data.home_visit_charges}</span></div>}
            <div style={{ display: "flex", justifyContent: "space-between", fontWeight: "bold", borderTop: "1px solid #ddd", paddingTop: 4, marginTop: 4 }}>
              <span>Final Amount:</span><span>₹{activeFinal}</span>
            </div>
            {payments.length > 0 && (
              <div style={{ marginTop: 4 }}>
                {payments.map((p: any, i: number) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                    <span>{p.mode}{p.date ? ` (${format(new Date(p.date), "dd-MM-yyyy hh:mm a")})` : ""}:</span><span>₹{p.amount}</span>
                  </div>
                ))}
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "space-between", fontWeight: "bold", marginTop: 4 }}>
              <span>Paid:</span><span>₹{data.paid_amount}</span>
            </div>
            {data.due_amount > 0 && (
              <div style={{ display: "flex", justifyContent: "space-between", color: "red", fontWeight: "bold" }}>
                <span>Due:</span><span>₹{data.due_amount}</span>
              </div>
            )}
            {data.refund_amount > 0 && (
              <div style={{ marginTop: 8, borderTop: "1px solid #ddd", paddingTop: 6 }}>
                <div style={{ display: "flex", justifyContent: "space-between", color: "#ea580c", fontWeight: "bold" }}>
                  <span>Refund Amount:</span><span>₹{data.refund_amount}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                  <span>Refund Mode:</span><span>{data.refund_mode || "—"}</span>
                </div>
                {data.refund_date && (
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                    <span>Refund Date:</span><span>{format(new Date(data.refund_date), "dd-MM-yyyy hh:mm a")}</span>
                  </div>
                )}
                {cancelledTests.length > 0 && (
                  <div style={{ fontSize: 11, color: "#888", marginTop: 4 }}>
                    <span>Cancelled Tests: {cancelledTests.map((ct: any) => ct.test_name || ct.test_id).join(", ")}</span>
                  </div>
                )}
                {hvcRefund > 0 && (
                  <div style={{ fontSize: 11, color: "#888", marginTop: 4 }}>
                    <span>Home Visit Charges Refunded: ₹{hvcRefund}</span>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="footer" style={{ textAlign: "center", fontSize: 11, color: "#888", marginTop: 15 }}>
            <p>Sample ID: {data.invoice_number}</p>
            <p>Thank you for choosing PH PathLabs</p>
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
