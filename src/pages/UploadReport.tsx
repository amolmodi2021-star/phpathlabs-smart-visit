import { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Upload, FileText, Loader2, CheckCircle, AlertCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import * as pdfjsLib from "pdfjs-dist";
import { normalizeTestResultFlags } from "@/lib/reportFlags";

pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.worker.min.mjs`;

const UploadReport = () => {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<"idle" | "uploading" | "extracting" | "done" | "error">("idle");
  const [progress, setProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState("");
  const navigate = useNavigate();
  const { toast } = useToast();

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f?.type === "application/pdf") setFile(f);
    else toast({ title: "Only PDF files are supported", variant: "destructive" });
  }, [toast]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) setFile(f);
  };

  const convertPdfToImages = async (file: File): Promise<string[]> => {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const images: string[] = [];
    const totalPages = pdf.numPages;
    const MAX_WIDTH = 1000;
    const MAX_HEIGHT = 1400;

    for (let i = 1; i <= totalPages; i++) {
      const page = await pdf.getPage(i);
      const baseViewport = page.getViewport({ scale: 1.0 });
      const scale = Math.min(1.0, MAX_WIDTH / baseViewport.width, MAX_HEIGHT / baseViewport.height);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext("2d")!;
      await page.render({ canvasContext: ctx, viewport }).promise;
      images.push(canvas.toDataURL("image/jpeg", 0.45));
      setProgress(Math.round((i / totalPages) * 40));
    }
    return images;
  };

  const handleUpload = async () => {
    if (!file) return;
    setStatus("uploading");
    setProgress(0);
    setErrorMsg("");

    try {
      // Upload file to storage
      const filePath = `reports/${Date.now()}_${file.name}`;
      const { error: uploadError } = await supabase.storage.from("report-uploads").upload(filePath, file);
      if (uploadError) throw uploadError;
      setProgress(10);

      // Create DB entry
      const { data: reportRow, error: dbError } = await supabase
        .from("uploaded_reports")
        .insert({ file_path: filePath, file_name: file.name, status: "Processing" })
        .select()
        .single();
      if (dbError) throw dbError;
      setProgress(15);

      // Convert PDF to images
      setStatus("extracting");
      const pageImages = await convertPdfToImages(file);
      setProgress(50);

      // Fetch test parameters for matching
      const { data: params } = await supabase.from("report_test_parameters").select("id, parameter_name, unit, normal_range_low, normal_range_high, report_departments(department_name), report_profiles(profile_name)");
      const testParameters = (params || []).map((p: any) => ({
        id: p.id,
        parameter_name: p.parameter_name,
        unit: p.unit,
        normal_range_low: p.normal_range_low,
        normal_range_high: p.normal_range_high,
        department: p.report_departments?.department_name || "",
        profile: p.report_profiles?.profile_name || "",
      }));
      setProgress(55);

      // Call AI extraction in payload-safe batches with retry
      const MAX_BATCH_CHARS = 1_800_000;
      const MAX_PAGES_PER_BATCH = 2;
      const batches: string[][] = [];
      let currentBatch: string[] = [];
      let currentBatchChars = 0;

      for (const img of pageImages) {
        const imgChars = img.length;
        const shouldFlush =
          currentBatch.length > 0 &&
          (currentBatchChars + imgChars > MAX_BATCH_CHARS ||
            currentBatch.length >= MAX_PAGES_PER_BATCH);

        if (shouldFlush) {
          batches.push(currentBatch);
          currentBatch = [];
          currentBatchChars = 0;
        }

        currentBatch.push(img);
        currentBatchChars += imgChars;
      }

      if (currentBatch.length > 0) batches.push(currentBatch);
      if (batches.length === 0) throw new Error("No readable pages found in PDF");

      const invokeExtractBatch = async (batchImages: string[]) => {
        let lastError: any;
        for (let attempt = 0; attempt < 3; attempt++) {
          const { data, error } = await supabase.functions.invoke("extract-report", {
            body: { pageImages: batchImages, testParameters },
          });

          if (!error) return data;
          lastError = error;
          await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
        }
        throw lastError;
      };

      let allTestResults: any[] = [];
      let patientData: any = {};
      let pathologistName = "";
      let allPathologistNames: string[] = [];

      for (let i = 0; i < batches.length; i++) {
        const data = await invokeExtractBatch(batches[i]);
        if (data.patient?.name) patientData = { ...patientData, ...data.patient };
        if (data.pathologist_name) pathologistName = data.pathologist_name;
        if (data.pathologist_names) {
          allPathologistNames = [...allPathologistNames, ...data.pathologist_names];
        }
        if (data.test_results) allTestResults = [...allTestResults, ...data.test_results];
        setProgress(55 + Math.round(((i + 1) / batches.length) * 30));
      }

      // Deduplicate pathologist names
      const uniquePathologists = [...new Set(allPathologistNames.filter(Boolean))];

      // If no per-test approved_by was set but we have a single pathologist, assign it
      if (uniquePathologists.length <= 1 && pathologistName) {
        allTestResults = allTestResults.map(r => ({
          ...r,
          approved_by: r.approved_by || pathologistName,
        }));
      }

      // Apply fallback logic for collection_date and report_date
      if (!patientData.collection_date && patientData.sample_collection_date) {
        patientData.collection_date = patientData.sample_collection_date;
      }
      if (!patientData.report_date && patientData.authentication_date) {
        patientData.report_date = patientData.authentication_date;
      }

      const mergedData = {
        patient: patientData,
        test_results: normalizeTestResultFlags(allTestResults),
        pathologist_name: uniquePathologists.join(", ") || pathologistName,
      };
      setProgress(85);

      // Save extracted data
      const { error: saveError } = await supabase.from("extracted_report_data").insert({
        report_id: reportRow.id,
        patient_name: mergedData.patient?.name || "",
        age: mergedData.patient?.age || "",
        gender: mergedData.patient?.gender || "",
        umr_id: mergedData.patient?.umr_id || "",
        ref_doctor: mergedData.patient?.ref_doctor || "",
        collection_date: mergedData.patient?.collection_date || "",
        report_date: mergedData.patient?.report_date || "",
        reg_no: mergedData.patient?.reg_no || "",
        reg_date: mergedData.patient?.reg_date || "",
        sample_collection_date: mergedData.patient?.sample_collection_date || "",
        accession_date: mergedData.patient?.accession_date || "",
        authentication_date: mergedData.patient?.authentication_date || "",
        print_date: mergedData.patient?.print_date || "",
        location: mergedData.patient?.location || "",
        test_results: mergedData.test_results || [],
        pathologist_name: mergedData.pathologist_name || "",
      } as any);
      if (saveError) throw saveError;

      // Save raw JSON
      await supabase.from("raw_report_data").insert({
        report_id: reportRow.id,
        umr_id: mergedData.patient?.umr_id || "",
        raw_json: mergedData,
      });

      // Update report status
      await supabase.from("uploaded_reports").update({
        status: "Awaiting Review",
        umr_id: mergedData.patient?.umr_id || "",
        patient_name: mergedData.patient?.name || "",
        reg_no: mergedData.patient?.reg_no || "",
        reg_date: mergedData.patient?.reg_date || "",
      } as any).eq("id", reportRow.id);

      setProgress(100);
      setStatus("done");
      toast({ title: "Report extracted successfully!" });

      setTimeout(() => navigate(`/reports/review/${reportRow.id}`), 1500);
    } catch (err: any) {
      console.error("Upload error:", err);
      setErrorMsg(err.message || "Failed to process report");
      setStatus("error");
      toast({ title: "Error processing report", description: err.message, variant: "destructive" });
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">Upload Pathology Report</h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Upload PDF Report</CardTitle>
        </CardHeader>
        <CardContent>
          {status === "idle" && (
            <>
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleDrop}
                className="border-2 border-dashed border-muted-foreground/30 rounded-lg p-12 text-center hover:border-primary/50 transition-colors cursor-pointer"
                onClick={() => document.getElementById("pdf-input")?.click()}
              >
                <Upload className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <p className="text-lg font-medium">Drag & Drop PDF or Click to Browse</p>
                <p className="text-sm text-muted-foreground mt-1">Supports LIMS PDFs, scanned PDFs, and table-based PDFs</p>
                <input id="pdf-input" type="file" accept=".pdf" className="hidden" onChange={handleFileChange} />
              </div>

              {file && (
                <div className="mt-4 flex items-center justify-between p-3 bg-muted rounded-lg">
                  <div className="flex items-center gap-2">
                    <FileText className="h-5 w-5 text-primary" />
                    <span className="text-sm font-medium">{file.name}</span>
                    <span className="text-xs text-muted-foreground">({(file.size / 1024 / 1024).toFixed(2)} MB)</span>
                  </div>
                  <Button onClick={handleUpload}>Process Report</Button>
                </div>
              )}
            </>
          )}

          {(status === "uploading" || status === "extracting") && (
            <div className="space-y-4 py-8">
              <div className="flex items-center gap-3 justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
                <span className="font-medium">
                  {status === "uploading" ? "Uploading report..." : "AI is extracting data..."}
                </span>
              </div>
              <Progress value={progress} className="h-3" />
              <p className="text-center text-sm text-muted-foreground">{progress}% complete</p>
            </div>
          )}

          {status === "done" && (
            <div className="flex flex-col items-center gap-3 py-8">
              <CheckCircle className="h-12 w-12 text-green-500" />
              <p className="font-medium text-lg">Extraction Complete!</p>
              <p className="text-sm text-muted-foreground">Redirecting to review screen...</p>
            </div>
          )}

          {status === "error" && (
            <div className="flex flex-col items-center gap-3 py-8">
              <AlertCircle className="h-12 w-12 text-destructive" />
              <p className="font-medium text-lg">Processing Failed</p>
              <p className="text-sm text-muted-foreground">{errorMsg}</p>
              <Button variant="outline" onClick={() => { setStatus("idle"); setFile(null); }}>Try Again</Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default UploadReport;
