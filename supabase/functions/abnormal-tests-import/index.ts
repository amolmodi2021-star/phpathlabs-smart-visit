import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as XLSX from "npm:xlsx@0.18.5";
import { z } from "npm:zod@3.25.76";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const BodySchema = z.object({
  fileBase64: z.string().min(1),
  fileName: z.string().optional(),
});

type ParsedRow = Record<string, unknown>;
type ImportRow = {
  contact_primary_key: string;
  test_name: string;
  test_date: string | null;
  result_value: string | null;
  normal_range: string | null;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
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

function parseExcelBase64(fileBase64: string): ParsedRow[] {
  const wb = XLSX.read(fileBase64, { type: "base64", cellDates: true, cellNF: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) return [];

  const range = XLSX.utils.decode_range(ws["!ref"] || "A1:A1");
  const headers: string[] = [];

  for (let c = range.s.c; c <= range.e.c; c++) {
    const headerCell = ws[XLSX.utils.encode_cell({ r: range.s.r, c })];
    const headerValue = String(readCellValue(headerCell) || "").trim();
    headers.push(headerValue || `Column ${c + 1}`);
  }

  const rows: ParsedRow[] = [];
  for (let r = range.s.r + 1; r <= range.e.r; r++) {
    const row: ParsedRow = {};
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

  return rows;
}

function normalizeNullableText(value: unknown): string | null {
  const normalized = String(value || "").trim();
  return normalized || null;
}

function buildLogicalKey(row: ImportRow): string {
  return `${row.contact_primary_key}||${row.test_name}||${row.test_date || ""}`;
}

function buildFingerprint(row: ImportRow): string {
  return `${row.contact_primary_key}||${row.test_name}||${row.test_date || ""}||${row.result_value || ""}||${row.normal_range || ""}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = BodySchema.safeParse(await req.json());
    if (!body.success) {
      return json({ error: body.error.flatten().fieldErrors }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const parsedRows = parseExcelBase64(body.data.fileBase64);
    const mappedRows = parsedRows
      .map((row) => {
        const keys = Object.keys(row);
        return {
          contact_primary_key: String(row[keys[0]] || "").trim(),
          test_name: String(row[keys[1]] || "").trim(),
          test_date: normalizeNullableText(row[keys[2]]),
          result_value: normalizeNullableText(row[keys[3]]),
          normal_range: normalizeNullableText(row[keys[4]]),
        } satisfies ImportRow;
      });

    const stats = {
      total: mappedRows.length,
      inserted: 0,
      updated: 0,
      skippedDup: 0,
      skippedInvalid: 0,
    };

    const dedupedMap = new Map<string, ImportRow>();
    for (const row of mappedRows) {
      if (!row.contact_primary_key || !row.test_name) {
        stats.skippedInvalid++;
        continue;
      }

      const logicalKey = buildLogicalKey(row);
      const existing = dedupedMap.get(logicalKey);
      if (!existing) {
        dedupedMap.set(logicalKey, row);
        continue;
      }

      if (buildFingerprint(existing) === buildFingerprint(row)) {
        stats.skippedDup++;
        continue;
      }

      dedupedMap.set(logicalKey, row);
    }

    const dedupedRows = Array.from(dedupedMap.values());
    if (dedupedRows.length === 0) {
      return json({ stats });
    }

    const primaryKeys = Array.from(new Set(dedupedRows.map((row) => row.contact_primary_key)));
    const existingMap = new Map<string, { id: string; fingerprint: string }>();

    const FETCH_BATCH = 200;
    for (let i = 0; i < primaryKeys.length; i += FETCH_BATCH) {
      const batch = primaryKeys.slice(i, i + FETCH_BATCH);
      const { data, error } = await supabase
        .from("crm_abnormal_tests")
        .select("id, contact_primary_key, test_name, test_date, result_value, normal_range")
        .in("contact_primary_key", batch);

      if (error) {
        return json({ error: error.message }, 400);
      }

      for (const row of data || []) {
        const normalized: ImportRow = {
          contact_primary_key: row.contact_primary_key,
          test_name: row.test_name,
          test_date: row.test_date,
          result_value: row.result_value,
          normal_range: row.normal_range,
        };
        existingMap.set(buildLogicalKey(normalized), {
          id: row.id,
          fingerprint: buildFingerprint(normalized),
        });
      }
    }

    const toInsert: ImportRow[] = [];
    const toUpdate: Array<{ id: string; result_value: string | null; normal_range: string | null }> = [];

    for (const row of dedupedRows) {
      const logicalKey = buildLogicalKey(row);
      const fingerprint = buildFingerprint(row);
      const existing = existingMap.get(logicalKey);

      if (!existing) {
        toInsert.push(row);
        stats.inserted++;
        continue;
      }

      if (existing.fingerprint === fingerprint) {
        stats.skippedDup++;
        continue;
      }

      toUpdate.push({
        id: existing.id,
        result_value: row.result_value,
        normal_range: row.normal_range,
      });
      stats.updated++;
    }

    const INSERT_BATCH = 500;
    for (let i = 0; i < toInsert.length; i += INSERT_BATCH) {
      const batch = toInsert.slice(i, i + INSERT_BATCH);
      const { error } = await supabase.from("crm_abnormal_tests").insert(batch);
      if (error) {
        return json({ error: error.message }, 400);
      }
    }

    const UPDATE_BATCH = 50;
    for (let i = 0; i < toUpdate.length; i += UPDATE_BATCH) {
      const batch = toUpdate.slice(i, i + UPDATE_BATCH);
      const results = await Promise.all(
        batch.map((row) =>
          supabase
            .from("crm_abnormal_tests")
            .update({ result_value: row.result_value, normal_range: row.normal_range })
            .eq("id", row.id)
        )
      );

      const failed = results.find((result) => result.error);
      if (failed?.error) {
        return json({ error: failed.error.message }, 400);
      }
    }

    return json({ stats, fileName: body.data.fileName || null });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "Internal error" }, 500);
  }
});