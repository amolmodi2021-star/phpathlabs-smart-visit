import * as XLSX from "xlsx";
// @ts-ignore - xlsx-populate doesn't have types
import XlsxPopulate from "xlsx-populate";

const EXPORT_PASSWORD = "9819111107";

export async function exportToExcel(data: Record<string, unknown>[], filename: string) {
  const workbook = await XlsxPopulate.fromBlankAsync();
  const sheet = workbook.sheet(0);

  if (data.length === 0) return;

  const headers = Object.keys(data[0]);
  
  // Write headers (bold)
  headers.forEach((h, i) => {
    sheet.cell(1, i + 1).value(h).style("bold", true);
  });

  // Write data rows
  data.forEach((row, ri) => {
    headers.forEach((h, ci) => {
      sheet.cell(ri + 2, ci + 1).value(row[h] as any);
    });
  });

  const blob = await workbook.outputAsync({ password: EXPORT_PASSWORD });
  const url = URL.createObjectURL(blob as Blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${filename}.xlsx`;
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
