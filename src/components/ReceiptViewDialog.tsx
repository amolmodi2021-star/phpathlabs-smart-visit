import { useState, useRef, useCallback, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { format } from "date-fns";
import html2canvas from "html2canvas";
import { shareOnWhatsApp } from "@/lib/whatsapp";
import { formatDateDDMMYYYY, formatDateShort } from "@/lib/utils";
import { Download, Share2 } from "lucide-react";

interface ReceiptViewDialogProps {
  open: boolean;
  onClose: () => void;
  visitData: any;
}

const formatTime12hr = (time: string) => {
  if (!time) return "";
  const [h, m] = time.split(":");
  const hour = parseInt(h, 10);
  const ampm = hour >= 12 ? "PM" : "AM";
  const h12 = hour % 12 || 12;
  return `${h12}:${m} ${ampm}`;
};

const ReceiptViewDialog = ({ open, onClose, visitData }: ReceiptViewDialogProps) => {
  const receiptRef = useRef<HTMLDivElement>(null);
  const [receiptNumber, setReceiptNumber] = useState("");
  const est = visitData?.estimates;
  const tests = est?.estimate_tests || [];

  const paidAmount = visitData?.paid_amount || 0;
  const dueAmount = visitData?.due_amount || 0;
  const modeStr = visitData?.payment_mode || "";

  // Generate receipt number when dialog opens
  useEffect(() => {
    if (open && visitData) {
      const generateReceiptNumber = async () => {
        const completedDate = visitData.updated_at ? new Date(visitData.updated_at) : new Date();
        const datePrefix = format(completedDate, "ddMMyy");
        const dayStart = format(completedDate, "yyyy-MM-dd");
        const completedIso = completedDate.toISOString();
        // Count completed visits from start of that day up to and including this visit
        const { count } = await supabase
          .from("home_visits")
          .select("*", { count: "exact", head: true })
          .eq("status", "Completed")
          .gte("updated_at", `${dayStart}T00:00:00`)
          .lte("updated_at", completedIso);
        const seq = (count || 1).toString().padStart(4, "0");
        setReceiptNumber(`HVR${datePrefix}${seq}`);
      };
      generateReceiptNumber();
    }
  }, [open, visitData]);

  const generateCanvas = useCallback(async () => {
    if (!receiptRef.current) return null;
    return html2canvas(receiptRef.current, {
      backgroundColor: "#ffffff",
      scale: 2,
      useCORS: true,
    });
  }, []);

  const handleDownload = useCallback(async () => {
    const canvas = await generateCanvas();
    if (!canvas) return;
    const link = document.createElement("a");
    link.download = `receipt-${est?.patient_name || "patient"}-${format(new Date(), "dd-MM-yyyy")}.jpg`;
    link.href = canvas.toDataURL("image/jpeg", 0.95);
    link.click();
    toast.success("Receipt downloaded");
  }, [generateCanvas, est]);

  const handleShare = useCallback(async () => {
    const canvas = await generateCanvas();
    if (!canvas) return;
    canvas.toBlob((blob) => {
      if (!blob) return;
      const file = new File([blob], "visit-receipt.jpg", { type: "image/jpeg" });
      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        navigator.share({
          files: [file],
          title: "Visit Receipt",
          text: `Visit receipt for ${est?.patient_name || "Patient"}`,
        }).catch(() => {
          // Fallback: download + WhatsApp text
          handleDownload();
          const phone = est?.whatsapp_number || "";
          if (phone) shareOnWhatsApp(phone, buildReceiptText());
        });
      } else {
        handleDownload();
        const phone = est?.whatsapp_number || "";
        if (phone) shareOnWhatsApp(phone, buildReceiptText());
      }
    }, "image/jpeg", 0.95);
  }, [generateCanvas, est, handleDownload]);

  const buildReceiptText = () => {
    let msg = `📋 *PH PathLabs — Home Visit Receipt*\n`;
    if (receiptNumber) msg += `*Receipt No:* ${receiptNumber}\n`;
    msg += `\n*Patient:* ${[est?.title, est?.patient_name].filter(Boolean).join(" ") || "—"}\n`;
    msg += `*Mobile:* ${est?.whatsapp_number || "—"}\n`;
    msg += `*Visit:* ${formatDateDDMMYYYY(visitData?.visit_date) || "—"} | ${visitData?.visit_time ? formatTime12hr(visitData.visit_time) : "—"}\n`;
    msg += `*Address:* ${visitData?.address || "—"}\n\n`;
    msg += `*Tests & Report Delivery:*\n`;
    tests.forEach((t: any) => {
      const rd = formatDateShort(t.report_date);
      const rt = t.report_time ? formatTime12hr(t.report_time) : "";
      msg += `• ${t.test_name} — ₹${t.discounted_price}${rd ? ` (Report by: ${rd} at ${rt})` : ""}\n`;
    });
    msg += `\n*Final Amount:* ₹${est?.final_amount || 0}\n`;
    msg += `*Paid:* ₹${paidAmount} | *Due:* ₹${dueAmount}\n`;
    return msg;
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Visit Receipt</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {/* Receipt card */}
          <div ref={receiptRef} className="bg-white text-black p-4 rounded-lg space-y-3" style={{ fontFamily: "Arial, sans-serif" }}>
            {/* Header */}
            <div className="text-center border-b-2 border-gray-800 pb-2">
              <h2 className="text-base font-bold tracking-wide">PH PathLabs</h2>
              <p className="text-[10px] text-gray-500">LabLine : 6356 55 66 99</p>
              <p className="text-[10px] text-gray-500">Home Visit Receipt</p>
              {receiptNumber && <p className="text-[10px] font-semibold text-gray-700">Receipt No: {receiptNumber}</p>}
              <p className="text-[10px] text-gray-500">
                {visitData?.updated_at
                  ? format(new Date(visitData.updated_at), "dd-MM-yyyy | hh:mm a")
                  : format(new Date(), "dd-MM-yyyy | hh:mm a")}
              </p>
            </div>

            {/* Patient Info */}
            <div className="space-y-0.5 text-xs">
              <div className="flex justify-between"><span className="text-gray-600">Patient:</span><span className="font-semibold">{[est?.title, est?.patient_name].filter(Boolean).join(" ") || "—"}</span></div>
              <div className="flex justify-between"><span className="text-gray-600">Mobile:</span><span className="font-semibold">{est?.whatsapp_number || "—"}</span></div>
              {est?.gender && <div className="flex justify-between"><span className="text-gray-600">Gender:</span><span className="font-semibold">{est.gender}</span></div>}
              {est?.dob && <div className="flex justify-between"><span className="text-gray-600">DOB:</span><span className="font-semibold">{formatDateDDMMYYYY(est.dob)}</span></div>}
              {est?.dob && <div className="flex justify-between"><span className="text-gray-600">Age:</span><span className="font-semibold">{Math.floor((Date.now() - new Date(est.dob).getTime()) / (365.25 * 24 * 60 * 60 * 1000))} Years</span></div>}
              {est?.doctor_name && <div className="flex justify-between"><span className="text-gray-600">Doctor:</span><span className="font-semibold">{est.doctor_name}</span></div>}
              {est?.umr_number && <div className="flex justify-between"><span className="text-gray-600">UMR No:</span><span className="font-semibold">{est.umr_number}</span></div>}
            </div>

            {/* Visit Info */}
            <div className="border-t border-gray-200 pt-1 space-y-0.5 text-xs">
              <div className="flex justify-between"><span className="text-gray-600">Visit Date:</span><span className="font-semibold">{formatDateDDMMYYYY(visitData?.visit_date) || "—"}</span></div>
              <div className="flex justify-between"><span className="text-gray-600">Visit Time:</span><span className="font-semibold">{visitData?.visit_time ? formatTime12hr(visitData.visit_time) : "—"}</span></div>
              <div className="flex justify-between"><span className="text-gray-600">Address:</span><span className="font-semibold text-right max-w-[60%]">{visitData?.address || "—"}</span></div>
            </div>

            {/* Tests */}
            <div className="border-t border-gray-200 pt-1">
              <p className="text-[10px] font-bold text-gray-500 uppercase mb-1">Tests & Report Delivery</p>
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-gray-300">
                    <th className="text-left py-0.5 text-gray-600 font-medium">Test</th>
                    <th className="text-right py-0.5 text-gray-600 font-medium">Amount</th>
                    <th className="text-right py-0.5 text-gray-600 font-medium">Report By</th>
                  </tr>
                </thead>
                <tbody>
                  {tests.map((t: any, i: number) => {
                    const rd = formatDateShort(t.report_date);
                    const rt = t.report_time ? formatTime12hr(t.report_time) : "";
                    return (
                      <tr key={i} className="border-b border-gray-100">
                        <td className="py-1 pr-1">
                          {t.test_name}
                          {t.fasting_required && <span className="text-[9px] text-red-500 ml-1">(F)</span>}
                        </td>
                        <td className="py-1 text-right font-semibold">₹{t.discounted_price}</td>
                        <td className="py-1 text-right text-[10px]">{rd} {rt}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Financials */}
            <div className="border-t-2 border-gray-800 pt-1 space-y-0.5 text-xs">
              <div className="flex justify-between"><span className="text-gray-600">Total Amount:</span><span className="font-semibold">₹{est?.total_amount || 0}</span></div>
              {(est?.discount_amount || 0) > 0 && (
                <div className="flex justify-between"><span className="text-gray-600">Discount:</span><span className="font-semibold text-green-600">-₹{est?.discount_amount}</span></div>
              )}
              <div className="flex justify-between"><span className="text-gray-600">Home Visit:</span><span className="font-semibold">₹{est?.home_visit_charges || 0}</span></div>
              <div className="flex justify-between text-sm font-bold border-t border-gray-300 pt-1"><span>Final Amount:</span><span>₹{est?.final_amount || 0}</span></div>
            </div>

            {/* Payment */}
            <div className="border-t border-gray-200 pt-1 space-y-0.5 text-xs">
              <div className="flex justify-between"><span className="text-gray-600">Paid:</span><span className="font-semibold text-green-700">₹{paidAmount}</span></div>
              <div className="flex justify-between"><span className="text-gray-600">Due:</span><span className={`font-semibold ${dueAmount > 0 ? 'text-red-600' : 'text-green-700'}`}>₹{dueAmount}</span></div>
              {modeStr && <div className="flex justify-between"><span className="text-gray-600">Mode:</span><span className="font-semibold">{modeStr}</span></div>}
            </div>

            {/* Footer */}
            <div className="text-center border-t border-gray-300 pt-1">
              <p className="text-[9px] text-gray-400">Thank you for choosing PH PathLabs</p>
              <p className="text-[9px] text-gray-400">(F) = Fasting Required</p>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-2 pt-1">
            <Button variant="outline" className="flex-1 gap-1.5" onClick={handleDownload}>
              <Download className="h-4 w-4" /> Download
            </Button>
            <Button className="flex-1 gap-1.5" onClick={handleShare}>
              <Share2 className="h-4 w-4" /> Reshare
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ReceiptViewDialog;
