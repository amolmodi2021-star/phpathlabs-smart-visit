import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Download, X, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import jsPDF from "jspdf";
import { toJpeg } from "html-to-image";
import { getInvoiceItems, getInvoiceLedger, amountInWords, type PickupInvoice } from "@/lib/pickupBilling";

interface Props {
  open: boolean;
  onClose: () => void;
  invoice: PickupInvoice | null;
}

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

const PickupInvoicePDF = ({ open, onClose, invoice }: Props) => {
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [pickup, setPickup] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [ledger, setLedger] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    if (!open || !invoice) return;
    setLoading(true);
    (async () => {
      const [s, pp, it, lg] = await Promise.all([
        supabase.from("app_settings").select("setting_key, setting_value").in("setting_key", SETTING_KEYS),
        supabase.from("pickup_points").select("*").eq("id", invoice.pickup_point_id).single(),
        getInvoiceItems(invoice.id),
        getInvoiceLedger(invoice.pickup_point_id),
      ]);
      const map: Record<string, string> = {};
      (s.data || []).forEach((r: any) => { map[r.setting_key] = r.setting_value; });
      setSettings(map);
      setPickup(pp.data);
      setItems(it);
      setLedger(lg);
      setLoading(false);
    })();
  }, [open, invoice]);

  const captureNode = async (id: string) => {
    const node = document.getElementById(id);
    if (!node) return null;
    // Decide pixel ratio based on rendered height (roughly mm: 1mm ≈ 3.78px at 96dpi)
    const heightMm = node.offsetHeight / 3.78;
    const pixelRatio = heightMm > 600 ? 1.5 : 2;
    const dataUrl = await toJpeg(node, {
      quality: 0.92,
      pixelRatio,
      cacheBust: true,
      backgroundColor: "#ffffff",
    });
    const img = new Image();
    img.src = dataUrl;
    await new Promise((r) => (img.onload = r));
    return { dataUrl, ratio: img.height / img.width };
  };

  const download = async () => {
    if (!invoice || !pickup) return;
    setDownloading(true);
    try {
      // Wait for any pending image paints (logo)
      await new Promise((r) => setTimeout(r, 80));

      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();

      const addCapture = async (id: string, isFirst: boolean) => {
        const cap = await captureNode(id);
        if (!cap) return;
        const imgWmm = pageW;
        const imgHmm = pageW * cap.ratio;
        if (!isFirst) pdf.addPage();
        if (imgHmm <= pageH) {
          pdf.addImage(cap.dataUrl, "JPEG", 0, 0, imgWmm, imgHmm);
        } else {
          // Long capture — slice across pages, fresh top each page
          let position = 0;
          let pageIndex = 0;
          while (position < imgHmm) {
            if (pageIndex > 0) pdf.addPage();
            pdf.addImage(cap.dataUrl, "JPEG", 0, -position, imgWmm, imgHmm);
            position += pageH;
            pageIndex++;
          }
        }
      };

      await addCapture("pickup-invoice-print-page1", true);
      await addCapture("pickup-invoice-print-page2", false);

      const safeName = (pickup.name || "PICKUP").replace(/[^A-Z0-9_-]/gi, "_");
      pdf.save(`${safeName}_${invoice.invoice_number}.pdf`);
      toast.success("PDF downloaded");
    } catch (e: any) {
      toast.error(e.message || "Download failed");
    } finally {
      setDownloading(false);
    }
  };

  if (!invoice) return null;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto p-0">
        <div className="flex items-center justify-between p-3 border-b sticky top-0 bg-background z-10">
          <div className="font-semibold">Invoice — {invoice.invoice_number}</div>
          <div className="flex gap-2">
            <Button size="sm" className="bg-[#2E3192] hover:bg-[#23266F] text-white" onClick={download} disabled={downloading || loading}>
              {downloading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Download className="h-4 w-4 mr-1" />}
              Download PDF
            </Button>
            <Button size="sm" variant="ghost" onClick={onClose}><X className="h-4 w-4" /></Button>
          </div>
        </div>
        {loading ? (
          <div className="p-12 text-center text-sm text-muted-foreground">Loading…</div>
        ) : (
          <div className="p-4 bg-muted/30">
            <div
              id="pickup-invoice-print-page1"
              style={{
                width: "210mm",
                minHeight: "297mm",
                margin: "0 auto",
                padding: "10mm 12mm",
                background: "#ffffff",
                color: "#111",
                fontFamily: "Arial, Helvetica, sans-serif",
                fontSize: 13,
                boxSizing: "border-box",
              }}
            >
              {/* Header: centered logo; address single line above blue divider */}
              <div style={{ position: "relative", borderBottom: "2px solid #2E3192", paddingBottom: 8 }}>
                <div style={{ position: "absolute", top: 0, right: 0, fontSize: 26, fontWeight: 800, letterSpacing: 2, color: "#111827" }}>
                  INVOICE
                </div>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", padding: "0 90px" }}>
                  {settings.invoice_logo_url && (
                    <img
                      src={settings.invoice_logo_url}
                      alt="Logo"
                      style={{ height: 60, objectFit: "contain" }}
                      crossOrigin="anonymous"
                    />
                  )}
                  {(settings.invoice_address || settings.invoice_contact) && (
                    <div style={{ marginTop: 6, fontSize: 12, color: "#374151", lineHeight: 1.4, whiteSpace: "nowrap", maxWidth: "100%" }}>
                      {[
                        (settings.invoice_address || "").replace(/\s+/g, " ").trim(),
                        (settings.invoice_contact || "").replace(/\s+/g, " ").trim(),
                      ].filter(Boolean).join("  |  ")}
                    </div>
                  )}
                </div>
              </div>

              {/* Meta + Bill To */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
                <div style={{ border: "1px solid #ddd", borderRadius: 4, padding: 8 }}>
                  <div style={{ fontSize: 11, color: "#666", textTransform: "uppercase", marginBottom: 4, letterSpacing: 0.4 }}>Bill To</div>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>{pickup?.name}</div>
                  {pickup?.address && <div style={{ fontSize: 12, lineHeight: 1.4 }}>{pickup.address}</div>}
                  {pickup?.contact_person && <div style={{ fontSize: 12 }}>Attn: {pickup.contact_person}</div>}
                  {pickup?.phone && <div style={{ fontSize: 12 }}>Phone: {pickup.phone}</div>}
                </div>
                <div style={{ border: "1px solid #ddd", borderRadius: 4, padding: 8 }}>
                  <table style={{ width: "100%", fontSize: 13 }}>
                    <tbody>
                      <tr><td style={{ color: "#666" }}>Invoice No</td><td style={{ textAlign: "right", fontWeight: 700 }}>{invoice.invoice_number}</td></tr>
                      <tr><td style={{ color: "#666" }}>Invoice Date</td><td style={{ textAlign: "right" }}>{format(new Date(invoice.created_at), "dd-MM-yyyy")}</td></tr>
                      <tr><td style={{ color: "#666" }}>Period From</td><td style={{ textAlign: "right" }}>{format(new Date(invoice.period_from), "dd-MM-yyyy")}</td></tr>
                      <tr><td style={{ color: "#666" }}>Period To</td><td style={{ textAlign: "right" }}>{format(new Date(invoice.period_to), "dd-MM-yyyy")}</td></tr>
                      <tr><td style={{ color: "#666" }}>Patients</td><td style={{ textAlign: "right" }}>{invoice.patient_count}</td></tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Bank details */}
              {(settings.bank_account_number || settings.bank_name) && (
                <div style={{ marginTop: 12, border: "1px solid #ddd", borderRadius: 4, padding: 8, background: "#fafafa" }}>
                  <div style={{ fontSize: 11, color: "#666", textTransform: "uppercase", marginBottom: 4, letterSpacing: 0.4 }}>Bank Details</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, fontSize: 12, lineHeight: 1.45 }}>
                    {settings.bank_account_name && <div><b>A/c Name:</b> {settings.bank_account_name}</div>}
                    {settings.bank_account_number && <div><b>A/c No:</b> {settings.bank_account_number}</div>}
                    {settings.bank_name && <div><b>Bank:</b> {settings.bank_name}</div>}
                    {settings.bank_branch && <div><b>Branch:</b> {settings.bank_branch}</div>}
                    {settings.bank_ifsc && <div><b>IFSC:</b> {settings.bank_ifsc}</div>}
                    {settings.bank_micr && <div><b>MICR:</b> {settings.bank_micr}</div>}
                    {settings.bank_pan && <div><b>PAN:</b> {settings.bank_pan}</div>}
                  </div>
                </div>
              )}

              {/* Items table */}
              <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 12, fontSize: 12, tableLayout: "fixed" }}>
                <colgroup>
                  <col style={{ width: "5%" }} />
                  <col style={{ width: "11%" }} />
                  <col style={{ width: "14%" }} />
                  <col style={{ width: "18%" }} />
                  <col style={{ width: "37%" }} />
                  <col style={{ width: "15%" }} />
                </colgroup>
                <thead>
                  <tr style={{ background: "#2E3192", color: "#fff" }}>
                    <th style={th}>#</th>
                    <th style={th}>Reg. Date</th>
                    <th style={th}>Invoice No</th>
                    <th style={th}>Patient Name</th>
                    <th style={th}>Tests</th>
                    <th style={{ ...th, textAlign: "right" }}>Net Amount (₹)</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it, i) => (
                    <tr key={it.id} style={{ background: i % 2 ? "#fafafa" : "#fff", verticalAlign: "top" }}>
                      <td style={td}>{i + 1}</td>
                      <td style={td}>{it.registration_date ? format(new Date(it.registration_date), "dd-MM-yyyy") : ""}</td>
                      <td style={{ ...td, wordBreak: "break-word" }}>{it.registration_invoice}</td>
                      <td style={{ ...td, whiteSpace: "normal", wordBreak: "break-word", lineHeight: 1.35 }}>{it.patient_name}</td>
                      <td style={{ ...td, fontSize: 11, whiteSpace: "normal", wordBreak: "break-word", overflowWrap: "anywhere", lineHeight: 1.4 }}>{it.test_names || ""}</td>
                      <td style={{ ...td, textAlign: "right", whiteSpace: "nowrap" }}>{Number(it.net_amount).toFixed(2)}</td>
                    </tr>
                  ))}
                  <tr style={{ background: "#F0F1FA", fontWeight: 700 }}>
                    <td style={td} colSpan={5}>Grand Total</td>
                    <td style={{ ...td, textAlign: "right" }}>₹{Number(invoice.total_amount).toFixed(2)}</td>
                  </tr>
                </tbody>
              </table>

              <div style={{ marginTop: 8, fontSize: 12, fontStyle: "italic" }}>
                Amount in words: <b>{amountInWords(Number(invoice.total_amount))}</b>
              </div>

              {/* Footer */}
              <div style={{ marginTop: 18, fontSize: 11, color: "#444", borderTop: "1px solid #ddd", paddingTop: 8, lineHeight: 1.45 }}>
                {settings.pickup_invoice_declaration && (
                  <div style={{ marginBottom: 4 }}>{settings.pickup_invoice_declaration}</div>
                )}
                <div>
                  Please pay within {settings.pickup_invoice_default_reminder_days || "15"} days of invoice date.
                  For billing queries, contact {settings.invoice_contact || ""}.
                </div>
              </div>
            </div>

            {/* Ledger - second page (separate capture) */}
            <div
              id="pickup-invoice-print-page2"
              style={{
                width: "210mm",
                minHeight: "297mm",
                margin: "12px auto 0",
                padding: "10mm 12mm",
                background: "#ffffff",
                color: "#111",
                fontFamily: "Arial, Helvetica, sans-serif",
                fontSize: 13,
                boxSizing: "border-box",
              }}
            >
              <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8, color: "#2E3192" }}>
                Ledger Report — {pickup?.name}
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ background: "#2E3192", color: "#fff" }}>
                    <th style={th}>Date</th>
                    <th style={th}>Voucher Type</th>
                    <th style={th}>Voucher No</th>
                    <th style={{ ...th, textAlign: "right" }}>Debit</th>
                    <th style={{ ...th, textAlign: "right" }}>Credit</th>
                    <th style={{ ...th, textAlign: "right" }}>Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {ledger.length === 0 ? (
                    <tr><td style={td} colSpan={6}>No ledger entries</td></tr>
                  ) : ledger.map((r, i) => (
                    <tr key={i} style={{ background: i % 2 ? "#fafafa" : "#fff" }}>
                      <td style={td}>{r.date ? format(new Date(r.date), "dd-MM-yyyy") : ""}</td>
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
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

const th: React.CSSProperties = { padding: "8px 8px", textAlign: "left", border: "1px solid #2E3192", fontSize: 12, fontWeight: 700, verticalAlign: "middle" };
const td: React.CSSProperties = { padding: "8px 8px", border: "1px solid #e5e7eb", verticalAlign: "top", fontSize: 12 };

export default PickupInvoicePDF;
