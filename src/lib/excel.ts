import * as XLSX from "xlsx";
import { BlobWriter, BlobReader, ZipWriter } from "@zip.js/zip.js";

const EXPORT_PASSWORD = "9819111107";

export async function exportToExcel(data: Record<string, unknown>[], filename: string) {
  // 1. Build Excel in memory
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  const xlsxBuffer = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  const xlsxBlob = new Blob([xlsxBuffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });

  // 2. Wrap in password-protected ZIP
  const zipBlobWriter = new BlobWriter("application/zip");
  const zipWriter = new ZipWriter(zipBlobWriter, { password: EXPORT_PASSWORD });
  await zipWriter.add(`${filename}.xlsx`, new BlobReader(xlsxBlob));
  const zipBlob = await zipWriter.close();

  // 3. Download
  const url = URL.createObjectURL(zipBlob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${filename}.zip`;
  a.click();
  URL.revokeObjectURL(url);
}

export function parseExcelFile(file: File): Promise<Record<string, unknown>[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json(ws);
        resolve(json as Record<string, unknown>[]);
      } catch (err) { reject(err); }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

export async function downloadTemplate() {
  const template = [
    { "Test Name": "", Price: "", "Fasting Required": "No", "Discount Applicable": "Yes", Description: "" },
  ];
  await exportToExcel(template, "test_upload_template");
}
