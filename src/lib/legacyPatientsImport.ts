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

export async function importLegacyPatients(file: File): Promise<LegacyImportResult> {
  const rows = await parseExcelFile(file);
  const result: LegacyImportResult = { inserted: 0, updated: 0, skipped: [], total: rows.length };

  // Map header variations
  const pick = (row: any, ...keys: string[]) => {
    for (const k of keys) {
      const found = Object.keys(row).find((rk) => rk.toLowerCase().replace(/\s+|_/g, "") === k.toLowerCase().replace(/\s+|_/g, ""));
      if (found && row[found] !== undefined && row[found] !== "") return row[found];
    }
    return "";
  };

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const umr = norm(pick(r, "umr_number", "umr", "umrid", "umrno"));
    const mobile = mob10(pick(r, "mobile_number", "mobile", "mobileno", "phone"));
    const name = upper(pick(r, "patient_name", "name", "patientname"));
    const title = upper(pick(r, "title"));
    const gender = normalizeGender(pick(r, "gender", "sex"));
    const address = upper(pick(r, "address"));

    if (!umr) { result.skipped.push({ row: i + 2, reason: "Missing UMR", data: r }); continue; }
    if (!mobile || mobile.length !== 10) { result.skipped.push({ row: i + 2, reason: "Invalid mobile", data: r }); continue; }
    if (!name) { result.skipped.push({ row: i + 2, reason: "Missing patient name", data: r }); continue; }

    try {
      const { data: existing } = await supabase
        .from("patient_master")
        .select("id, patient_name, title, gender, mobile_number, address")
        .eq("umr_id", umr)
        .maybeSingle();

      if (existing) {
        // Only fill blanks — don't overwrite richer data
        const patch: any = {};
        if (!existing.patient_name && name) patch.patient_name = name;
        if (!(existing as any).title && title) patch.title = title;
        if (!existing.gender && gender) patch.gender = gender;
        if (!existing.mobile_number && mobile) patch.mobile_number = mobile;
        if (!(existing as any).address && address) patch.address = address;
        if (Object.keys(patch).length > 0) {
          const { error } = await supabase.from("patient_master").update(patch).eq("id", (existing as any).id);
          if (error) throw error;
          result.updated++;
        } else {
          result.skipped.push({ row: i + 2, reason: "UMR already has all fields populated", data: r });
        }
      } else {
        const { error } = await supabase.from("patient_master").insert({
          umr_id: umr,
          patient_name: name,
          title: title || null,
          gender: gender,
          mobile_number: mobile,
          address: address || null,
          source: "legacy",
          legacy_imported_at: new Date().toISOString(),
        } as any);
        if (error) throw error;
        result.inserted++;
      }
    } catch (e: any) {
      result.skipped.push({ row: i + 2, reason: e?.message || "Insert failed", data: r });
    }
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
