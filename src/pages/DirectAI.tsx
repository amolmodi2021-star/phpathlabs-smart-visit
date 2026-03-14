import { useState, useRef, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Upload, Loader2, Printer, Download, Send, Zap, ShieldCheck, AlertTriangle } from "lucide-react";
import { toPng } from "html-to-image";
import jsPDF from "jspdf";
import * as pdfjsLib from "pdfjs-dist";
import { Switch } from "@/components/ui/switch";
import { shareOnWhatsApp } from "@/lib/whatsapp";

pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.worker.min.mjs";

interface TestResult {
  department?: string;
  profile_name?: string;
  test_name?: string;
  parameter_name: string;
  result_value: string;
  unit?: string;
  normal_range_low?: string;
  normal_range_high?: string;
  normal_range_text?: string;
  flag?: string;
  approved_by?: string;
  sample_type?: string;
  analyzer?: string;
  method?: string;
  interpretation?: string;
  source_page?: number;
  confidence_score?: number;
  extraction_basis?: string;
}

interface PatientData {
  name?: string;
  age?: string;
  gender?: string;
  umr_id?: string;
  reg_no?: string;
  reg_date?: string;
  sample_collection_date?: string;
  accession_date?: string;
  authentication_date?: string;
  print_date?: string;
  location?: string;
  ref_doctor?: string;
  collection_date?: string;
  report_date?: string;
}

interface LayoutSettings {
  top_margin_cm: number;
  bottom_margin_cm: number;
  letterhead_pdf_path: string | null;
}

const cleanDateTime = (dateStr: string | null | undefined): string => {
  if (!dateStr) return "-";
  return dateStr.replace(/(\d{1,2}):(\d{2})\s*AMPM/gi, (_, h, m) => {
    const hours = parseInt(h, 10);
    const period = hours >= 12 ? "PM" : "AM";
    const displayHours = hours % 12 || 12;
    return `${displayHours}:${m} ${period}`;
  });
};

const formatDateTimeTo12Hr = (dateStr: string | null | undefined): string => {
  if (!dateStr) return "-";
  const cleaned = cleanDateTime(dateStr);
  const timeRegex = /(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(?:hrs?)?/i;
  const match = cleaned.match(timeRegex);
  if (!match) return cleaned;
  let hours = parseInt(match[1], 10);
  const minutes = match[2];
  const period = hours >= 12 ? "PM" : "AM";
  hours = hours % 12 || 12;
  return cleaned.replace(timeRegex, `${hours}:${minutes} ${period}`);
};

const DirectAI = () => {
  const { toast } = useToast();
  const printRef = useRef<HTMLDivElement>(null);
  const [processing, setProcessing] = useState(false);
  const [statusText, setStatusText] = useState("");
  const [patient, setPatient] = useState<PatientData | null>(null);
  const [testResults, setTestResults] = useState<TestResult[]>([]);
  const [pathologistName, setPathologistName] = useState("");
  const [pathologistMap, setPathologistMap] = useState<Record<string, any>>({});
  const [stats, setStats] = useState<any>(null);

  // Send dialog
  const [sendDialogOpen, setSendDialogOpen] = useState(false);
  const [umrInput, setUmrInput] = useState("");
  const [mobileInput, setMobileInput] = useState("");

  // Layout
  const [showHeader, setShowHeader] = useState(true);
  const [layoutSettings, setLayoutSettings] = useState<LayoutSettings>({ top_margin_cm: 2.5, bottom_margin_cm: 1.5, letterhead_pdf_path: null });
  const [letterheadImageUrl, setLetterheadImageUrl] = useState<string | null>(null);
  const [isPdfExporting, setIsPdfExporting] = useState(false);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    loadSignatures();
    loadLayoutSettings();
  }, []);

  const loadSignatures = async () => {
    const { data } = await supabase.from("pathologist_signatures").select("*");
    const map: Record<string, any> = {};
    (data || []).forEach((sig: any) => { map[sig.pathologist_name.toLowerCase()] = sig; });
    setPathologistMap(map);
  };

  const loadLayoutSettings = async () => {
    const { data } = await supabase.from("report_layout_settings").select("*").limit(1).single();
    if (data) {
      setLayoutSettings({
        top_margin_cm: Number(data.top_margin_cm) || 2.5,
        bottom_margin_cm: Number(data.bottom_margin_cm) || 1.5,
        letterhead_pdf_path: data.letterhead_pdf_path || null,
      });
      if (data.letterhead_pdf_path) {
        const { data: urlData } = supabase.storage.from("letterheads").getPublicUrl(data.letterhead_pdf_path);
        try {
          const pdf = await pdfjsLib.getDocument(urlData.publicUrl).promise;
          const page = await pdf.getPage(1);
          const viewport = page.getViewport({ scale: 2 });
          const canvas = document.createElement("canvas");
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          const ctx = canvas.getContext("2d");
          if (ctx) {
            await page.render({ canvasContext: ctx, viewport }).promise;
            setLetterheadImageUrl(canvas.toDataURL("image/png"));
          }
        } catch { /* ignore */ }
      }
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || file.type !== "application/pdf") {
      toast({ title: "Only PDF files are supported", variant: "destructive" });
      return;
    }
    e.target.value = "";

    setProcessing(true);
    setStatusText("Reading PDF...");
    setPatient(null);
    setTestResults([]);
    setStats(null);

    try {
      // Convert file to base64
      const arrayBuffer = await file.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      let binary = "";
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      const pdfBase64 = btoa(binary);

      setStatusText("AI extracting report data (first pass)...");

      const { data, error } = await supabase.functions.invoke("direct-ai-extract", {
        body: { pdfBase64 },
      });

      if (error) throw new Error(error.message || "Extraction failed");
      if (data?.error) throw new Error(data.error);

      setPatient(data.patient || {});
      setTestResults(data.test_results || []);
      setPathologistName(data.pathologist_name || "");
      setStats({
        firstPassCount: data.first_pass_count,
        lowConfCount: data.low_confidence_count,
        finalCount: data.final_count,
      });

      toast({ title: `Report extracted: ${data.final_count} parameters`, description: data.low_confidence_count > 0 ? `${data.low_confidence_count} rows re-verified in second pass` : "All rows high confidence" });
    } catch (err: any) {
      toast({ title: "Extraction failed", description: err.message, variant: "destructive" });
    } finally {
      setProcessing(false);
      setStatusText("");
    }
  };

  // Group results by department → profile/test_name
  const groupedResults = (() => {
    const deptMap = new Map<string, Map<string, TestResult[]>>();
    testResults.forEach((r) => {
      const dept = r.department || "General";
      const group = r.profile_name || r.test_name || "_individual";
      if (!deptMap.has(dept)) deptMap.set(dept, new Map());
      const profMap = deptMap.get(dept)!;
      if (!profMap.has(group)) profMap.set(group, []);
      profMap.get(group)!.push(r);
    });
    return deptMap;
  })();

  // Get unique approvers per page for signature blocks
  const getPageApprovers = (results: TestResult[]) => {
    const approvers = new Map<string, string>();
    results.forEach((r) => {
      if (r.approved_by) approvers.set(r.approved_by.toLowerCase(), r.approved_by);
    });
    return [...approvers.values()];
  };

  const getSignatureForDoctor = (doctorName: string) => {
    const key = doctorName.toLowerCase();
    const sig = pathologistMap[key];
    if (!sig) return null;
    if (sig.signature_image_path) {
      const { data } = supabase.storage.from("signatures").getPublicUrl(sig.signature_image_path);
      return { url: data.publicUrl, qualification: sig.qualification, designation: sig.designation };
    }
    return { url: null, qualification: sig.qualification, designation: sig.designation };
  };

  const handlePrint = () => window.print();

  const generatePdfBlob = async (): Promise<{ blob: Blob; fileName: string } | null> => {
    if (!printRef.current || !patient) return null;
    const fonts = (document as any).fonts;
    if (fonts?.ready) await fonts.ready;
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

    const pages = printRef.current.querySelectorAll("[data-report-page]");
    if (pages.length === 0) return null;

    const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const A4_W = 210;
    const A4_H = 297;

    for (let i = 0; i < pages.length; i++) {
      const page = pages[i] as HTMLElement;
      const sandbox = page.cloneNode(true) as HTMLElement;
      sandbox.style.position = "fixed";
      sandbox.style.left = "-9999px";
      sandbox.style.top = "0";
      sandbox.style.width = `${A4_W}mm`;
      sandbox.style.minHeight = `${A4_H}mm`;
      sandbox.style.background = "white";
      document.body.appendChild(sandbox);

      try {
        await new Promise<void>((r) => requestAnimationFrame(() => r()));
        const dataUrl = await toPng(sandbox, { pixelRatio: 2, skipAutoScale: true, filter: (node) => !(node instanceof HTMLElement && node.classList?.contains("no-export")) });
        const img = new Image();
        img.src = dataUrl;
        await new Promise<void>((resolve) => { img.onload = () => resolve(); });
        if (i > 0) pdf.addPage();
        pdf.addImage(dataUrl, "JPEG", 0, 0, A4_W, A4_H, undefined, "FAST", 0);
      } finally {
        document.body.removeChild(sandbox);
      }
    }

    const patientName = patient.name || "Patient";
    const regDate = patient.reg_date || new Date().toLocaleDateString("en-IN");
    const safeName = patientName.replace(/[^a-zA-Z0-9]/g, "_");
    const safeDate = regDate.replace(/[^a-zA-Z0-9]/g, "_");
    const fileName = `${safeName}_${safeDate}.pdf`;

    return { blob: pdf.output("blob"), fileName };
  };

  const handleDownload = async () => {
    setDownloading(true);
    setIsPdfExporting(true);
    try {
      await new Promise((r) => setTimeout(r, 100));
      const result = await generatePdfBlob();
      if (result) {
        const url = URL.createObjectURL(result.blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = result.fileName;
        a.click();
        URL.revokeObjectURL(url);
      }
    } finally {
      setIsPdfExporting(false);
      setDownloading(false);
    }
  };

  const handleSend = () => {
    if (!mobileInput || mobileInput.length !== 10) {
      toast({ title: "Enter valid 10-digit mobile number", variant: "destructive" });
      return;
    }
    // Build a summary message
    const abnormals = testResults.filter((r) => r.flag === "H" || r.flag === "L");
    let msg = `*Lab Report - ${patient?.name || "Patient"}*\n`;
    if (umrInput) msg += `UMR: ${umrInput}\n`;
    msg += `Total Parameters: ${testResults.length}\n`;
    if (abnormals.length > 0) {
      msg += `⚠ Abnormal Results: ${abnormals.length}\n\n`;
      abnormals.forEach((r) => {
        msg += `• ${r.parameter_name}: *${r.result_value}* ${r.unit || ""} (${r.flag === "H" ? "HIGH" : "LOW"}) Ref: ${r.normal_range_text || `${r.normal_range_low || ""}-${r.normal_range_high || ""}`}\n`;
      });
    } else {
      msg += `✅ All results normal`;
    }
    shareOnWhatsApp(mobileInput, msg);
    setSendDialogOpen(false);
    toast({ title: "WhatsApp opened" });
  };

  // Build pages for rendering
  const topMarginMm = layoutSettings.top_margin_cm * 10;
  const bottomMarginMm = layoutSettings.bottom_margin_cm * 10;
  const PAGE_H = 297;
  const HEADER_H = 30;
  const SIGNATURE_H = 18; // signature block reserved at bottom
  const PAGE_NUM_H = 8;
  const SAFETY_BUFFER = 4;
  const usableH = PAGE_H - topMarginMm - bottomMarginMm - HEADER_H - SIGNATURE_H - PAGE_NUM_H - SAFETY_BUFFER;

  // Height estimation constants (mm)
  const ROW_H = 5.5;
  const ADVISORY_ROW_H = 12; // advisory-style multi-line range rows are taller
  const DEPT_H = 8;
  const PROFILE_H = 6;
  const TABLE_HEADER_H = 5;
  const META_ROW_H = 4;
  const INTERPRETATION_LINE_H = 3;
  const INTERPRETATION_BASE_H = 6;

  const estimateSectionH = (results: TestResult[], profName: string): number => {
    let h = TABLE_HEADER_H;
    // Profile header
    if (profName && profName !== "_individual") h += PROFILE_H;
    // Metadata row
    const firstR = results[0];
    if (firstR?.sample_type || firstR?.analyzer || firstR?.method) h += META_ROW_H;
    // Each result row
    results.forEach((r) => {
      const rangeText = r.normal_range_text || "";
      const isAdvisory = rangeText.includes("\\n") || rangeText.includes("\n") || rangeText.length > 50;
      h += isAdvisory ? ADVISORY_ROW_H : ROW_H;
    });
    // Interpretation block
    const interpResult = results.find(r => r.interpretation);
    if (interpResult?.interpretation) {
      const lines = interpResult.interpretation.split(/\\n|\n/).length;
      h += INTERPRETATION_BASE_H + lines * INTERPRETATION_LINE_H;
    }
    return h;
  };

  const buildPages = () => {
    const pages: { sections: { type: string; dept?: string; profile?: string; results: TestResult[] }[] }[] = [];
    let currentPage: typeof pages[0] = { sections: [] };
    let currentH = 0;
    let lastDeptOnPage: string | null = null;

    groupedResults.forEach((profMap, dept) => {
      profMap.forEach((results, profName) => {
        const needsDeptHeader = dept !== lastDeptOnPage;
        const deptHeaderH = needsDeptHeader ? DEPT_H : 0;
        const sectionH = estimateSectionH(results, profName);
        const totalNeeded = deptHeaderH + sectionH;

        // If this section won't fit, start a new page
        if (currentH + totalNeeded > usableH && currentH > 0) {
          pages.push(currentPage);
          currentPage = { sections: [] };
          currentH = 0;
          lastDeptOnPage = null;
        }

        // Re-check dept header after potential page break
        if (dept !== lastDeptOnPage) {
          currentH += DEPT_H;
          lastDeptOnPage = dept;
        }

        currentPage.sections.push({ type: "profile", dept, profile: profName, results });
        currentH += sectionH;
      });
    });

    if (currentPage.sections.length > 0) pages.push(currentPage);
    return pages;
  };

  const pages = patient ? buildPages() : [];
  const totalPages = pages.length;

  const allApprovers = getPageApprovers(testResults);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Zap className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold">Direct AI Report</h1>
        </div>
        {patient && (
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setSendDialogOpen(true)}>
              <Send className="h-4 w-4 mr-1" /> Send
            </Button>
            <Button variant="outline" size="sm" onClick={handleDownload} disabled={downloading}>
              {downloading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Download className="h-4 w-4 mr-1" />} Download PDF
            </Button>
            <Button variant="outline" size="sm" onClick={handlePrint}>
              <Printer className="h-4 w-4 mr-1" /> Print
            </Button>
          </div>
        )}
      </div>

      {/* Upload Zone */}
      {!patient && !processing && (
        <Card>
          <CardContent className="pt-6">
            <div
              className="border-2 border-dashed border-muted-foreground/30 rounded-lg p-10 text-center hover:border-primary/50 transition-colors cursor-pointer"
              onClick={() => document.getElementById("direct-ai-input")?.click()}
            >
              <Upload className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
              <p className="text-lg font-medium">Upload PDF for Direct AI Processing</p>
              <p className="text-sm text-muted-foreground mt-1">
                AI will extract, verify low-confidence rows with a second pass, and generate a ready report
              </p>
              <input
                id="direct-ai-input"
                type="file"
                accept=".pdf"
                className="hidden"
                onChange={handleFileUpload}
              />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Processing status */}
      {processing && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="pt-6 pb-6 text-center">
            <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto mb-3" />
            <p className="font-medium">{statusText}</p>
            <p className="text-xs text-muted-foreground mt-1">This may take 30-60 seconds for multi-page reports</p>
          </CardContent>
        </Card>
      )}

      {/* Stats bar */}
      {stats && patient && (
        <div className="flex items-center gap-4 text-sm">
          <Badge variant="outline" className="gap-1">
            <ShieldCheck className="h-3 w-3" /> {stats.finalCount} Parameters
          </Badge>
          {stats.lowConfCount > 0 && (
            <Badge variant="secondary" className="gap-1">
              <AlertTriangle className="h-3 w-3" /> {stats.lowConfCount} Re-verified
            </Badge>
          )}
          <div className="ml-auto flex items-center gap-2">
            <Switch id="header-toggle" checked={showHeader} onCheckedChange={setShowHeader} />
            <Label htmlFor="header-toggle" className="text-xs">With Letterhead</Label>
          </div>
          <Button variant="outline" size="sm" onClick={() => { setPatient(null); setTestResults([]); setStats(null); }}>
            New Report
          </Button>
        </div>
      )}

      {/* Report render */}
      {patient && (
        <div ref={printRef} className="print:m-0">
          {pages.map((page, pageIdx) => {
            const pageSections = page.sections;
            const pageApprovers = getPageApprovers(pageSections.flatMap((s) => s.results));
            const displayApprovers = pageApprovers.length > 0 ? pageApprovers : allApprovers;
            // Group sections by department for rendering
            const deptGroups = new Map<string, typeof pageSections>();
            pageSections.forEach((s) => {
              const d = s.dept || "General";
              if (!deptGroups.has(d)) deptGroups.set(d, []);
              deptGroups.get(d)!.push(s);
            });

            return (
              <div
                key={pageIdx}
                data-report-page
                className="relative bg-white text-black mx-auto mb-4 print:mb-0 print:break-after-page overflow-hidden"
                style={{
                  width: "210mm",
                  minHeight: "297mm",
                  maxHeight: isPdfExporting ? "297mm" : undefined,
                  paddingTop: `${topMarginMm}mm`,
                  paddingBottom: `${bottomMarginMm}mm`,
                  fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif",
                }}
              >
                {/* Letterhead background */}
                {showHeader && letterheadImageUrl && (
                  <img
                    src={letterheadImageUrl}
                    className="absolute top-0 left-0 w-full h-full pointer-events-none"
                    style={{ objectFit: "fill", objectPosition: "top center", zIndex: 0 }}
                    alt=""
                  />
                )}

                <div className="relative" style={{ zIndex: 1, paddingLeft: "12mm", paddingRight: "12mm" }}>
                  {/* Patient header on every page */}
                  <div className="border-b border-gray-300 pb-3 mb-3">
                    <div className="grid grid-cols-2 gap-x-8 gap-y-0.5 text-sm">
                      <div className="grid gap-y-0.5" style={{ gridTemplateColumns: "90px 1fr" }}>
                        <span className="font-semibold">Patient Name</span><span>: {patient.name || "-"}</span>
                        <span className="font-semibold">Age / Gender</span><span>: {patient.age || "-"} / {patient.gender || "-"}</span>
                        <span className="font-semibold">UMR No</span><span>: {patient.umr_id || "-"}</span>
                        <span className="font-semibold">Location</span><span>: {patient.location || "-"}</span>
                      </div>
                      <div className="grid gap-y-0.5" style={{ gridTemplateColumns: "150px 1fr" }}>
                        <span className="font-semibold">Ref. Doctor</span><span>: {patient.ref_doctor || "SELF"}</span>
                        <span className="font-semibold">Reg. Date</span><span>: {formatDateTimeTo12Hr(patient.reg_date)}</span>
                        <span className="font-semibold">Sample Coll. Date</span><span>: {cleanDateTime(patient.sample_collection_date || patient.collection_date)}</span>
                        <span className="font-semibold">Authentication Date</span><span>: {cleanDateTime(patient.authentication_date)}</span>
                      </div>
                    </div>
                  </div>

                  {/* Results tables */}
                  {[...deptGroups.entries()].map(([dept, sections]) => (
                    <div key={dept} className="mb-3">
                      {/* Department header */}
                      <div
                        className="text-center font-bold text-sm py-1 mb-2 border-b-2"
                        style={{ color: "#2E3192", borderColor: "#2E3192" }}
                      >
                        {dept}
                      </div>

                      {sections.map((section, sIdx) => {
                        // Collect section-level metadata from first result
                        const firstR = section.results[0];
                        const sampleType = firstR?.sample_type || "";
                        const analyzer = firstR?.analyzer || "";
                        const method = firstR?.method || "";
                        // Collect interpretation from last result or any result that has it
                        const interpretationResult = section.results.find(r => r.interpretation);
                        const interpretation = interpretationResult?.interpretation || "";

                        return (
                        <div key={sIdx} className="mb-3">
                          {/* Profile/Test name header */}
                          {section.profile && section.profile !== "_individual" && (
                            <div className="font-semibold text-xs mb-1 py-0.5 px-1" style={{ color: "#2E3192" }}>
                              {section.profile}
                            </div>
                          )}

                          {/* Metadata row: Sample Type, Analyzer, Method */}
                          {(sampleType || analyzer || method) && (
                            <div className="flex flex-wrap gap-x-6 gap-y-0.5 text-[9px] text-gray-500 mb-1 px-1 border-b border-gray-100 pb-1">
                              {sampleType && <span><strong>Sample Type:</strong> {sampleType}</span>}
                              {analyzer && <span><strong>Instrument:</strong> {analyzer}</span>}
                              {method && <span><strong>Method:</strong> {method}</span>}
                            </div>
                          )}

                          {/* Results table */}
                          <table className="w-full text-[10px] border-collapse" style={{ tableLayout: "fixed" }}>
                            <colgroup>
                              <col style={{ width: "36%" }} />
                              <col style={{ width: "6%" }} />
                              <col style={{ width: "18%" }} />
                              <col style={{ width: "12%" }} />
                              <col style={{ width: "28%" }} />
                            </colgroup>
                            <thead>
                              <tr className="border-b border-gray-300">
                                <th className="text-left py-1 font-semibold">Parameter</th>
                                <th className="text-center py-1 font-semibold">Flag</th>
                                <th className="text-left py-1 font-semibold">Result</th>
                                <th className="text-left py-1 font-semibold">Unit</th>
                                <th className="text-left py-1 font-semibold">Reference Range</th>
                              </tr>
                            </thead>
                            <tbody>
                              {section.results.map((r, rIdx) => {
                                const isAbnormal = r.flag === "H" || r.flag === "L";
                                // Format advisory-style normal range
                                const rangeText = r.normal_range_text || (r.normal_range_low || r.normal_range_high ? `${r.normal_range_low || ""} - ${r.normal_range_high || ""}` : "");
                                const isAdvisoryRange = rangeText.includes("\\n") || rangeText.includes("\n") || rangeText.length > 50;

                                return (
                                  <tr
                                    key={rIdx}
                                    className={`border-b border-gray-100 ${isAbnormal ? "bg-red-50" : ""}`}
                                    style={{ verticalAlign: isAdvisoryRange ? "top" : "middle" }}
                                  >
                                    <td className="py-1 font-medium break-words">{r.parameter_name}</td>
                                    <td className="py-1 text-center">
                                      {isAbnormal && (
                                        <span
                                          className="inline-block px-1.5 py-0.5 rounded text-[9px] font-bold text-white"
                                          style={{ backgroundColor: r.flag === "H" ? "#dc2626" : "#2563eb" }}
                                        >
                                          {r.flag}
                                        </span>
                                      )}
                                    </td>
                                    <td className={`py-1 ${isAbnormal ? "font-bold" : ""}`} style={isAbnormal ? { color: r.flag === "H" ? "#dc2626" : "#2563eb" } : {}}>
                                      {r.result_value}
                                    </td>
                                    <td className="py-1 text-gray-600">{r.unit || ""}</td>
                                    <td className="py-1 text-gray-500 break-words text-[9px]">
                                      {isAdvisoryRange ? (
                                        <div className="space-y-0.5">
                                          {rangeText.split(/\\n|\n/).map((line: string, i: number) => {
                                            const trimmed = line.trim();
                                            if (!trimmed) return null;
                                            // Check if this line contains the "normal/sufficient" category
                                            const isNormalLine = /\b(normal|sufficient|no risk|non[- ]?diabetic|optimal|desirable)\b/i.test(trimmed);
                                            return (
                                              <div
                                                key={i}
                                                className={`leading-tight ${isNormalLine ? "font-semibold text-green-700" : ""}`}
                                              >
                                                {trimmed}
                                              </div>
                                            );
                                          })}
                                        </div>
                                      ) : (
                                        rangeText
                                      )}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>

                          {/* Interpretation block */}
                          {interpretation && (
                            <div className="mt-1 mb-2 px-1 py-1.5 border-l-2 border-blue-300 bg-blue-50/50">
                              <div className="text-[9px] font-semibold text-gray-700 mb-0.5">Interpretation:</div>
                              <div className="text-[9px] text-gray-600 leading-relaxed">
                                {interpretation.split(/\\n|\n/).map((line: string, i: number) => {
                                  const trimmed = line.trim();
                                  if (!trimmed) return <div key={i} className="h-1" />;
                                  // Detect bullet/numbered points
                                  const isBullet = /^[•\-\*\d+\.\)]/.test(trimmed);
                                  // Detect table-like lines with separators
                                  const isTableRow = (trimmed.match(/[:\|]/g) || []).length >= 2;
                                  if (isTableRow) {
                                    const cells = trimmed.split(/[:\|]/).map(c => c.trim());
                                    return (
                                      <div key={i} className="grid gap-x-2 text-[9px]" style={{ gridTemplateColumns: `repeat(${cells.length}, auto)` }}>
                                        {cells.map((cell, ci) => (
                                          <span key={ci} className={ci === 0 ? "font-medium" : ""}>{cell}</span>
                                        ))}
                                      </div>
                                    );
                                  }
                                  return (
                                    <div key={i} className={isBullet ? "pl-2" : ""}>
                                      {isBullet ? `${trimmed}` : trimmed}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </div>
                        );
                      })}
                    </div>
                  ))}

                  {/* Signature blocks */}
                  <div className="mt-4 pt-2 border-t flex justify-end gap-8 print:break-inside-avoid">
                    {displayApprovers.map((doc) => {
                      const sig = getSignatureForDoctor(doc);
                      return (
                        <div key={doc} className="text-center">
                          {sig?.url && <img src={sig.url} alt="Signature" className="h-8 mx-auto mb-0" />}
                          <p className="font-semibold text-[10px] leading-tight">{doc}</p>
                          {sig?.qualification && <p className="text-[9px] text-gray-500 leading-tight">{sig.qualification}</p>}
                          {sig?.designation && <p className="text-[9px] text-gray-500 leading-tight">{sig.designation}</p>}
                        </div>
                      );
                    })}
                  </div>

                  {/* Page number */}
                  <div
                    className="text-center text-[9px] text-gray-400"
                    style={{ position: "absolute", bottom: `${bottomMarginMm + 2}mm`, left: 0, right: 0 }}
                  >
                    Page {pageIdx + 1} of {totalPages}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Send Dialog */}
      <Dialog open={sendDialogOpen} onOpenChange={setSendDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Send Report to Patient</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>UMR Number</Label>
              <Input
                value={umrInput}
                onChange={(e) => setUmrInput(e.target.value.toUpperCase())}
                placeholder="UMR0000001"
                maxLength={10}
              />
            </div>
            <div>
              <Label>Mobile Number (10 digits)</Label>
              <Input
                value={mobileInput}
                onChange={(e) => setMobileInput(e.target.value.replace(/\D/g, "").slice(0, 10))}
                placeholder="9876543210"
                maxLength={10}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSendDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSend} disabled={mobileInput.length !== 10}>
              <Send className="h-4 w-4 mr-1" /> Send via WhatsApp
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default DirectAI;
