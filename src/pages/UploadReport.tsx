import { useState, useCallback, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Upload, FileText, Loader2, CheckCircle, AlertCircle, RefreshCw, Eye, Pencil } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

const statusColors: Record<string, string> = {
  Pending: "bg-yellow-100 text-yellow-800",
  Processing: "bg-blue-100 text-blue-800",
  "Awaiting Review": "bg-orange-100 text-orange-800",
  Completed: "bg-green-100 text-green-800",
  Dispatched: "bg-purple-100 text-purple-800",
};

interface UploadingFile {
  file: File;
  status: "uploading" | "queued" | "error";
  error?: string;
}

const UploadReport = () => {
  const [uploadingFiles, setUploadingFiles] = useState<UploadingFile[]>([]);
  const [recentReports, setRecentReports] = useState<any[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const triggerRef = useRef(false);

  const loadRecentReports = async () => {
    const { data } = await supabase
      .from("uploaded_reports")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);
    setRecentReports(data || []);

    const hasPending = (data || []).some(r => r.status === "Pending" || r.status === "Processing");
    setIsProcessing(hasPending);
    return hasPending;
  };

  useEffect(() => {
    loadRecentReports();

    // Poll every 8 seconds for status updates
    pollingRef.current = setInterval(() => {
      loadRecentReports();
    }, 8000);

    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, []);

  const triggerQueueProcessor = async () => {
    if (triggerRef.current) return;
    triggerRef.current = true;

    try {
      let hasMore = true;
      while (hasMore) {
        // Check if any report is currently Processing — wait for it to finish
        const { data: processingCheck } = await supabase
          .from("uploaded_reports")
          .select("id")
          .eq("status", "Processing")
          .limit(1);

        if (processingCheck && processingCheck.length > 0) {
          // Something is already being processed, wait and check again
          await loadRecentReports();
          await new Promise(r => setTimeout(r, 5000));
          continue;
        }

        const { data, error } = await supabase.functions.invoke("process-report-queue");
        if (error) {
          console.error("Queue processor error:", error);
          break;
        }
        hasMore = data?.processed && (data?.remainingPending || 0) > 0;
        await loadRecentReports();

        // Wait before processing next report
        if (hasMore) await new Promise(r => setTimeout(r, 3000));
      }
    } catch (e) {
      console.error("Failed to trigger queue:", e);
    } finally {
      triggerRef.current = false;
      await loadRecentReports();
    }
  };

  const handleFiles = async (files: FileList | File[]) => {
    const pdfFiles = Array.from(files).filter(f => f.type === "application/pdf");
    if (pdfFiles.length === 0) {
      toast({ title: "Only PDF files are supported", variant: "destructive" });
      return;
    }

    const newUploading: UploadingFile[] = pdfFiles.map(f => ({ file: f, status: "uploading" as const }));
    setUploadingFiles(prev => [...prev, ...newUploading]);

    // Upload all files in parallel
    const uploadPromises = pdfFiles.map(async (file, idx) => {
      try {
        const filePath = `reports/${Date.now()}_${idx}_${file.name}`;
        const { error: uploadError } = await supabase.storage
          .from("report-uploads")
          .upload(filePath, file);
        if (uploadError) throw uploadError;

        const { error: dbError } = await supabase
          .from("uploaded_reports")
          .insert({
            file_path: filePath,
            file_name: file.name,
            status: "Pending",
          });
        if (dbError) throw dbError;

        setUploadingFiles(prev =>
          prev.map(uf =>
            uf.file === file ? { ...uf, status: "queued" as const } : uf
          )
        );
      } catch (err: any) {
        setUploadingFiles(prev =>
          prev.map(uf =>
            uf.file === file ? { ...uf, status: "error" as const, error: err.message } : uf
          )
        );
      }
    });

    await Promise.all(uploadPromises);

    // Clear successful uploads after a moment
    setTimeout(() => {
      setUploadingFiles(prev => prev.filter(uf => uf.status === "error"));
    }, 2000);

    toast({ title: `${pdfFiles.length} PDF(s) queued for processing` });
    await loadRecentReports();

    // Trigger background processing
    triggerQueueProcessor();
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    handleFiles(e.dataTransfer.files);
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFiles(e.target.files);
      e.target.value = "";
    }
  };

  const pendingCount = recentReports.filter(r => r.status === "Pending").length;
  const processingCount = recentReports.filter(r => r.status === "Processing").length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Upload Pathology Reports</h1>
        <Button variant="outline" onClick={loadRecentReports}>
          <RefreshCw className="h-4 w-4 mr-2" />Refresh
        </Button>
      </div>

      {/* Upload Zone */}
      <Card>
        <CardContent className="pt-6">
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
            className="border-2 border-dashed border-muted-foreground/30 rounded-lg p-10 text-center hover:border-primary/50 transition-colors cursor-pointer"
            onClick={() => document.getElementById("pdf-input")?.click()}
          >
            <Upload className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
            <p className="text-lg font-medium">Drag & Drop PDFs or Click to Browse</p>
            <p className="text-sm text-muted-foreground mt-1">
              Upload multiple PDFs at once — they will be processed one by one in the background
            </p>
            <input
              id="pdf-input"
              type="file"
              accept=".pdf"
              multiple
              className="hidden"
              onChange={handleFileChange}
            />
          </div>

          {/* Currently uploading files */}
          {uploadingFiles.length > 0 && (
            <div className="mt-4 space-y-2">
              {uploadingFiles.map((uf, i) => (
                <div key={i} className="flex items-center gap-3 p-2 bg-muted rounded-lg text-sm">
                  <FileText className="h-4 w-4 text-primary shrink-0" />
                  <span className="truncate flex-1">{uf.file.name}</span>
                  {uf.status === "uploading" && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
                  {uf.status === "queued" && <CheckCircle className="h-4 w-4 text-green-500" />}
                  {uf.status === "error" && (
                    <span className="text-destructive text-xs">{uf.error}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Processing Status */}
      {(pendingCount > 0 || processingCount > 0) && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-3">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
              <div>
                <p className="font-medium text-sm">
                  Queue Active: {processingCount > 0 ? "1 processing" : ""}{" "}
                  {pendingCount > 0 ? `${pendingCount} pending` : ""}
                </p>
                <p className="text-xs text-muted-foreground">
                  Reports are processed in the background — you can close this page safely
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Recent Reports Queue */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Report Queue</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>File</TableHead>
                <TableHead>Reg.No</TableHead>
                <TableHead>Patient</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Uploaded</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recentReports.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium text-sm max-w-[200px] truncate">
                    {r.file_name || "-"}
                  </TableCell>
                  <TableCell className="text-sm">{(r as any).reg_no || "-"}</TableCell>
                  <TableCell className="text-sm">{r.patient_name || "-"}</TableCell>
                  <TableCell>
                    <Badge className={statusColors[r.status] || ""}>
                      {r.status === "Processing" && (
                        <Loader2 className="h-3 w-3 animate-spin mr-1" />
                      )}
                      {r.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {format(new Date(r.created_at), "dd MMM HH:mm")}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      {r.status === "Awaiting Review" && (
                        <Button size="sm" variant="outline" onClick={() => navigate(`/reports/review/${r.id}`)}>
                          <Pencil className="h-3 w-3 mr-1" />Review
                        </Button>
                      )}
                      {(r.status === "Completed" || r.status === "Dispatched") && (
                        <>
                          <Button size="sm" variant="outline" onClick={() => navigate(`/reports/view/${r.id}`)}>
                            <Eye className="h-3 w-3 mr-1" />View
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => navigate(`/reports/review/${r.id}`)}>
                            <Pencil className="h-3 w-3 mr-1" />Edit
                          </Button>
                        </>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {recentReports.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                    No reports uploaded yet
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
};

export default UploadReport;
