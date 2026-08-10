import { useEffect, useState, useSyncExternalStore } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { Download, Upload, FileSpreadsheet, AlertCircle, Trash2, Search, Loader2 } from "lucide-react";
import PasswordGate from "@/components/PasswordGate";
import {
  downloadLegacyTemplate,
  downloadSkippedReport,
  fetchLegacyPatients,
  fetchUmrAllocatorStatus,
  deleteLegacyPatients,
  deleteAllLegacyPatients,
  type LegacyPatientRow,
} from "@/lib/legacyPatientsImport";
import {
  getLegacyImportJob,
  startLegacyImport,
  subscribeLegacyImportJob,
} from "@/lib/legacyImportJob";

const PAGE_SIZE = 50;

function formatImportedAt(iso: string | null): string {
  if (!iso) return "—";
  try {
    return format(new Date(iso), "dd-MM-yyyy hh:mm a");
  } catch {
    return iso;
  }
}

const LegacyPatientImportInner = () => {
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const job = useSyncExternalStore(subscribeLegacyImportJob, getLegacyImportJob, getLegacyImportJob);
  const importing = job.importing;
  const importProgress = job.progress;
  const result = job.result;
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(0);
  const [deleting, setDeleting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<"all" | LegacyPatientRow | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(0);
    }, 350);
    return () => clearTimeout(t);
  }, [search]);

  const { data, isLoading, isFetching, isError, error } = useQuery({
    queryKey: ["legacy_patients", debouncedSearch, page],
    queryFn: () => fetchLegacyPatients({ search: debouncedSearch, page, pageSize: PAGE_SIZE }),
  });

  const { data: umrStatus } = useQuery({
    queryKey: ["umr_allocator_status"],
    queryFn: fetchUmrAllocatorStatus,
  });

  const rows = data?.rows || [];
  const total = data?.total || 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const refreshList = () => {
    void qc.invalidateQueries({ queryKey: ["legacy_patients"] });
    void qc.invalidateQueries({ queryKey: ["umr_allocator_status"] });
  };

  const handleImport = async () => {
    if (!file) {
      toast.error("Choose an Excel file first");
      return;
    }
    try {
      const res = await startLegacyImport(file);
      toast.success(
        `Imported ${res.inserted.toLocaleString()} new, ${res.updated.toLocaleString()} updated, ${res.skipped.length.toLocaleString()} skipped`,
      );
      await refreshList();
    } catch (e: any) {
      toast.error(e?.message || "Import failed");
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      if (deleteTarget === "all") {
        const n = await deleteAllLegacyPatients();
        toast.success(`Deleted ${n.toLocaleString()} legacy patient${n === 1 ? "" : "s"}`);
      } else {
        await deleteLegacyPatients([deleteTarget.id]);
        toast.success(`Deleted ${deleteTarget.patient_name || deleteTarget.umr_id}`);
      }
      setDeleteTarget(null);
      if (page > 0 && rows.length <= 1) setPage((p) => Math.max(0, p - 1));
      await refreshList();
    } catch (e: any) {
      toast.error(e?.message || "Delete failed");
    } finally {
      setDeleting(false);
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
            <p>
              Required columns: <strong>umr_number</strong>, <strong>mobile_number</strong>,{" "}
              <strong>patient_name</strong>. Optional: title, gender, address.
            </p>
            <p>Records are matched by UMR. Existing fields are never overwritten — only blanks are filled.</p>
            <p>
              Large files (~20,000 rows) import in batches of 500. After you click Import, a progress bar appears
              under the file picker.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={downloadLegacyTemplate}>
              <Download className="h-4 w-4 mr-2" /> Download Template
            </Button>
          </div>

          <div className="border-t pt-4 space-y-2">
            <Label>Upload Excel file (.xlsx)</Label>
            <div className="flex gap-2">
              <Input type="file" accept=".xlsx,.xls" onChange={(e) => setFile(e.target.files?.[0] || null)} />
              <Button onClick={handleImport} disabled={!file || importing}>
                <Upload className="h-4 w-4 mr-2" /> {importing ? "Importing…" : "Import"}
              </Button>
            </div>
            {(importing || importProgress || job.error) && (
              <div className="rounded-md border-2 border-primary bg-primary/5 px-3 py-3 space-y-1.5">
                <p className="text-sm font-semibold">
                  {job.error
                    ? `Import failed: ${job.error}`
                    : importProgress?.phase === "reading"
                      ? `Reading ${job.fileName || "Excel"}…`
                      : `Importing ${(importProgress?.processed || 0).toLocaleString()} / ${(importProgress?.total || 0).toLocaleString()}`}
                </p>
                {importing && (
                  <div className="h-3 rounded bg-muted overflow-hidden">
                    <div
                      className="h-full bg-primary transition-all"
                      style={{
                        width:
                          importProgress && importProgress.total > 0
                            ? `${Math.min(100, Math.round((importProgress.processed / importProgress.total) * 100))}%`
                            : "12%",
                      }}
                    />
                  </div>
                )}
                <p className="text-xs text-muted-foreground">
                  Keep this tab open. Batches of 500 — you can switch LIMS sub-tabs; import continues.
                  {importProgress && importProgress.phase === "importing" && (
                    <>
                      {" "}
                      New {importProgress.inserted.toLocaleString()} · updated {importProgress.updated.toLocaleString()} ·
                      skipped {importProgress.skipped.toLocaleString()}
                    </>
                  )}
                </p>
              </div>
            )}
          </div>

          {result && (
            <div className="border rounded-md p-4 space-y-2 bg-muted/30">
              <h3 className="font-semibold text-sm">Import Summary</h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
                <div>
                  <span className="text-muted-foreground">Total rows:</span> <strong>{result.total}</strong>
                </div>
                <div className="text-green-700">
                  <span className="text-muted-foreground">Inserted:</span> <strong>{result.inserted}</strong>
                </div>
                <div className="text-blue-700">
                  <span className="text-muted-foreground">Updated:</span> <strong>{result.updated}</strong>
                </div>
                <div className="text-amber-700">
                  <span className="text-muted-foreground">Skipped:</span> <strong>{result.skipped.length}</strong>
                </div>
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

      <Card>
        <CardHeader className="pb-3">
          {umrStatus && (
            <div className="mb-3 rounded-md border bg-muted/40 px-3 py-2 text-sm space-y-1">
              <p>
                <span className="text-muted-foreground">Imported from old LIMS:</span>{" "}
                <strong>{umrStatus.legacyCount.toLocaleString()}</strong>
                <span className="text-muted-foreground"> · Created by this LIMS:</span>{" "}
                <strong>{umrStatus.limsCount.toLocaleString()}</strong>
              </p>
              <p>
                <span className="text-muted-foreground">UMR counter:</span>{" "}
                <strong className="font-mono">{umrStatus.lastSequence}</strong>
                <span className="text-muted-foreground"> · Next new patient gets</span>{" "}
                <strong className="font-mono">{umrStatus.nextUmr}</strong>
              </p>
              <p className="text-xs text-muted-foreground">
                This list shows only Excel imports (`source = legacy`). New registrations assign UMR from the
                counter above — they do not appear here.
              </p>
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base">
              Imported data
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                {isLoading ? "Loading…" : `${total.toLocaleString()} patient${total === 1 ? "" : "s"}`}
              </span>
            </CardTitle>
            <Button
              variant="destructive"
              size="sm"
              disabled={total === 0 || deleting}
              onClick={() => setDeleteTarget("all")}
            >
              <Trash2 className="h-4 w-4 mr-1" /> Delete all imported
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="relative max-w-sm">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-8 h-9"
              placeholder="Search UMR, name, mobile…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-10 text-sm text-muted-foreground gap-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading imported patients…
            </div>
          ) : isError ? (
            <p className="text-sm text-destructive py-6 text-center">
              Could not load imported patients: {(error as Error)?.message || "unknown error"}
            </p>
          ) : total === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              {debouncedSearch
                ? "No imported patients match this search."
                : "No legacy patients imported yet."}
            </p>
          ) : (
            <>
              <div className="border rounded-md overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>UMR</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Gender</TableHead>
                      <TableHead>Mobile</TableHead>
                      <TableHead>Address</TableHead>
                      <TableHead>Imported</TableHead>
                      <TableHead className="w-[70px]" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell className="font-mono text-xs whitespace-nowrap">{row.umr_id}</TableCell>
                        <TableCell className="text-sm">
                          {[row.title, row.patient_name].filter(Boolean).join(" ")}
                        </TableCell>
                        <TableCell className="text-sm">{row.gender || "—"}</TableCell>
                        <TableCell className="text-sm font-mono">{row.mobile_number || "—"}</TableCell>
                        <TableCell className="text-sm max-w-[220px] truncate" title={row.address || ""}>
                          {row.address || "—"}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          {formatImportedAt(row.legacy_imported_at)}
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0 text-destructive"
                            disabled={deleting}
                            onClick={() => setDeleteTarget(row)}
                            aria-label={`Delete ${row.patient_name}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {totalPages > 1 && (
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7"
                    disabled={page === 0 || isFetching}
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                  >
                    Prev
                  </Button>
                  <span>
                    Page {page + 1} / {totalPages}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7"
                    disabled={page >= totalPages - 1 || isFetching}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Next
                  </Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open && !deleting) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {deleteTarget === "all" ? "Delete all imported patients?" : "Delete this patient?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget === "all"
                ? `This will remove ${total.toLocaleString()} patient${total === 1 ? "" : "s"} imported from the old LIMS (source = legacy). Registrations already created in this LIMS are not deleted.`
                : deleteTarget
                  ? `Remove ${[deleteTarget.title, deleteTarget.patient_name].filter(Boolean).join(" ") || deleteTarget.umr_id} (${deleteTarget.umr_id}) from patient master. Existing LIMS registrations are not deleted.`
                  : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleting}
              onClick={(e) => {
                e.preventDefault();
                void confirmDelete();
              }}
            >
              {deleting ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

const LegacyPatientImport = () => (
  <PasswordGate title="Legacy Patient Import">
    <LegacyPatientImportInner />
  </PasswordGate>
);

export default LegacyPatientImport;
