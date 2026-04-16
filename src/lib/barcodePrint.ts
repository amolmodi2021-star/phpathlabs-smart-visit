import { format } from "date-fns";
import JsBarcode from "jsbarcode";
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
 * Print barcode stickers for a registration's sample tubes.
 * Sticker layout: 50mm x 25mm, scanner-safe CODE128 with quiet zone.
 */
export const printBarcodes = async (reg: any, tubes: BarcodeTube[]): Promise<void> => {
  return new Promise(async (resolve) => {
    const printWindow = window.open("", "_blank", "width=400,height=600");
    if (!printWindow) { toast.error("Pop-up blocked. Please allow pop-ups."); resolve(); return; }

    const ppMap = await getPickupPointMap();
    const age = calcAge(reg.dob);
    const gender = reg.gender ? reg.gender.charAt(0) : "";
    const location = reg.pickup_point_id ? ppMap[reg.pickup_point_id] || "" : "";
    const dateTime = format(new Date(), "dd-MM-yyyy hh:mm a");
    const patientName = reg.patient_name || "";

    let html = `<!DOCTYPE html><html><head><style>
      @page { size: 50mm 25mm; margin: 0; }
      html, body { margin: 0; padding: 0; font-family: 'Arial', sans-serif; }
      .label {
        width: 50mm; height: 25mm;
        padding: 0.5mm 0.8mm;
        box-sizing: border-box;
        break-inside: avoid;
        page-break-inside: avoid;
        overflow: hidden;
        display: grid;
        grid-template-rows: 3mm 3mm 8mm 2.8mm 3mm;
        row-gap: 0.3mm;
      }
      .label + .label { break-before: page; page-break-before: always; }
      .row1 { display: flex; justify-content: space-between; font-size: 7pt; font-weight: bold; line-height: 1; white-space: nowrap; overflow: hidden; }
      .row2 { font-size: 6.5pt; font-weight: bold; line-height: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .barcode-wrap { text-align: center; line-height: 0; overflow: hidden; padding: 0 3mm; box-sizing: border-box; display: flex; align-items: center; justify-content: center; }
      .barcode-wrap svg { display: block; }
      .sample-id { text-align: center; font-size: 5.5pt; font-weight: bold; line-height: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .row-bottom { display: flex; justify-content: space-between; font-size: 6pt; line-height: 1; white-space: nowrap; overflow: hidden; }
      .row-bottom span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    </style></head><body>`;

    for (const tube of tubes) {
      const barcodeValue = tube.suffix ? `${reg.invoice_number}${tube.suffix}` : reg.invoice_number;
      const svgEl = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      try { JsBarcode(svgEl, barcodeValue, { format: "CODE128", width: 2, height: 40, displayValue: false, margin: 0 }); } catch { /* fallback */ }
      // Force exact physical dimensions on the SVG so the printer rasterizes vector bars at native DPI
      svgEl.setAttribute("width", "42mm");
      svgEl.setAttribute("height", "8mm");
      svgEl.setAttribute("preserveAspectRatio", "none");
      const barcodeSvg = svgEl.outerHTML;

      html += `<div class="label">
        <div class="row1"><span>${reg.invoice_number}</span><span>${age}${gender ? `/${gender}` : ""}</span></div>
        <div class="row2">${patientName}${location ? ` &nbsp; PH ${location}` : ""}</div>
        <div class="barcode-wrap">${barcodeSvg}</div>
        <div class="sample-id">${barcodeValue}&nbsp;<small style="color:#888">${tube.sample_uid}</small></div>
        <div class="row-bottom">
          <span>${tube.sample_type || tube.tube_type || ""}</span>
          <span>${dateTime}</span>
        </div>
      </div>`;
    }

    html += "</body></html>";
    printWindow.document.write(html);
    printWindow.document.close();
    let resolved = false;
    const doResolve = () => { if (!resolved) { resolved = true; resolve(); } };
    printWindow.onafterprint = () => doResolve();
    printWindow.onload = () => { printWindow.print(); setTimeout(doResolve, 1000); };
    setTimeout(doResolve, 3000);
  });
};
