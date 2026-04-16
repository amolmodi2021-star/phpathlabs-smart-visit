import { format } from "date-fns";
import { jsPDF } from "jspdf";
import bwipjs from "bwip-js";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export interface BarcodeTube {
  id: string;
  sample_uid: string;
  suffix: string | null;
  tube_type: string | null;
  sample_type: string | null;
}

const calcAge = (dob: string | null) => {
  if (!dob) return "";
  const birth = new Date(dob);
  const now = new Date();
  return `${now.getFullYear() - birth.getFullYear()}`;
};

let cachedPickupPoints: Record<string, string> | null = null;
const getPickupPointMap = async (): Promise<Record<string, string>> => {
  if (cachedPickupPoints) return cachedPickupPoints;
  const { data } = await supabase.from("pickup_points").select("id, name");
  cachedPickupPoints = Object.fromEntries((data || []).map((p: any) => [p.id, p.name]));
  return cachedPickupPoints;
};

/**
 * Render a CODE128 barcode to a high-DPI PNG data URL using bwip-js.
 * scale=4 ≈ 300 DPI equivalent — razor-sharp on thermal (203 DPI) & laser (600 DPI) printers.
 */
const renderBarcodePng = (value: string): string => {
  const canvas = document.createElement("canvas");
  bwipjs.toCanvas(canvas, {
    bcid: "code128",
    text: value,
    scale: 4,
    height: 8, // mm
    includetext: false,
    paddingwidth: 0,
    paddingheight: 0,
    backgroundcolor: "FFFFFF",
  });
  return canvas.toDataURL("image/png");
};

/**
 * Print barcode stickers for a registration's sample tubes.
 *
 * Builds a multi-page PDF (one 50×25mm page per tube) using jsPDF + bwip-js,
 * then sends it straight to the printer via a hidden iframe — no new tab, no
 * PDF viewer. The browser's print dialog will appear once (this is a hard
 * browser security restriction — silent print requires Chrome's
 * `--kiosk-printing` flag enabled on the printing PC for true zero-click).
 */
export const printBarcodes = async (reg: any, tubes: BarcodeTube[]): Promise<void> => {
  if (!tubes.length) return;

  const ppMap = await getPickupPointMap();
  const age = calcAge(reg.dob);
  const gender = reg.gender ? reg.gender.charAt(0) : "";
  const location = reg.pickup_point_id ? ppMap[reg.pickup_point_id] || "" : "";
  const dateTime = format(new Date(), "dd-MM-yyyy hh:mm a");
  const patientName = reg.patient_name || "";

  // 50mm x 25mm landscape sticker
  const doc = new jsPDF({ unit: "mm", format: [50, 25], orientation: "landscape" });
  doc.setFont("helvetica");

  tubes.forEach((tube, idx) => {
    if (idx > 0) doc.addPage([50, 25], "landscape");

    const barcodeValue = tube.suffix ? `${reg.invoice_number}${tube.suffix}` : reg.invoice_number;

    // --- Row 1: invoice number (left) | age/sex (right) ---
    doc.setFontSize(7);
    doc.setFont("helvetica", "bold");
    doc.text(String(reg.invoice_number), 1, 2.5);
    const ageSex = `${age}${gender ? `/${gender}` : ""}`;
    if (ageSex) doc.text(ageSex, 49, 2.5, { align: "right" });

    // --- Row 2: patient name + location ---
    doc.setFontSize(6.5);
    doc.setFont("helvetica", "bold");
    const nameLine = location ? `${patientName}  PH ${location}` : patientName;
    // truncate to fit ~48mm width
    const truncated = doc.splitTextToSize(nameLine, 48)[0];
    doc.text(truncated, 1, 5.5);

    // --- Barcode (centered, 44mm x 8mm) ---
    try {
      const png = renderBarcodePng(barcodeValue);
      doc.addImage(png, "PNG", 3, 7, 44, 8, undefined, "FAST");
    } catch (err) {
      console.error("Barcode render failed:", err);
    }

    // --- Sample ID line (centered) ---
    doc.setFontSize(5.5);
    doc.setFont("helvetica", "bold");
    const sampleLine = `${barcodeValue}  ${tube.sample_uid}`;
    doc.text(sampleLine, 25, 17.5, { align: "center" });

    // --- Bottom row: sample type (left) | datetime (right) ---
    doc.setFontSize(6);
    doc.setFont("helvetica", "normal");
    const sampleType = tube.sample_type || tube.tube_type || "";
    if (sampleType) doc.text(sampleType, 1, 21);
    doc.text(dateTime, 49, 21, { align: "right" });
  });

  // Convert to blob and trigger print via hidden iframe (no new tab)
  const blob = doc.output("blob");
  const blobUrl = URL.createObjectURL(blob);

  return new Promise((resolve) => {
    const iframe = document.createElement("iframe");
    iframe.style.position = "fixed";
    iframe.style.right = "0";
    iframe.style.bottom = "0";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "0";
    iframe.style.visibility = "hidden";
    iframe.src = blobUrl;

    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      try { URL.revokeObjectURL(blobUrl); } catch { /* ignore */ }
      try { iframe.parentNode?.removeChild(iframe); } catch { /* ignore */ }
      resolve();
    };

    iframe.onload = () => {
      // Give the PDF viewer a tick to fully initialize before invoking print
      setTimeout(() => {
        try {
          iframe.contentWindow?.focus();
          iframe.contentWindow?.print();
        } catch (err) {
          console.error("Print failed:", err);
          toast.error("Print failed. Please try again.");
        }
        // Cleanup after a generous delay so the print job has time to dispatch
        setTimeout(cleanup, 60_000);
      }, 250);
    };

    document.body.appendChild(iframe);
  });
};
