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

const MAX_BATCH_CHARS = 1_800_000;
const MAX_PAGES_PER_BATCH = 2;
const LOW_CONFIDENCE_THRESHOLD = 88;

interface PdfPagePayload {
  pageNumber: number;
  image: string;
  textLayer: string;
}

const normalizeKeyText = (value: unknown) =>
  String(value ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

const getResultKey = (row: any, index = 0) => {
  const parameter = normalizeKeyText(row?.parameter_name);
  const testName = normalizeKeyText(row?.test_name || row?.parameter_name);
  const sourcePage = Number(row?.source_page) || 0;
  return `${parameter || `row-${index}`}|${testName}|${sourcePage}`;
};

const dedupeByConfidence = (rows: any[]) => {
  const deduped = new Map<string, any>();

  rows.forEach((row, index) => {
    const key = getResultKey(row, index);
    const nextScore = Number(row?.confidence_score ?? 0);
    const current = deduped.get(key);
    const currentScore = Number(current?.confidence_score ?? -1);

    if (!current || nextScore >= currentScore) {
      deduped.set(key, row);
    }
  });

  return Array.from(deduped.values());
};

const hasMeaningfulRange = (row: any) => {
  const rangeText = String(row?.normal_range_text ?? "").trim();
  const low = String(row?.normal_range_low ?? "").trim();
  const high = String(row?.normal_range_high ?? "").trim();
  return Boolean(rangeText || low || high);
};

const isLowConfidenceResult = (row: any) => {
  const score = Number(row?.confidence_score ?? 0);
  const resultText = String(row?.result_value ?? "").trim();
  const normalizedResult = resultText.replace(/[<>=,%\s]/g, "");
  const isNumeric = normalizedResult.length > 0 && !Number.isNaN(Number(normalizedResult));
  const isAllowedText = /^(positive|negative|reactive|non reactive|non-reactive|detected|not detected|present|absent|trace|nil)$/i.test(resultText);

  return (
    score < LOW_CONFIDENCE_THRESHOLD ||
    !String(row?.parameter_name ?? "").trim() ||
    !resultText ||
    (!isNumeric && !isAllowedText) ||
    !hasMeaningfulRange(row)
  );
};

const buildPageBatches = (pages: PdfPagePayload[]) => {
  const batches: PdfPagePayload[][] = [];
  let currentBatch: PdfPagePayload[] = [];
  let currentBatchChars = 0;

  for (const page of pages) {
    const payloadSize = page.image.length + page.textLayer.length;
    const shouldFlush =
      currentBatch.length > 0 &&
      (currentBatchChars + payloadSize > MAX_BATCH_CHARS || currentBatch.length >= MAX_PAGES_PER_BATCH);

    if (shouldFlush) {
      batches.push(currentBatch);
      currentBatch = [];
      currentBatchChars = 0;
    }

    currentBatch.push(page);
    currentBatchChars += payloadSize;
  }

  if (currentBatch.length > 0) batches.push(currentBatch);
  return batches;
};

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

  const extractPageTextLayer = async (page: any): Promise<string> => {
    const textContent = await page.getTextContent();
    const items = (textContent?.items || [])
      .map((item: any) => ({
        text: typeof item?.str === "string" ? item.str.trim() : "",
        x: Number(item?.transform?.[4] ?? 0),
        y: Number(item?.transform?.[5] ?? 0),
      }))
      .filter((item: any) => item.text);

    if (!items.length) return "";

    const rows = new Map<number, { x: number; text: string }[]>();

    items.forEach((item: any) => {
      const yBucket = Math.round(item.y / 2) * 2;
      const existing = rows.get(yBucket) || [];
      existing.push({ x: item.x, text: item.text });
      rows.set(yBucket, existing);
    });

    const mergedRows = Array.from(rows.entries())
      .sort((a, b) => b[0] - a[0])
      .map(([, rowItems]) => rowItems.sort((a, b) => a.x - b.x).map((r) => r.text).join(" | "));

    return mergedRows.join("\n").slice(0, 22000);
  };

  const convertPdfToPages = async (selectedFile: File): Promise<PdfPagePayload[]> => {
    const arrayBuffer = await selectedFile.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const pages: PdfPagePayload[] = [];
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

      const textLayer = await extractPageTextLayer(page);

      pages.push({
        pageNumber: i,
        image: canvas.toDataURL("image/jpeg", 0.45),
        textLayer,
      });

      setProgress(Math.round((i / totalPages) * 35));
    }

    return pages;
  };

  const mergeVerifiedIntoResults = (rows: any[], verifiedRows: any[], forceApply = false) => {
    const verifiedMap = new Map<string, any>();

    verifiedRows.forEach((row: any) => {
      verifiedMap.set(getResultKey(row), row);
    });

    return rows.map((row: any) => {
      const verified = verifiedMap.get(getResultKey(row));
      if (!verified) return row;

      const currentScore = Number(row?.confidence_score ?? 0);
      const verifiedScore = Number(verified?.confidence_score ?? 0);
      const shouldApply = forceApply || !String(row?.result_value ?? "").trim() || verifiedScore >= currentScore;

      if (!shouldApply) return row;

      return {
        ...row,
        parameter_name: verified.parameter_name ?? row.parameter_name,
        result_value: verified.result_value ?? row.result_value,
        unit: verified.unit ?? row.unit,
        normal_range_text: verified.normal_range_text ?? row.normal_range_text,
        normal_range_low: verified.normal_range_low ?? row.normal_range_low,
        normal_range_high: verified.normal_range_high ?? row.normal_range_high,
        source_page: verified.source_page ?? row.source_page,
        confidence_score: verified.confidence_score ?? row.confidence_score,
      };
    });
  };

  const runReverificationPass = async (
    pages: PdfPagePayload[],
    candidateRows: any[],
    strictMode: boolean,
    progressStart: number,
    progressEnd: number
  ) => {
    if (!candidateRows.length) return [];

    const batches = buildPageBatches(pages);
    const sentKeys = new Set<string>();
    let allVerified: any[] = [];

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      const pageNumbers = batch.map((p) => p.pageNumber);

      const scopedRows = candidateRows.filter((row: any) => {
        const key = getResultKey(row);
        if (sentKeys.has(key)) return false;

        const sourcePage = Number(row?.source_page);
        if (Number.isFinite(sourcePage) && sourcePage > 0) {
          return pageNumbers.includes(sourcePage);
        }

        return i === 0;
      });

      if (!scopedRows.length) continue;

      scopedRows.forEach((row) => sentKeys.add(getResultKey(row)));

      const { data, error } = await supabase.functions.invoke("reverify-abnormals", {
        body: {
          pageImages: batch.map((p) => p.image),
          pageTexts: batch.map((p) => p.textLayer),
          pageNumbers,
          testResults: scopedRows,
          strictMode,
        },
      });

      // Accept partial results even on 402 (credits exhausted)
      if (data?.verified_results) {
        allVerified = [...allVerified, ...data.verified_results];
      }
      if (data?.error?.includes("credits exhausted")) {
        toast.warning("AI credits exhausted. Partial re-verification applied.");
        break;
      }

      const progressRange = progressEnd - progressStart;
      setProgress(progressStart + Math.round(((i + 1) / batches.length) * progressRange));
    }

    return dedupeByConfidence(allVerified);
  };

  const handleUpload = async () => {
    if (!file) return;
    setStatus("uploading");
    setProgress(0);
    setErrorMsg("");

    try {
      const filePath = `reports/${Date.now()}_${file.name}`;
      const { error: uploadError } = await supabase.storage.from("report-uploads").upload(filePath, file);
      if (uploadError) throw uploadError;
      setProgress(10);

      const { data: reportRow, error: dbError } = await supabase
        .from("uploaded_reports")
        .insert({ file_path: filePath, file_name: file.name, status: "Processing" })
        .select()
        .single();
      if (dbError) throw dbError;
      setProgress(15);

      setStatus("extracting");
      const pages = await convertPdfToPages(file);
      const pageImages = pages.map((p) => p.image);
      if (!pageImages.length) throw new Error("No readable pages found in PDF");
      setProgress(45);

      const { data: params } = await supabase
        .from("report_test_parameters")
        .select("id, parameter_name, unit, normal_range_low, normal_range_high, report_departments(department_name), report_profiles(profile_name)");

      const testParameters = (params || []).map((p: any) => ({
        id: p.id,
        parameter_name: p.parameter_name,
        unit: p.unit,
        normal_range_low: p.normal_range_low,
        normal_range_high: p.normal_range_high,
        department: p.report_departments?.department_name || "",
        profile: p.report_profiles?.profile_name || "",
      }));
      setProgress(50);

      const extractionBatches = buildPageBatches(pages);

      const invokeExtractBatch = async (batchPages: PdfPagePayload[]) => {
        let lastError: any;

        for (let attempt = 0; attempt < 3; attempt++) {
          const { data, error } = await supabase.functions.invoke("extract-report", {
            body: {
              pageImages: batchPages.map((p) => p.image),
              pageTexts: batchPages.map((p) => p.textLayer),
              pageNumbers: batchPages.map((p) => p.pageNumber),
              testParameters,
            },
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

      for (let i = 0; i < extractionBatches.length; i++) {
        const data = await invokeExtractBatch(extractionBatches[i]);

        if (data?.patient?.name) patientData = { ...patientData, ...data.patient };
        if (data?.pathologist_name) pathologistName = data.pathologist_name;
        if (Array.isArray(data?.pathologist_names)) allPathologistNames = [...allPathologistNames, ...data.pathologist_names];
        if (Array.isArray(data?.test_results)) allTestResults = [...allTestResults, ...data.test_results];

        setProgress(50 + Math.round(((i + 1) / extractionBatches.length) * 30));
      }

      allTestResults = dedupeByConfidence(allTestResults);

      const uniquePathologists = [...new Set(allPathologistNames.filter(Boolean))];
      if (uniquePathologists.length <= 1 && pathologistName) {
        allTestResults = allTestResults.map((result: any) => ({
          ...result,
          approved_by: result.approved_by || pathologistName,
        }));
      }

      if (!patientData.collection_date && patientData.sample_collection_date) {
        patientData.collection_date = patientData.sample_collection_date;
      }
      if (!patientData.report_date && patientData.authentication_date) {
        patientData.report_date = patientData.authentication_date;
      }

      let finalTestResults = normalizeTestResultFlags(allTestResults);
      setProgress(84);

      try {
        const initialLowConfidence = finalTestResults.filter(isLowConfidenceResult);

        if (initialLowConfidence.length > 0) {
          const verifiedPass = await runReverificationPass(pages, initialLowConfidence, false, 85, 92);
          finalTestResults = mergeVerifiedIntoResults(finalTestResults, verifiedPass);
          finalTestResults = normalizeTestResultFlags(finalTestResults);

          const remainingLowConfidence = finalTestResults.filter(isLowConfidenceResult);
          if (remainingLowConfidence.length > 2) {
            const strictVerifiedPass = await runReverificationPass(pages, remainingLowConfidence, true, 92, 96);
            finalTestResults = mergeVerifiedIntoResults(finalTestResults, strictVerifiedPass, true);
            finalTestResults = normalizeTestResultFlags(finalTestResults);
          }
        }
      } catch (reverifyError) {
        console.warn("Auto re-verification failed, proceeding with best extracted data:", reverifyError);
      }

      const mergedData = {
        patient: patientData,
        test_results: finalTestResults,
        pathologist_name: uniquePathologists.join(", ") || pathologistName,
      };

      setProgress(97);

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

      await supabase.from("raw_report_data").insert({
        report_id: reportRow.id,
        umr_id: mergedData.patient?.umr_id || "",
        raw_json: mergedData,
      });

      await supabase
        .from("uploaded_reports")
        .update({
          status: "Awaiting Review",
          umr_id: mergedData.patient?.umr_id || "",
          patient_name: mergedData.patient?.name || "",
          reg_no: mergedData.patient?.reg_no || "",
          reg_date: mergedData.patient?.reg_date || "",
        } as any)
        .eq("id", reportRow.id);

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
                  {status === "uploading" ? "Uploading report..." : "AI is extracting and validating data..."}
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
