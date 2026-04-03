import * as XLSX from "xlsx";

const EXPORT_PASSWORD = "9819111107";

export function verifyExportPassword(input: string): boolean {
  return input === EXPORT_PASSWORD;
}

export function exportToExcel(data: Record<string, unknown>[], filename: string) {
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  XLSX.writeFile(wb, `${filename}.xlsx`);
}

function formatDateValue(val: unknown): unknown {
  if (val instanceof Date && !isNaN(val.getTime())) {
    const dd = String(val.getDate()).padStart(2, '0');
    const mm = String(val.getMonth() + 1).padStart(2, '0');
    const yyyy = val.getFullYear();
    return `${dd}-${mm}-${yyyy}`;
  }
  return val;
}

export function parseExcelFile(file: File): Promise<Record<string, unknown>[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: "array", cellDates: true });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json(ws, {
          defval: "",
          raw: false,
          dateNF: "dd-mm-yyyy",
        }) as Record<string, unknown>[];
        // Ensure all Date objects are formatted as dd-MM-yyyy strings
        const formatted = json.map((row) => {
          const newRow: Record<string, unknown> = {};
          for (const key of Object.keys(row)) {
            newRow[key] = formatDateValue(row[key]);
          }
          return newRow;
        });
        resolve(formatted);
      } catch (err) { reject(err); }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

export function downloadTemplate() {
  const template = [
    { "Test Name": "", Price: "", "Fasting Required": "No", "Discount Applicable": "Yes", Description: "" },
  ];
  exportToExcel(template, "test_upload_template");
}
