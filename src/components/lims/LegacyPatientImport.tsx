import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Download, Upload, FileSpreadsheet, AlertCircle } from "lucide-react";
import PasswordGate from "@/components/PasswordGate";
import {
  downloadLegacyTemplate,
  importLegacyPatients,
  downloadSkippedReport,
  type LegacyImportResult,
} from "@/lib/legacyPatientsImport";

const LegacyPatientImportInner = () => {
  const [file, setFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<LegacyImportResult | null>(null);

  const handleImport = async () => {
    if (!file) { toast.error("Choose an Excel file first"); return; }
    setImporting(true);
    setResult(null);
    try {
      const res = await importLegacyPatients(file);
      setResult(res);
      toast.success(`Imported: ${res.inserted} new, ${res.updated} updated, ${res.skipped.length} skipped`);
    } catch (e: any) {
      toast.error(e?.message || "Import failed");
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="space-y-4 mt-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" /> Legacy Patient Import
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="text-sm text-muted-foreground space-y-1">
            <p>Bulk import patients from your old LIMS into the patient master.</p>
            <p>Required columns: <strong>umr_number</strong>, <strong>mobile_number</strong>, <strong>patient_name</strong>. Optional: title, gender, address.</p>
            <p>Records are matched by UMR. Existing fields are never overwritten — only blanks are filled.</p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={downloadLegacyTemplate}>
              <Download className="h-4 w-4 mr-2" /> Download Template
            </Button>
          </div>

          <div className="border-t pt-4 space-y-2">
            <Label>Upload Excel file (.xlsx)</Label>
            <div className="flex gap-2">
              <Input
                type="file"
                accept=".xlsx,.xls"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
              />
              <Button onClick={handleImport} disabled={!file || importing}>
                <Upload className="h-4 w-4 mr-2" /> {importing ? "Importing…" : "Import"}
              </Button>
            </div>
          </div>

          {result && (
            <div className="border rounded-md p-4 space-y-2 bg-muted/30">
              <h3 className="font-semibold text-sm">Import Summary</h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
                <div><span className="text-muted-foreground">Total rows:</span> <strong>{result.total}</strong></div>
                <div className="text-green-700"><span className="text-muted-foreground">Inserted:</span> <strong>{result.inserted}</strong></div>
                <div className="text-blue-700"><span className="text-muted-foreground">Updated:</span> <strong>{result.updated}</strong></div>
                <div className="text-amber-700"><span className="text-muted-foreground">Skipped:</span> <strong>{result.skipped.length}</strong></div>
              </div>
              {result.skipped.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-xs text-amber-700">
                    <AlertCircle className="h-3.5 w-3.5" /> {result.skipped.length} rows were skipped.
                  </div>
                  <Button size="sm" variant="outline" onClick={() => downloadSkippedReport(result.skipped)}>
                    <Download className="h-3.5 w-3.5 mr-1" /> Download Skipped Rows
                  </Button>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

const LegacyPatientImport = () => (
  <PasswordGate title="Legacy Patient Import">
    <LegacyPatientImportInner />
  </PasswordGate>
);

export default LegacyPatientImport;
