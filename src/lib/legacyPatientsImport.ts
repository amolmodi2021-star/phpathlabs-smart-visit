import { supabase } from "@/integrations/supabase/client";
import { parseExcelFile, exportToExcel } from "@/lib/excel";

export interface LegacyImportRow {
  umr_number: string;
  mobile_number: string;
  title?: string;
  patient_name: string;
  gender?: string;
  address?: string;
}

export interface LegacyImportResult {
  inserted: number;
  updated: number;
  skipped: { row: number; reason: string; data: any }[];
  total: number;
}

const norm = (v: any): string => String(v ?? "").replace(/\s+/g, " ").trim();
const upper = (v: any): string => norm(v).toUpperCase();
const mob10 = (v: any): string => String(v ?? "").replace(/\D/g, "").slice(-10);

const normalizeGender = (v: any): string | null => {
  const g = norm(v).toLowerCase();
  if (!g) return null;
  if (g.startsWith("m")) return "Male";
  if (g.startsWith("f")) return "Female";
  return "Unspecified";
};

export function downloadLegacyTemplate() {
  const sample = [
    {
      umr_number: "UMR0000001",
      mobile_number: "9876543210",
      title: "MR.",
      patient_name: "JOHN DOE",
      gender: "Male",
      address: "123 MAIN ROAD, CITY",
    },
  ];
  exportToExcel(sample, "Legacy_Patient_Import_Template");
}

export type LegacyImportProgress = {
  phase: "reading" | "importing";
  processed: number;
  total: number;
  inserted: number;
  updated: number;
  skipped: number;
};

const IMPORT_CHUNK = 500;

export async function importLegacyPatients(
  file: File,
  onProgress?: (p: LegacyImportProgress) => void,
): Promise<LegacyImportResult> {
  onProgress?.({ phase: "reading", processed: 0, total: 0, inserted: 0, updated: 0, skipped: 0 });
  const rows = await parseExcelFile(file);
  const result: LegacyImportResult = { inserted: 0, updated: 0, skipped: [], total: rows.length };

  const pick = (row: any, ...keys: string[]) => {
    for (const k of keys) {
      const found = Object.keys(row).find(
        (rk) => rk.toLowerCase().replace(/\s+|_/g, "") === k.toLowerCase().replace(/\s+|_/g, ""),
      );
      if (found && row[found] !== undefined && row[found] !== "") return row[found];
    }
    return "";
  };

  type Ready = {
    umr_id: string;
    patient_name: string;
    title: string;
    gender: string;
    mobile_number: string;
    address: string;
  };
  const ready: Ready[] = [];
  const seenUmr = new Set<string>();

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const umr = norm(pick(r, "umr_number", "umr", "umrid", "umrno"));
    const mobile = mob10(pick(r, "mobile_number", "mobile", "mobileno", "phone"));
    const name = upper(pick(r, "patient_name", "name", "patientname"));
    const title = upper(pick(r, "title"));
    const gender = normalizeGender(pick(r, "gender", "sex")) || "";
    const address = upper(pick(r, "address"));

    if (!umr) {
      result.skipped.push({ row: i + 2, reason: "Missing UMR", data: r });
      continue;
    }
    if (!mobile || mobile.length !== 10) {
      result.skipped.push({ row: i + 2, reason: "Invalid mobile", data: r });
      continue;
    }
    if (!name) {
      result.skipped.push({ row: i + 2, reason: "Missing patient name", data: r });
      continue;
    }
    if (seenUmr.has(umr)) {
      result.skipped.push({ row: i + 2, reason: "Duplicate UMR in file (kept first row)", data: r });
      continue;
    }
    seenUmr.add(umr);
    ready.push({
      umr_id: umr,
      patient_name: name,
      title,
      gender,
      mobile_number: mobile,
      address,
    });
  }

  const totalWork = ready.length;
  onProgress?.({
    phase: "importing",
    processed: 0,
    total: totalWork,
    inserted: 0,
    updated: 0,
    skipped: result.skipped.length,
  });

  for (let i = 0; i < ready.length; i += IMPORT_CHUNK) {
    const chunk = ready.slice(i, i + IMPORT_CHUNK);
    const { data, error } = await supabase.rpc("import_legacy_patients_batch" as any, {
      p_rows: chunk,
    });
    if (error) {
      throw new Error(error.message || "Batch import failed");
    }
    const inserted = Number((data as any)?.inserted || 0);
    const updated = Number((data as any)?.updated || 0);
    result.inserted += inserted;
    result.updated += updated;
    const untouched = Math.max(0, chunk.length - inserted - updated);
    if (untouched > 0) {
      result.skipped.push({
        row: 0,
        reason: `${untouched} row(s) already fully populated (chunk ${Math.floor(i / IMPORT_CHUNK) + 1})`,
        data: {},
      });
    }
    onProgress?.({
      phase: "importing",
      processed: Math.min(i + chunk.length, totalWork),
      total: totalWork,
      inserted: result.inserted,
      updated: result.updated,
      skipped: result.skipped.length,
    });
    await new Promise((r) => setTimeout(r, 0));
  }

  return result;
}

export function downloadSkippedReport(skipped: LegacyImportResult["skipped"]) {
  if (skipped.length === 0) return;
  exportToExcel(
    skipped.map((s) => ({ row: s.row, reason: s.reason, ...s.data })),
    "Legacy_Patient_Import_Skipped",
  );
}

export type LegacyPatientRow = {
  id: string;
  umr_id: string;
  patient_name: string;
  title: string | null;
  gender: string | null;
  mobile_number: string | null;
  address: string | null;
  legacy_imported_at: string | null;
};

export type UmrAllocatorStatus = {
  lastSequence: number;
  nextUmr: string;
  legacyCount: number;
  limsCount: number;
  masterTotal: number;
};

function formatUmr(n: number): string {
  const seq = Math.max(0, Math.floor(n));
  return `UMR${String(seq).padStart(7, "0")}`;
}

export async function fetchUmrAllocatorStatus(): Promise<UmrAllocatorStatus> {
  const [{ data: counter }, { count: legacyCount }, { count: limsCount }, { count: masterTotal }] =
    await Promise.all([
      supabase.from("umr_counter" as any).select("last_sequence").eq("counter_key", "main").maybeSingle(),
      supabase.from("patient_master").select("id", { count: "exact", head: true }).eq("source", "legacy"),
      supabase.from("patient_master").select("id", { count: "exact", head: true }).eq("source", "lims"),
      supabase.from("patient_master").select("id", { count: "exact", head: true }),
    ]);
  const lastSequence = Number((counter as any)?.last_sequence || 0) || 0;
  return {
    lastSequence,
    nextUmr: formatUmr(lastSequence + 1),
    legacyCount: legacyCount ?? 0,
    limsCount: limsCount ?? 0,
    masterTotal: masterTotal ?? 0,
  };
}

export async function fetchLegacyPatients(opts: {
  search?: string;
  page: number;
  pageSize: number;
}): Promise<{ rows: LegacyPatientRow[]; total: number }> {
  const pageSize = Math.min(Math.max(opts.pageSize || 50, 1), 200);
  const from = Math.max(opts.page, 0) * pageSize;
  const to = from + pageSize - 1;
  const qText = String(opts.search || "")
    .replace(/[%_,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  let q = supabase
    .from("patient_master")
    .select("id, umr_id, patient_name, title, gender, mobile_number, address, legacy_imported_at", {
      count: "exact",
    })
    .eq("source", "legacy")
    .order("legacy_imported_at", { ascending: false, nullsFirst: false })
    .order("umr_id", { ascending: true })
    .range(from, to);

  if (qText) {
    q = q.or(
      `umr_id.ilike.%${qText}%,patient_name.ilike.%${qText}%,mobile_number.ilike.%${qText}%`,
    );
  }

  const { data, error, count } = await q;
  if (error) throw error;
  return { rows: (data || []) as LegacyPatientRow[], total: count ?? 0 };
}

export async function deleteLegacyPatients(ids: string[]): Promise<number> {
  const unique = [...new Set(ids.map((id) => String(id || "").trim()).filter(Boolean))];
  if (!unique.length) return 0;
  let deleted = 0;
  const CHUNK = 200;
  for (let i = 0; i < unique.length; i += CHUNK) {
    const chunk = unique.slice(i, i + CHUNK);
    const { error, count } = await supabase
      .from("patient_master")
      .delete({ count: "exact" })
      .eq("source", "legacy")
      .in("id", chunk);
    if (error) throw error;
    deleted += count ?? chunk.length;
  }
  return deleted;
}

/** Delete every patient_master row imported from the old LIMS (`source = legacy`). */
export async function deleteAllLegacyPatients(): Promise<number> {
  let deleted = 0;
  for (;;) {
    const { data, error } = await supabase
      .from("patient_master")
      .select("id")
      .eq("source", "legacy")
      .limit(500);
    if (error) throw error;
    const ids = (data || []).map((r: any) => r.id).filter(Boolean);
    if (!ids.length) break;
    deleted += await deleteLegacyPatients(ids);
    if (ids.length < 500) break;
  }
  return deleted;
}
