import { format } from "date-fns";
import { jsPDF } from "jspdf";
import bwipjs from "bwip-js/browser";
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
    includetext: false,
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

    const cleanSuffix = tube.suffix?.trim();
    const displayValue = cleanSuffix ? `${reg.invoice_number}${cleanSuffix}` : reg.invoice_number;
    // Clean alphanumeric payload only — "auto-Enter" must be configured on the scanner (CR suffix), not baked into the barcode
    const barcodeValue = displayValue;

    // --- Row 1: invoice number (left) | age/sex (right) ---
    doc.setFontSize(8.5);
    doc.setFont("helvetica", "bold");
    doc.text(String(reg.invoice_number), 3.5, 2.5);
    doc.setFontSize(7);
    const ageSex = `${age}${gender ? `/${gender}` : ""}`;
    if (ageSex) doc.text(ageSex, 46.5, 2.5, { align: "right" });

    // --- Row 2: patient name + location ---
    doc.setFontSize(8);
    doc.setFont("helvetica", "bold");
    const nameLine = location ? `${patientName}  PH ${location}` : patientName;
    // truncate to fit safe printable width (~43mm)
    const truncated = doc.splitTextToSize(nameLine, 43)[0];
    doc.text(truncated, 3.5, 5.5);

    // --- Barcode (centered, 46mm x 12mm) — taller + proper quiet zone for Indiko Plus ---
    try {
      const png = renderBarcodePng(barcodeValue);
      doc.addImage(png, "PNG", 6.5, 7.5, 37, 10, undefined, "FAST");
    } catch (err) {
      console.error("Barcode render failed:", err);
    }

    // --- Sample ID line (centered, shifted down for taller barcode) ---
    doc.setFontSize(8);
    doc.setFont("helvetica", "bold");
    doc.text(displayValue, 25, 20.5, { align: "center" });

    // --- Bottom row: sample type (left) | datetime (right) ---
    doc.setFontSize(6);
    doc.setFont("helvetica", "bold");
    const sampleType = tube.sample_type || tube.tube_type || "";
    if (sampleType) doc.text(sampleType, 3.5, 23.5);
    doc.text(dateTime, 46.5, 23.5, { align: "right" });
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
    // Use srcdoc with an embedded PDF — keeps the iframe document same-origin
    // so iframe.contentWindow.print() doesn't throw a SecurityError on lovable.app preview.
    iframe.srcdoc = `<!doctype html><html><head><style>html,body,embed{margin:0;padding:0;width:100%;height:100%;border:0;}</style></head><body><embed type="application/pdf" src="${blobUrl}" /></body></html>`;

    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      try { URL.revokeObjectURL(blobUrl); } catch { /* ignore */ }
      try { iframe.parentNode?.removeChild(iframe); } catch { /* ignore */ }
    };

    let printed = false;
    const triggerPrint = () => {
      if (printed) return;
      printed = true;
      // Give the embedded PDF viewer a tick to fully initialize
      setTimeout(() => {
        try {
          iframe.contentWindow?.focus();
          iframe.contentWindow?.print();
        } catch (err) {
          console.error("Print failed:", err);
          toast.error("Print failed. Please try again.");
        }
        // Resolve immediately so the caller (e.g. sample collection) isn't blocked
        resolve();
        // Cleanup after a generous delay so the print job has time to dispatch
        setTimeout(cleanup, 60_000);
      }, 400);
    };

    iframe.onload = triggerPrint;
    document.body.appendChild(iframe);
    // Safety net — if onload never fires (e.g. embed plugin issue), still resolve
    setTimeout(() => { if (!printed) { triggerPrint(); } }, 2_000);
  });
};
