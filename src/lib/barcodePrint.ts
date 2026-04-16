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
 * Print barcode stickers — 50mm x 25mm thermal labels.
 * Barcode renders at native SVG module width (no stretching) for reliable scanning.
 * Strict page sizing prevents extra blank labels from being fed.
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

    let html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Barcodes</title><style>
      @page { size: 50mm 25mm; margin: 0; }
      * { box-sizing: border-box; }
      html, body {
        margin: 0; padding: 0;
        width: 50mm;
        font-family: Arial, sans-serif;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
      body { background: #fff; }
      .page {
        width: 50mm;
        height: 25mm;
        overflow: hidden;
        position: relative;
        page-break-inside: avoid;
        break-inside: avoid;
      }
      .page + .page {
        page-break-before: always;
        break-before: page;
      }
      .label {
        width: 50mm;
        height: 25mm;
        padding: 0.6mm 1mm;
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }
      .row1 {
        display: flex;
        justify-content: space-between;
        font-size: 7pt;
        font-weight: bold;
        line-height: 1.05;
        white-space: nowrap;
        overflow: hidden;
      }
      .row2 {
        font-size: 6.5pt;
        font-weight: bold;
        line-height: 1.05;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        margin-top: 0.3mm;
      }
      .barcode-wrap {
        flex: 1 1 auto;
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
        margin: 0.3mm 0;
      }
      .barcode-wrap svg {
        display: block;
        max-width: 100%;
        height: 8mm;
      }
      .sample-id {
        text-align: center;
        font-size: 5.5pt;
        font-weight: bold;
        line-height: 1;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .row-bottom {
        display: flex;
        justify-content: space-between;
        font-size: 6pt;
        line-height: 1;
        white-space: nowrap;
        overflow: hidden;
        margin-top: 0.3mm;
      }
      .row-bottom span {
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
    </style></head><body>`;

    for (const tube of tubes) {
      const barcodeValue = tube.suffix ? `${reg.invoice_number}${tube.suffix}` : reg.invoice_number;
      const svgEl = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      try {
        // Native module rendering — no stretching, no preserveAspectRatio override.
        // width=2 module, height=40 → bars stay crisp and scanner-readable.
        JsBarcode(svgEl, barcodeValue, {
          format: "CODE128",
          width: 2,
          height: 40,
          displayValue: false,
          margin: 0,
        });
      } catch { /* keep going */ }
      const barcodeSvg = svgEl.outerHTML;

      html += `<div class="page"><div class="label">
        <div class="row1"><span>${reg.invoice_number}</span><span>${age}${gender ? `/${gender}` : ""}</span></div>
        <div class="row2">${patientName}${location ? ` &nbsp; PH ${location}` : ""}</div>
        <div class="barcode-wrap">${barcodeSvg}</div>
        <div class="sample-id">${barcodeValue}&nbsp;<small style="color:#888">${tube.sample_uid}</small></div>
        <div class="row-bottom">
          <span>${tube.sample_type || tube.tube_type || ""}</span>
          <span>${dateTime}</span>
        </div>
      </div></div>`;
    }

    html += "</body></html>";
    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();

    let resolved = false;
    const doResolve = () => { if (!resolved) { resolved = true; resolve(); } };

    printWindow.onafterprint = () => {
      try { printWindow.close(); } catch { /* noop */ }
      doResolve();
    };

    const triggerPrint = () => {
      // Wait an extra frame so SVG layout is finalized before the printer snapshots.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          try { printWindow.focus(); printWindow.print(); } catch { /* noop */ }
          setTimeout(doResolve, 3000);
        });
      });
    };

    if (printWindow.document.readyState === "complete") {
      triggerPrint();
    } else {
      printWindow.onload = triggerPrint;
    }

    setTimeout(doResolve, 8000);
  });
};
