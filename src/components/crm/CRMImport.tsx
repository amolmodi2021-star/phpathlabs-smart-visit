import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { parseExcelFile } from "@/lib/excel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Upload } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

interface ImportStats {
  added: number;
  updated: number;
  skippedBlacklist: number;
  skippedDuplicate: number;
  upgradedFromNonPhpl: number;
  skippedInvalid: number;
}

const COLUMN_MAP: Record<number, string> = {
  0: "location",         // A - LOCATION_NAME
  1: "umr_number",       // B - UMR_NO
  2: "bill_number",      // C - BILL_NO
  3: "visit_date",       // D - TRANSACTION_DT
  4: "patient_name",     // E - PATIENT_NAME
  5: "mobile_number",    // F - MOBILE_PHONE
  6: "visit_type",       // G - REFERENCE_SOURCE_NAME
  // 7 skipped (H - COMPANY_NAME)
  8: "doctor_name",      // I - REFRL_CUSTOMER_NAME
  // 9 skipped (J - REFERAL_NAME)
  10: "gross_amount",    // K - GROSS_AMOUNT
  11: "discount_amount", // L - CONCESSION_AMOUNT
  12: "net_amount",      // M - NET_AMOUNT
  13: "paid_amount",     // N - PAID_AMOUNT
  14: "due_amount",      // O - DUE_AMOUNT
  15: "payment_type",    // P - PAYMENT_TYPE
  16: "remarks",         // Q - REMARKS
  17: "created_by",      // R - CREATE_BY
};

function normalizeMobile(val: unknown): string {
  const s = String(val || "").replace(/\D/g, "");
  return s.slice(-10);
}

function mapRow(row: Record<string, unknown>): Record<string, unknown> | null {
  const keys = Object.keys(row);
  const mapped: Record<string, unknown> = {};
  keys.forEach((key, idx) => {
    const field = COLUMN_MAP[idx];
    if (field) mapped[field] = row[key];
  });
  
  // Always generate primary_key from umr_number + mobile_number
  const umr = String(mapped.umr_number || "").trim();
  const mob = normalizeMobile(mapped.mobile_number);
  if (mob.length === 10) {
    mapped.primary_key = umr ? `${umr}|${mob}` : `NOPHPL|${mob}`;
  } else {
    return null;
  }
  
  mapped.mobile_number = mob;
  // numeric fields
  for (const f of ["gross_amount", "discount_amount", "net_amount", "paid_amount", "due_amount"]) {
    mapped[f] = parseFloat(String(mapped[f] || "0")) || 0;
  }
  // defaults
  mapped.default_discount_pct = 20;
  mapped.record_tag = "DAILY";
  return mapped;
}

const CRMImport = () => {
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [stats, setStats] = useState<ImportStats | null>(null);
  const [preview, setPreview] = useState<Record<string, unknown>[]>([]);
  const qc = useQueryClient();

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const rows = await parseExcelFile(file);
      setPreview(rows.slice(0, 5));
      // Debug: log first row keys and column count
      if (rows.length > 0) {
        console.log("CRM Import: columns found:", Object.keys(rows[0]));
        console.log("CRM Import: column count:", Object.keys(rows[0]).length);
        console.log("CRM Import: first row sample:", rows[0]);
      }
      toast.success(`Parsed ${rows.length} rows with ${rows.length > 0 ? Object.keys(rows[0]).length : 0} columns. Click Import to proceed.`);
      (window as any).__crmImportRows = rows;
    } catch {
      toast.error("Failed to parse Excel file");
    }
    e.target.value = "";
  };

  const handleImport = async () => {
    const rows: Record<string, unknown>[] = (window as any).__crmImportRows;
    if (!rows?.length) return toast.error("No data to import. Upload an Excel file first.");
    setImporting(true);
    setStats(null);
    setProgress(0);

    const s: ImportStats = { added: 0, updated: 0, skippedBlacklist: 0, skippedDuplicate: 0, upgradedFromNonPhpl: 0, skippedInvalid: 0 };

    // Fetch blacklist
    const { data: blacklistData } = await supabase.from("crm_blacklist").select("mobile_number");
    const blacklist = new Set((blacklistData || []).map((b: any) => b.mobile_number));

    // Fetch existing contacts
    const { data: existingData } = await supabase.from("crm_contacts").select("primary_key, bill_number, location, mobile_number");
    const existingMap = new Map<string, any>();
    const mobileToNonPhpl = new Map<string, string>();
    (existingData || []).forEach((c: any) => {
      existingMap.set(c.primary_key, c);
      if (c.location === "NON PHPL" && c.mobile_number) {
        mobileToNonPhpl.set(c.mobile_number, c.primary_key);
      }
    });

    const seenPks = new Set<string>();
    const BATCH = 50;

    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      const toUpsert: any[] = [];
      const nonPhplToDelete: string[] = [];

      for (const raw of batch) {
        const mapped = mapRow(raw);
        if (!mapped) { s.skippedInvalid++; continue; }
        const pk = String(mapped.primary_key).trim();
        if (seenPks.has(pk)) { s.skippedDuplicate++; continue; }
        seenPks.add(pk);

        const mobile = String(mapped.mobile_number);
        if (blacklist.has(mobile)) { s.skippedBlacklist++; continue; }

        // Check NON PHPL → PH VESU upgrade
        const location = String(mapped.location || "");
        if (location !== "NON PHPL" && mobileToNonPhpl.has(mobile)) {
          const oldPk = mobileToNonPhpl.get(mobile)!;
          if (oldPk !== pk) {
            nonPhplToDelete.push(oldPk);
            s.upgradedFromNonPhpl++;
          }
        }

        const existing = existingMap.get(pk);
        if (existing) {
          const newBill = String(mapped.bill_number || "");
          const oldBill = String(existing.bill_number || "");
          if (newBill > oldBill) {
            toUpsert.push(mapped);
            s.updated++;
          } else {
            // Still update patient_name if it changed (latest name wins)
            const newName = String(mapped.patient_name || "").trim();
            const oldName = String(existing.patient_name || "").trim();
            if (newName && newName !== oldName) {
              toUpsert.push({ primary_key: pk, patient_name: newName });
              s.updated++;
            } else {
              s.skippedDuplicate++;
            }
          }
        } else {
          toUpsert.push(mapped);
          s.added++;
        }
      }

      // Delete NON PHPL records that got upgraded
      if (nonPhplToDelete.length > 0) {
        await supabase.from("crm_contacts").delete().in("primary_key", nonPhplToDelete);
      }

      if (toUpsert.length > 0) {
        const { error } = await supabase.from("crm_contacts").upsert(toUpsert, { onConflict: "primary_key" });
        if (error) console.error("Upsert error:", error);
      }

      setProgress(Math.round(((i + batch.length) / rows.length) * 100));
    }

    setStats(s);
    setImporting(false);
    setProgress(100);
    delete (window as any).__crmImportRows;
    qc.invalidateQueries({ queryKey: ["crm-contacts"] });
    qc.invalidateQueries({ queryKey: ["crm-contacts-count"] });
    toast.success("Import complete!");
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle>Import Patient / Prospect Data</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Upload an Excel file with columns A–U. Column U (Primary Key: UMR|Mobile) must be unique.
            Existing records update only when the new bill number is greater.
            NON PHPL records auto-upgrade to PH VESU when a registered patient with matching mobile is imported.
          </p>
          <div className="flex gap-2 items-center">
            <Input type="file" accept=".xlsx,.xls" onChange={handleFile} disabled={importing} />
            <Button onClick={handleImport} disabled={importing}>
              <Upload className="h-4 w-4 mr-1" />{importing ? "Importing..." : "Import"}
            </Button>
          </div>
          {importing && <Progress value={progress} />}
          {stats && (
            <div className="grid grid-cols-2 md:grid-cols-6 gap-2 text-sm">
              <div className="p-2 bg-muted rounded"><span className="font-medium">Added:</span> {stats.added}</div>
              <div className="p-2 bg-muted rounded"><span className="font-medium">Updated:</span> {stats.updated}</div>
              <div className="p-2 bg-muted rounded"><span className="font-medium">Skipped (Invalid):</span> {stats.skippedInvalid}</div>
              <div className="p-2 bg-muted rounded"><span className="font-medium">Skipped (Dup):</span> {stats.skippedDuplicate}</div>
              <div className="p-2 bg-muted rounded"><span className="font-medium">Skipped (Blacklist):</span> {stats.skippedBlacklist}</div>
              <div className="p-2 bg-muted rounded"><span className="font-medium">Upgraded:</span> {stats.upgradedFromNonPhpl}</div>
            </div>
          )}
        </CardContent>
      </Card>

      {preview.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Preview (First 5 Rows)</CardTitle></CardHeader>
          <CardContent>
            <div className="overflow-auto text-xs">
              <table className="w-full border-collapse">
                <thead>
                  <tr>{Object.keys(preview[0]).map((k, i) => <th key={i} className="border p-1 bg-muted text-left">{k}</th>)}</tr>
                </thead>
                <tbody>
                  {preview.map((row, ri) => (
                    <tr key={ri}>{Object.values(row).map((v, ci) => <td key={ci} className="border p-1">{String(v ?? "")}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default CRMImport;
