import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { parseExcelFile } from "@/lib/excel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Upload } from "lucide-react";
import { toast } from "sonner";

interface ImportStats {
  staged: number;
  skippedInvalid: number;
  skippedDuplicate: number;
  blacklisted: number;
  updates: number;
}

const COLUMN_MAP: Record<number, string> = {
  0: "location",
  1: "umr_number",
  2: "bill_number",
  3: "visit_date",
  4: "patient_name",
  5: "mobile_number",
  6: "visit_type",
  9: "doctor_name",
  10: "gross_amount",
  11: "discount_amount",
  12: "net_amount",
  13: "paid_amount",
  14: "due_amount",
  15: "payment_type",
  16: "remarks",
  17: "created_by",
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

  const umr = String(mapped.umr_number || "").trim();
  const mob = normalizeMobile(mapped.mobile_number);
  if (mob.length !== 10) return null;

  mapped.primary_key = `${umr}|${mob}`;
  mapped.mobile_number = mob;
  for (const f of ["gross_amount", "discount_amount", "net_amount", "paid_amount", "due_amount"]) {
    mapped[f] = parseFloat(String(mapped[f] || "0")) || 0;
  }
  mapped.default_discount_pct = 20;
  mapped.record_tag = "DAILY";
  return mapped;
}

const CRMImport = () => {
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [stats, setStats] = useState<ImportStats | null>(null);
  const [preview, setPreview] = useState<Record<string, unknown>[]>([]);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const rows = await parseExcelFile(file);
      setPreview(rows.slice(0, 5));
      toast.success(`Parsed ${rows.length} rows. Click "Stage for Review" to proceed.`);
      (window as any).__crmImportRows = rows;
    } catch {
      toast.error("Failed to parse Excel file");
    }
    e.target.value = "";
  };

  const handleStage = async () => {
    const rows: Record<string, unknown>[] = (window as any).__crmImportRows;
    if (!rows?.length) return toast.error("No data. Upload an Excel file first.");
    setImporting(true);
    setStats(null);
    setProgress(0);

    const s: ImportStats = { staged: 0, skippedInvalid: 0, skippedDuplicate: 0, blacklisted: 0, updates: 0 };

    // Fetch blacklist
    const { data: blData } = await supabase.from("crm_blacklist").select("mobile_number");
    const blacklist = new Set((blData || []).map((b: any) => b.mobile_number));

    // Fetch ALL existing contacts (batched to bypass 1000 row limit)
    const existingMap = new Map<string, { bill_number: string | null }>();
    {
      const FETCH_BATCH = 900;
      let from = 0;
      let keepFetching = true;
      while (keepFetching) {
        const { data: chunk } = await supabase
          .from("crm_contacts")
          .select("primary_key, bill_number")
          .order("created_at", { ascending: true })
          .range(from, from + FETCH_BATCH - 1);
        if (!chunk || chunk.length === 0) break;
        for (const c of chunk) {
          existingMap.set(c.primary_key, { bill_number: c.bill_number });
        }
        if (chunk.length < FETCH_BATCH) keepFetching = false;
        else from += FETCH_BATCH;
      }
    }

    // Clear old staging data first
    await supabase.from("crm_import_staging").delete().neq("id", "00000000-0000-0000-0000-000000000000");

    const batchId = crypto.randomUUID();
    const seenPks = new Set<string>();
    const BATCH = 200;

    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      const toInsert: any[] = [];

      for (const raw of batch) {
        const mapped = mapRow(raw);
        if (!mapped) { s.skippedInvalid++; continue; }
        const pk = String(mapped.primary_key).trim();
        if (seenPks.has(pk)) { s.skippedDuplicate++; continue; }
        seenPks.add(pk);

        const mobile = String(mapped.mobile_number);
        const isBlacklisted = blacklist.has(mobile);
        const existingRecord = existingMap.get(pk);
        const isUpdate = !!existingRecord;

        // Skip if record exists and new bill_number is not greater
        if (isUpdate) {
          const existingBill = existingRecord.bill_number || "";
          const newBill = mapped.bill_number ? String(mapped.bill_number) : "";
          if (newBill <= existingBill) {
            s.skippedDuplicate++;
            continue;
          }
        }

        toInsert.push({
          batch_id: batchId,
          primary_key: pk,
          patient_name: mapped.patient_name || null,
          mobile_number: mobile,
          umr_number: mapped.umr_number || null,
          location: mapped.location || null,
          bill_number: mapped.bill_number ? String(mapped.bill_number) : null,
          visit_date: mapped.location === "NON PHPL" ? null : (mapped.visit_date ? String(mapped.visit_date) : null),
          visit_type: mapped.visit_type || null,
          gross_amount: mapped.gross_amount,
          discount_amount: mapped.discount_amount,
          net_amount: mapped.net_amount,
          paid_amount: mapped.paid_amount,
          due_amount: mapped.due_amount,
          payment_type: mapped.payment_type || null,
          remarks: mapped.remarks || null,
          created_by: mapped.created_by || null,
          doctor_name: mapped.doctor_name || null,
          default_discount_pct: 20,
          record_tag: "DAILY",
          is_blacklisted: isBlacklisted,
          is_update: isUpdate,
        });
        s.staged++;
      }

      if (toInsert.length > 0) {
        const { error } = await supabase.from("crm_import_staging").insert(toInsert);
        if (error) console.error("Staging insert error:", error);
      }

      setProgress(Math.round(((i + batch.length) / rows.length) * 100));
    }

    setStats(s);
    setImporting(false);
    setProgress(100);
    delete (window as any).__crmImportRows;
    toast.success(`${s.staged} records staged for review. Go to "Review & Approve" tab.`);
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader><CardTitle>Import Patient / Prospect Data</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Upload an Excel file (columns A–R). Data will be staged for review before being imported to Contacts.
            Records are tagged as "DAILY" with 20% default discount. Blacklisted numbers will be flagged.
          </p>
          <div className="flex gap-2 items-center">
            <Input type="file" accept=".xlsx,.xls" onChange={handleFile} disabled={importing} />
            <Button onClick={handleStage} disabled={importing}>
              <Upload className="h-4 w-4 mr-1" />{importing ? "Staging..." : "Stage for Review"}
            </Button>
          </div>
          {importing && <Progress value={progress} />}
          {stats && (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-sm">
              <div className="p-2 bg-muted rounded"><span className="font-medium">Staged:</span> {stats.staged}</div>
              <div className="p-2 bg-muted rounded"><span className="font-medium">Updates:</span> {stats.updates}</div>
              <div className="p-2 bg-muted rounded"><span className="font-medium">Blacklisted:</span> {stats.blacklisted}</div>
              <div className="p-2 bg-muted rounded"><span className="font-medium">Skipped (Invalid):</span> {stats.skippedInvalid}</div>
              <div className="p-2 bg-muted rounded"><span className="font-medium">Skipped (Dup):</span> {stats.skippedDuplicate}</div>
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
