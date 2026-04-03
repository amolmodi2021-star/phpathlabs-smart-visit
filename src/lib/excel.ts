import * as XLSX from "xlsx";

const EXPORT_PASSWORD = "9819111107";

export function verifyExportPassword(input: string): boolean {
  return input === EXPORT_PASSWORD;
}

export function exportToExcel(data: Record<string, unknown>[], filename: string) {
  const normalized = data.map((row) => {
    const next: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      next[key] = normalizeExcelValue(value);
    }
    return next;
  });

  const ws = XLSX.utils.json_to_sheet(normalized);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  XLSX.writeFile(wb, `${filename}.xlsx`);
}

function formatDateValue(date: Date): string {
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yyyy = date.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

function normalizeDateString(value: string): string {
  const trimmed = value.trim();

  const isoMatch = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (isoMatch) {
    const [, year, month, day] = isoMatch;
    return `${day.padStart(2, "0")}-${month.padStart(2, "0")}-${year}`;
  }

  const shortMatch = trimmed.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/);
  if (shortMatch) {
    const [, day, month, yearValue] = shortMatch;
    const year = yearValue.length === 2 ? `20${yearValue}` : yearValue;
    return `${day.padStart(2, "0")}-${month.padStart(2, "0")}-${year}`;
  }

  return value;
}

function normalizeExcelValue(value: unknown): unknown {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return formatDateValue(value);
  }

  if (typeof value === "string") {
    return normalizeDateString(value);
  }

  return value;
}

function readCellValue(cell?: XLSX.CellObject): unknown {
  if (!cell) return "";

  if (cell.t === "d" && cell.v instanceof Date) {
    return formatDateValue(cell.v);
  }

  if (
    cell.t === "n" &&
    typeof cell.v === "number" &&
    typeof cell.z === "string" &&
    /[dmyhs]/i.test(cell.z)
  ) {
    const parsed = XLSX.SSF.parse_date_code(cell.v);
    if (parsed) {
      return `${String(parsed.d).padStart(2, "0")}-${String(parsed.m).padStart(2, "0")}-${parsed.y}`;
    }
  }

  if (typeof cell.w === "string") {
    return normalizeDateString(cell.w);
  }

  return normalizeExcelValue(cell.v ?? "");
}

export function parseExcelFile(file: File): Promise<Record<string, unknown>[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        const wb = XLSX.read(data, { type: "array", cellDates: true, cellNF: true });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const range = XLSX.utils.decode_range(ws["!ref"] || "A1:A1");
        const headers: string[] = [];

        for (let c = range.s.c; c <= range.e.c; c++) {
          const headerCell = ws[XLSX.utils.encode_cell({ r: range.s.r, c })];
          const headerValue = String(readCellValue(headerCell) || "").trim();
          headers.push(headerValue || `Column ${c + 1}`);
        }

        const rows: Record<string, unknown>[] = [];

        for (let r = range.s.r + 1; r <= range.e.r; r++) {
          const row: Record<string, unknown> = {};
          let hasValues = false;

          for (let c = range.s.c; c <= range.e.c; c++) {
            const header = headers[c - range.s.c];
            const cell = ws[XLSX.utils.encode_cell({ r, c })];
            const value = readCellValue(cell);
            row[header] = value;
            if (value !== "") hasValues = true;
          }

          if (hasValues) rows.push(row);
        }

        resolve(rows);
      } catch (err) {
        reject(err);
      }
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
