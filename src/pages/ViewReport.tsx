import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Loader2, Printer, ArrowLeft, Download, Pencil } from "lucide-react";
import { toPng } from "html-to-image";
import jsPDF from "jspdf";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import * as pdfjsLib from "pdfjs-dist";
import ReportTrendCharts from "@/components/report/ReportTrendCharts";
import ReportHeader from "@/components/report/ReportHeader";
import ReportAbnormalSummary from "@/components/report/ReportAbnormalSummary";
import ReportResultsSection from "@/components/report/ReportResultsSection";
import ReportSignatureBlock from "@/components/report/ReportSignatureBlock";
import AutoScaleContent from "@/components/report/AutoScaleContent";
import { shareOnWhatsApp } from "@/lib/whatsapp";
import { useToast } from "@/hooks/use-toast";
import { normalizeTestResultFlags } from "@/lib/reportFlags";

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
  is_outsourced?: boolean;
  outsourced_caption?: string;
  interpretation?: string;
  remark?: string;
}

interface ProfileMeta {
  sample_type?: string;
  analyzer?: string;
  method?: string;
  is_outsourced?: boolean;
  outsourced_caption?: string;
  interpretation?: string;
  enable_test_grouping?: boolean;
  force_single_page?: boolean;
}

interface TrendData {
  parameter_name: string;
  data: { date: string; value: number; low?: number; high?: number }[];
  low?: number;
  high?: number;
  unit?: string;
}

interface LayoutSettings {
  top_margin_cm: number;
  bottom_margin_cm: number;
  letterhead_pdf_path: string | null;
}

// A "page section" is a unit we try not to split across pages
interface PageSection {
  type: "abnormal-summary" | "department-profile";
  dept?: string;
  profName?: string;
  results?: TestResult[];
  abnormals?: TestResult[];
  estimatedHeightMm: number;
  isAbnormalOnly?: boolean;
  isContinuation?: boolean;
}

const HEADER_HEIGHT_MM = 32;
const SIGNATURE_HEIGHT_MM = 14;
const PAGE_NUM_HEIGHT_MM = 8;
const DEPT_HEADER_HEIGHT_MM = 8;
const PROFILE_HEADER_HEIGHT_MM = 6;
const TABLE_HEADER_HEIGHT_MM = 5;
const ROW_HEIGHT_MM = 5;
const ROW_HEIGHT_COMPACT_MM = 3.8;
const PROFILE_GAP_MM = 2;
const ABNORMAL_SUMMARY_BASE_MM = 17;
const ABNORMAL_ROW_MM = 6.2;
const ABNORMAL_EXTRA_LINE_MM = 5;
const ABNORMAL_PARAM_CHARS_PER_LINE = 32;
const ABNORMAL_RANGE_CHARS_PER_LINE = 20;
const ABNORMAL_CHUNK_SAFETY_MM = 2;
const TEST_NAME_HEADER_MM = 4;

const COMPACT_PROFILES = ["cbc", "complete blood count", "urine routine"];
const isCompactProfile = (name: string): boolean => {
  const lower = name.toLowerCase();
  return COMPACT_PROFILES.some(cp => lower.includes(cp));
};

const isDedicatedReportProfile = (section: PageSection): boolean => {
  if (section.type !== "department-profile") return false;

  const profileText = [
    section.profName,
    section.dept,
    ...(section.results?.map((r) => `${r.profile_name || ""} ${r.test_name || ""}`) || []),
  ]
    .join(" ")
    .toLowerCase();

  const isCbc = profileText.includes("cbc") || profileText.includes("complete blood count");
  const isUrine = profileText.includes("urine") && (
    profileText.includes("routine") ||
    profileText.includes("analysis") ||
    profileText.includes("microscopic") ||
    profileText.includes("microscopy") ||
    profileText.includes("urinalysis")
  );

  return isCbc || isUrine;
};

const isForceSinglePageProfile = (section: PageSection, metaMap: Record<string, ProfileMeta>): boolean => {
  if (section.type !== "department-profile" || !section.profName) return false;
  return metaMap[section.profName]?.force_single_page === true;
};

const normalizeDedupeKey = (value: unknown) =>
  String(value ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

const normalizeMatchKey = (value: unknown) =>
  String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .map((token) => (token.endsWith("s") && token.length > 3 ? token.slice(0, -1) : token))
    .join(" ");

const GENERIC_LAB_WORDS = new Set(["physical", "chemical", "microscopic", "examination", "routine", "analysi", "analysis", "test"]);

const getDistinguishingWords = (normalized: string): string[] =>
  normalized.split(" ").filter((w) => w.length > 2 && !GENERIC_LAB_WORDS.has(w));

const hasKeywordOverlap = (a: string, b: string): boolean => {
  if (!a || !b) return false;
  if (a === b || a.includes(b) || b.includes(a)) return true;
  const wordsA = a.split(" ").filter((w) => w.length > 3);
  const wordsB = new Set(b.split(" ").filter((w) => w.length > 3));
  return wordsA.some((w) => wordsB.has(w));
};

const hasDistinguishingOverlap = (a: string, b: string): boolean => {
  if (!a || !b) return false;
  const wordsA = getDistinguishingWords(a);
  const wordsB = new Set(getDistinguishingWords(b));
  return wordsA.some((w) => wordsB.has(w));
};

const dedupeResultsLatest = (rows: TestResult[]) => {
  // Key = parameter_name + test_name (AI-extracted). Latest occurrence wins.
  const deduped = new Map<string, TestResult>();
  rows.forEach((row) => {
    const key = `${normalizeDedupeKey(row.parameter_name)}::${normalizeDedupeKey(row.test_name)}`;
    deduped.set(key, row);
  });
  return Array.from(deduped.values());
};

const ViewReport = () => {
  const { reportId } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const printRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [isPdfExporting, setIsPdfExporting] = useState(false);
  const [mobileDialogOpen, setMobileDialogOpen] = useState(false);
  const [mobileNumber, setMobileNumber] = useState("");
  const [extracted, setExtracted] = useState<any>(null);
  const [pathologistMap, setPathologistMap] = useState<Record<string, any>>({});
  const [deptOrderMap, setDeptOrderMap] = useState<Record<string, number>>({});
  const [profileMetaMap, setProfileMetaMap] = useState<Record<string, ProfileMeta>>({});
  const [profileOrderMap, setProfileOrderMap] = useState<Record<string, number>>({});
  const [trends, setTrends] = useState<TrendData[]>([]);
  const [showHeader, setShowHeader] = useState(true);
  const [layoutSettings, setLayoutSettings] = useState<LayoutSettings>({
    top_margin_cm: 2.5,
    bottom_margin_cm: 1.5,
    letterhead_pdf_path: null,
  });
  const [letterheadImageUrl, setLetterheadImageUrl] = useState<string | null>(null);

  useEffect(() => { loadReport(); loadLayoutSettings(); }, [reportId]);

  const convertPdfToBackgroundImage = async (pdfUrl: string) => {
    try {
      const pdf = await pdfjsLib.getDocument(pdfUrl).promise;
      const page = await pdf.getPage(1);
      const viewport = page.getViewport({ scale: 2 });
      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      await page.render({ canvasContext: ctx, viewport }).promise;
      return canvas.toDataURL("image/png");
    } catch {
      return null;
    }
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
        const backgroundImage = await convertPdfToBackgroundImage(urlData.publicUrl);
        setLetterheadImageUrl(backgroundImage);
      } else {
        setLetterheadImageUrl(null);
      }
    }
  };

  const loadReport = async () => {
    setLoading(true);
    const { data: ext } = await supabase.from("extracted_report_data").select("*").eq("report_id", reportId).single();
    if (!ext) { setLoading(false); return; }

    // First pass dedupe, then backfill test_name from master data, then dedupe again
    const rawResults = (ext.test_results as unknown as TestResult[]) || [];
    let results = dedupeResultsLatest(rawResults);

    const paramNames = [...new Set(results.map((r) => r.parameter_name).filter(Boolean))];
    const { data: masterParams } = await supabase
      .from("report_test_parameters")
      .select("parameter_name, test_name, department_id, report_profiles(profile_name), report_departments:department_id(department_name)")
      .in("parameter_name", paramNames);

    // Also fetch with case-insensitive + singular/plural fallback for mismatched naming
    const unmatchedNames = paramNames.filter((pn) =>
      !masterParams?.some((mp) => mp.parameter_name === pn)
    );
    let allMasterParams = masterParams || [];
    if (unmatchedNames.length > 0) {
      const { data: fallbackParams } = await supabase
        .from("report_test_parameters")
        .select("parameter_name, test_name, department_id, report_profiles(profile_name), report_departments:department_id(department_name)");
      if (fallbackParams) {
        const lowerMap = new Map<string, Array<typeof fallbackParams[0]>>();
        fallbackParams.forEach((fp) => {
          const key = normalizeMatchKey(fp.parameter_name);
          const arr = lowerMap.get(key) || [];
          arr.push(fp);
          lowerMap.set(key, arr);
        });
        unmatchedNames.forEach((name) => {
          const norm = normalizeMatchKey(name);
          let matches = lowerMap.get(norm);
          // Fuzzy fallback: try adding/removing trailing 's' for singular/plural mismatch
          if ((!matches || matches.length === 0) && norm) {
            if (norm.endsWith("s")) {
              matches = lowerMap.get(norm.slice(0, -1));
            } else {
              matches = lowerMap.get(`${norm}s`);
            }
          }
          if (matches && matches.length > 0) {
            matches.forEach((m) => allMasterParams.push({ ...m, parameter_name: name }));
          }
        });
      }
    }

    if (allMasterParams.length > 0) {
      type MasterEntry = {
        parameter_name: string;
        test_name: string;
        profile_name: string;
        department_name: string;
      };

      const byParam = new Map<string, MasterEntry[]>();
      allMasterParams.forEach((mp: any) => {
        const key = normalizeMatchKey(mp.parameter_name);
        if (!key) return;
        const entry: MasterEntry = {
          parameter_name: mp.parameter_name || "",
          test_name: mp.test_name || "",
          profile_name: mp.report_profiles?.profile_name || "",
          department_name: mp.report_departments?.department_name || "",
        };
        const arr = byParam.get(key) || [];
        arr.push(entry);
        byParam.set(key, arr);
      });

      const resolveEntries = (parameterName: string) => {
        const key = normalizeMatchKey(parameterName);
        if (!key) return [] as MasterEntry[];
        let entries = byParam.get(key) || [];
        if (entries.length === 0) {
          entries = key.endsWith("s") ? byParam.get(key.slice(0, -1)) || [] : byParam.get(`${key}s`) || [];
        }
        return entries;
      };

      results = results.map((r) => {
        const updated = { ...r };
        const entries = resolveEntries(updated.parameter_name);
        if (entries.length === 0) return updated;

        const aiProfile = normalizeMatchKey(updated.profile_name);
        const aiTest = normalizeMatchKey(updated.test_name);

        const scored = entries.map((me) => {
          const dbProfile = normalizeMatchKey(me.profile_name);
          const dbTest = normalizeMatchKey(me.test_name);
          let score = 0;

          // Critical disambiguation: AI profile keywords (stool/urine) may exist only in DB test_name
          if (aiProfile && dbTest && hasDistinguishingOverlap(aiProfile, dbTest)) score += 20;
          if (aiTest && dbProfile && hasDistinguishingOverlap(aiTest, dbProfile)) score += 20;
          if (aiProfile && dbProfile && hasDistinguishingOverlap(aiProfile, dbProfile)) score += 15;
          if (aiTest && dbTest && hasKeywordOverlap(aiTest, dbTest)) score += 5;

          return { me, score };
        });

        const maxScore = Math.max(...scored.map((s) => s.score));
        const best = maxScore > 0
          ? scored.find((s) => s.score === maxScore)?.me
          : entries.find((e) => normalizeMatchKey(e.profile_name) === aiProfile)
            || entries.find((e) => normalizeMatchKey(e.test_name) === aiTest)
            || entries[0];

        if (!updated.profile_name && best?.profile_name) updated.profile_name = best.profile_name;
        if (!updated.department && best?.department_name) updated.department = best.department_name;

        // Only overwrite test_name when we have a confident match or test_name is missing
        if (best?.test_name && (maxScore > 0 || !updated.test_name)) {
          updated.test_name = best.test_name;
        }

        return updated;
      });
    }

    // Critical: run dedupe again after test_name backfill so old blank-test duplicates are removed
    results = dedupeResultsLatest(results);

    // Recompute H/L/N flags from result values and ranges (fixes missing flags after enrichment)
    results = normalizeTestResultFlags(results);

    const shouldPersistNormalizedResults = JSON.stringify(rawResults) !== JSON.stringify(results);
    if (shouldPersistNormalizedResults) {
      await supabase
        .from("extracted_report_data")
        .update({ test_results: results as unknown as any })
        .eq("report_id", reportId);
    }

    ext.test_results = results as any;

    // Fetch profile master data for metadata (sample_type, outsourced, interpretation)
    const profileNames = [...new Set(results.map(r => r.profile_name).filter(Boolean))] as string[];
    if (profileNames.length > 0) {
      const { data: masterProfiles } = await supabase
        .from("report_profiles")
        .select("profile_name, display_order, sample_type, analyzer, method, is_outsourced, outsourced_caption, interpretation, enable_test_grouping, force_single_page")
        .in("profile_name", profileNames);
      if (masterProfiles) {
        const metaMap: Record<string, ProfileMeta> = {};
        const profOrdMap: Record<string, number> = {};
        masterProfiles.forEach((mp: any) => {
          metaMap[mp.profile_name] = {
            sample_type: mp.sample_type,
            analyzer: mp.analyzer,
            method: mp.method,
            is_outsourced: mp.is_outsourced,
            outsourced_caption: mp.outsourced_caption,
            interpretation: mp.interpretation,
            enable_test_grouping: mp.enable_test_grouping,
            force_single_page: mp.force_single_page,
          };
          profOrdMap[mp.profile_name] = mp.display_order ?? 999;
        });
        setProfileMetaMap(metaMap);
        setProfileOrderMap(profOrdMap);
      }
    }

    // Enrich standalone parameters (not in a profile) with their master data
    const standaloneParams = results.filter(r => !r.profile_name || r.profile_name === "_individual");
    if (standaloneParams.length > 0) {
      const standaloneNames = standaloneParams.map(r => r.parameter_name);
      const { data: masterStandalone } = await supabase
        .from("report_test_parameters")
        .select("parameter_name, sample_type, analyzer, method, is_outsourced, outsourced_caption, interpretation")
        .in("parameter_name", standaloneNames)
        .is("profile_id", null);
      if (masterStandalone) {
        const paramMetaMap: Record<string, any> = {};
        masterStandalone.forEach((mp: any) => {
          paramMetaMap[mp.parameter_name.toLowerCase()] = mp;
        });
        results.forEach(r => {
          if (!r.profile_name || r.profile_name === "_individual") {
            const meta = paramMetaMap[r.parameter_name.toLowerCase()];
            if (meta) {
              r.sample_type = meta.sample_type;
              r.analyzer = meta.analyzer;
              r.method = meta.method;
              r.is_outsourced = meta.is_outsourced;
              r.outsourced_caption = meta.outsourced_caption;
              r.interpretation = meta.interpretation;
            }
          }
        });
      }
    }
    ext.test_results = results as any;

    // Fetch department display order
    const { data: depts } = await supabase.from("report_departments").select("department_name, display_order").order("display_order", { ascending: true });
    if (depts) {
      const orderMap: Record<string, number> = {};
      depts.forEach((d: any) => { orderMap[d.department_name] = d.display_order ?? 999; });
      setDeptOrderMap(orderMap);
    }

    setExtracted(ext);

    const { data: allSigs } = await supabase.from("pathologist_signatures").select("*");
    const sigMap: Record<string, any> = {};
    (allSigs || []).forEach((sig: any) => {
      sigMap[sig.pathologist_name.toLowerCase()] = sig;
    });
    setPathologistMap(sigMap);

    if (ext.umr_id) {
      // Only include parameters that exist in the current report
      const currentResults = (ext.test_results as unknown as TestResult[]) || [];
      const allParamNames = [...new Set(currentResults.map((r) => r.parameter_name))];
      
      if (allParamNames.length === 0) { setLoading(false); return; }
      
      // Fetch history in batches to avoid query limits
      let allHistory: any[] = [];
      const batchSize = 50;
      for (let i = 0; i < allParamNames.length; i += batchSize) {
        const batch = allParamNames.slice(i, i + batchSize);
        const { data: history } = await supabase.from("test_result_history")
          .select("*").eq("umr_id", ext.umr_id).in("parameter_name", batch)
          .order("test_date", { ascending: true });
        if (history) allHistory = allHistory.concat(history);
      }
      const history = allHistory;

      if (history && history.length > 0) {
        const grouped: Record<string, TrendData> = {};
        history.forEach((h: any) => {
          if (!grouped[h.parameter_name]) {
            grouped[h.parameter_name] = {
              parameter_name: h.parameter_name,
              data: [],
              low: h.normal_range_low,
              high: h.normal_range_high,
              unit: h.unit,
            };
          }
          grouped[h.parameter_name].data.push({
            date: new Date(h.test_date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" }),
            value: h.result_value,
            low: h.normal_range_low,
            high: h.normal_range_high,
          });
        });
        setTrends(Object.values(grouped).filter((t) => t.data.length >= 1));
      }
    }
    setLoading(false);
  };

  const handlePrint = () => window.print();

  const generatePdfBlob = async (): Promise<{ blob: Blob; fileName: string } | null> => {
    if (!printRef.current || !extracted) return null;

    const waitForPaint = async () => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    };

    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
    if (fonts?.ready) await fonts.ready;
    await waitForPaint();

    const pages = Array.from(printRef.current.querySelectorAll('.report-page')) as HTMLElement[];
    if (pages.length === 0) return null;

    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });

    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      const dataUrl = await toPng(page, {
        cacheBust: true,
        pixelRatio: 2,
        backgroundColor: '#ffffff',
        style: { transform: 'none' },
        filter: (node) => {
          if (!(node instanceof HTMLElement)) return true;
          return !node.classList.contains('recharts-tooltip-wrapper');
        },
      });
      if (i > 0) pdf.addPage();
      pdf.addImage(dataUrl, 'PNG', 0, 0, 210, 297, undefined, 'MEDIUM');
    }

    const patientName = (extracted.patient_name || 'Report').replace(/[^a-zA-Z0-9\s]/g, '').trim();
    const regDate = extracted.reg_date || extracted.report_date || new Date().toISOString().split('T')[0];
    const fileName = `${patientName}_${regDate}.pdf`;

    return { blob: pdf.output('blob'), fileName };
  };

  const handleDownloadClick = () => {
    setMobileNumber("");
    setMobileDialogOpen(true);
  };

  const formatWhatsApp = (raw: string): string => {
    const digits = raw.replace(/\D/g, "");
    return digits.slice(-10);
  };

  const handleMobileSubmit = async () => {
    const cleaned = formatWhatsApp(mobileNumber);
    if (cleaned.length < 10) {
      toast({ title: "Please enter a valid 10-digit mobile number", variant: "destructive" });
      return;
    }

    setMobileDialogOpen(false);
    setDownloading(true);
    setIsPdfExporting(true);

    try {
      const result = await generatePdfBlob();
      if (result) {
        // Download PDF
        const url = URL.createObjectURL(result.blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = result.fileName;
        a.click();
        URL.revokeObjectURL(url);

        // Save mobile number and set status to Dispatched
        if (reportId) {
          await supabase.from("uploaded_reports").update({ mobile_number: cleaned, status: "Dispatched" } as any).eq("id", reportId);
        }

        // Share on WhatsApp
        const patientName = extracted?.patient_name || "Patient";
        const message = `Dear ${patientName},\n\nYour lab report is ready. Please find the report shared with this message.\n\nThank you.`;
        shareOnWhatsApp(cleaned, message);

        toast({ title: "Report shared on WhatsApp" });
      }
    } catch (err) {
      console.error('PDF download failed:', err);
    } finally {
      setIsPdfExporting(false);
      setDownloading(false);
    }
  };

  if (loading) return <div className="flex items-center justify-center p-12"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  if (!extracted) return <div className="p-8 text-center">Report not found.</div>;

  const results = (extracted.test_results as unknown as TestResult[]) || [];

  const approverNames = [...new Set(results.map(r => r.approved_by).filter(Boolean))] as string[];
  const hasMultipleApprovers = approverNames.length > 1;

  const resultsByApprover: Record<string, TestResult[]> = {};
  if (hasMultipleApprovers) {
    results.forEach(r => {
      const approver = r.approved_by || "Unknown";
      if (!resultsByApprover[approver]) resultsByApprover[approver] = [];
      resultsByApprover[approver].push(r);
    });
  } else {
    resultsByApprover["_all"] = results;
  }

  const findPathologistSig = (name: string) => {
    const lower = name.toLowerCase();
    for (const key of Object.keys(pathologistMap)) {
      if (lower.includes(key) || key.includes(lower)) {
        return pathologistMap[key];
      }
    }
    return null;
  };

  const groupResults = (resultSet: TestResult[]) => {
    const grouped: Record<string, Record<string, TestResult[]>> = {};
    resultSet.forEach((r) => {
      const dept = r.department || "General";
      const prof = r.profile_name || "_individual";
      if (!grouped[dept]) grouped[dept] = {};
      if (!grouped[dept][prof]) grouped[dept][prof] = [];
      grouped[dept][prof].push(r);
    });
    // Sort by department display_order, then profiles by profile display_order
    const sorted: Record<string, Record<string, TestResult[]>> = {};
    Object.keys(grouped)
      .sort((a, b) => (deptOrderMap[a] ?? 999) - (deptOrderMap[b] ?? 999))
      .forEach(dept => {
        const profiles = grouped[dept];
        const sortedProfiles: Record<string, TestResult[]> = {};
        Object.keys(profiles)
          .sort((a, b) => (profileOrderMap[a] ?? 999) - (profileOrderMap[b] ?? 999))
          .forEach(prof => { sortedProfiles[prof] = profiles[prof]; });
        sorted[dept] = sortedProfiles;
      });
    return sorted;
  };

  const shouldShowProfile = (params: TestResult[]) => params.length >= 2;

  const topMarginMm = layoutSettings.top_margin_cm * 10;
  const bottomMarginMm = layoutSettings.bottom_margin_cm * 10;
  const PAGE_HEIGHT_MM = 297;
  const SAFETY_BUFFER_MM = 4; // extra buffer to prevent overlap
  const usableHeight = PAGE_HEIGHT_MM - topMarginMm - bottomMarginMm - HEADER_HEIGHT_MM - SIGNATURE_HEIGHT_MM - PAGE_NUM_HEIGHT_MM - SAFETY_BUFFER_MM;

  // Count unique test_names in params for height estimation
  const countTestNameHeaders = (params: TestResult[]): number => {
    const testNames = new Set(params.map(r => r.test_name).filter(Boolean));
    return testNames.size > 1 ? testNames.size : (testNames.size === 1 ? 1 : 0);
  };

  // Build sections for each approver group
  const buildSections = (approverResults: TestResult[], includeAbnormalSummary: boolean): PageSection[] => {
    const sections: PageSection[] = [];

    if (includeAbnormalSummary) {
      const allAbnormals = results.filter(r => r.flag === "H" || r.flag === "L");
      if (allAbnormals.length > 0) {
        // Split abnormal summary into chunks using text-aware row height estimation
        // so long range text moves correctly to continuation pages.
        const abnormalContentReserve = PAGE_NUM_HEIGHT_MM + 2;
        // Match actual render area so summary fills down to configured bottom margin.
        const abnormalUsableHeight = PAGE_HEIGHT_MM - topMarginMm - bottomMarginMm - HEADER_HEIGHT_MM - abnormalContentReserve - SAFETY_BUFFER_MM;
        const abnormalBodyMaxHeight = Math.max(20, abnormalUsableHeight - ABNORMAL_SUMMARY_BASE_MM - ABNORMAL_CHUNK_SAFETY_MM);

        const estimateAbnormalRowHeight = (row: TestResult) => {
          const rangeText =
            row.normal_range_text ||
            `${row.normal_range_low || ""}${row.normal_range_low || row.normal_range_high ? "-" : ""}${row.normal_range_high || ""}`;

          const paramLines = Math.max(1, Math.ceil((row.parameter_name?.trim().length || 1) / ABNORMAL_PARAM_CHARS_PER_LINE));
          const rangeLines = Math.max(1, Math.ceil((rangeText.trim().length || 1) / ABNORMAL_RANGE_CHARS_PER_LINE));
          const maxLines = Math.max(paramLines, rangeLines);

          return ABNORMAL_ROW_MM + (maxLines - 1) * ABNORMAL_EXTRA_LINE_MM;
        };

        let currentChunk: TestResult[] = [];
        let currentChunkHeight = 0;
        const chunkedAbnormals: { rows: TestResult[]; height: number }[] = [];

        allAbnormals.forEach((row) => {
          const rowHeight = estimateAbnormalRowHeight(row);
          const shouldStartNewChunk =
            currentChunk.length > 0 &&
            (currentChunkHeight + rowHeight) > abnormalBodyMaxHeight;

          if (shouldStartNewChunk) {
            chunkedAbnormals.push({ rows: currentChunk, height: currentChunkHeight });
            currentChunk = [row];
            currentChunkHeight = rowHeight;
          } else {
            currentChunk.push(row);
            currentChunkHeight += rowHeight;
          }
        });

        if (currentChunk.length > 0) {
          chunkedAbnormals.push({ rows: currentChunk, height: currentChunkHeight });
        }

        chunkedAbnormals.forEach((chunk, idx) => {
          sections.push({
            type: "abnormal-summary",
            abnormals: chunk.rows,
            estimatedHeightMm: ABNORMAL_SUMMARY_BASE_MM + chunk.height,
            isAbnormalOnly: true,
            isContinuation: idx > 0,
          });
        });
      }
    }

    const grouped = groupResults(approverResults);
    Object.entries(grouped).forEach(([dept, profiles]) => {
      Object.entries(profiles).forEach(([profName, params]) => {
        const showProf = profName !== "_individual" && shouldShowProfile(params);
        const testNameHeaders = countTestNameHeaders(params);
        const compact = isCompactProfile(profName) || isCompactProfile(dept);
        const rowH = compact ? ROW_HEIGHT_COMPACT_MM : ROW_HEIGHT_MM;
        // Extra height for metadata, outsourced caption, interpretation
        const isStandalone = profName === "_individual";
        const meta = !isStandalone ? profileMetaMap[profName] : (params[0] ? { sample_type: params[0].sample_type, analyzer: params[0].analyzer, method: params[0].method, is_outsourced: params[0].is_outsourced, outsourced_caption: params[0].outsourced_caption, interpretation: params[0].interpretation } : null);
        let extraMm = 0;
        if (meta) {
          if (meta.sample_type || meta.analyzer || meta.method) extraMm += 4;
          if (meta.is_outsourced && meta.outsourced_caption) extraMm += 4;
          if (meta.interpretation && meta.interpretation.replace(/<[^>]*>/g, '').trim().length > 0) {
            const textLen = meta.interpretation.replace(/<[^>]*>/g, '').length;
            extraMm += 6 + Math.ceil(textLen / 120) * 3;
          }
        }
        const heightMm = DEPT_HEADER_HEIGHT_MM + (showProf ? PROFILE_HEADER_HEIGHT_MM : 0) + TABLE_HEADER_HEIGHT_MM + params.length * rowH + testNameHeaders * TEST_NAME_HEADER_MM + PROFILE_GAP_MM + extraMm;
        sections.push({
          type: "department-profile",
          dept,
          profName,
          results: params,
          estimatedHeightMm: heightMm,
        });
      });
    });

    return sections;
  };

  // Paginate sections into pages
  const paginateSections = (sections: PageSection[]): PageSection[][] => {
    const pages: PageSection[][] = [];
    let currentPage: PageSection[] = [];
    let currentHeight = 0;

    sections.forEach((section) => {
      const pageUsable = section.isAbnormalOnly
        ? (PAGE_HEIGHT_MM - topMarginMm - bottomMarginMm - HEADER_HEIGHT_MM - PAGE_NUM_HEIGHT_MM)
        : usableHeight;

      // Abnormal summary pages are dedicated — nothing else shares the page
      if (section.isAbnormalOnly) {
        if (currentPage.length > 0) {
          pages.push(currentPage);
          currentPage = [];
          currentHeight = 0;
        }
        pages.push([section]);
        return;
      }

      // CBC / Urine profiles or force_single_page profiles get their own dedicated page
      if (isDedicatedReportProfile(section) || isForceSinglePageProfile(section, profileMetaMap)) {
        if (currentPage.length > 0) {
          pages.push(currentPage);
          currentPage = [];
          currentHeight = 0;
        }

        pages.push([section]);
        return;
      }

      if (currentHeight + section.estimatedHeightMm > pageUsable && currentPage.length > 0) {
        pages.push(currentPage);
        currentPage = [];
        currentHeight = 0;
      }

      currentPage.push(section);
      currentHeight += section.estimatedHeightMm;
    });

    if (currentPage.length > 0) {
      pages.push(currentPage);
    }

    return pages;
  };

  // Build all pages across all approvers
  interface ReportPage {
    sections: PageSection[];
    approverKey: string;
    approverName: string;
  }

  const allPages: ReportPage[] = [];
  const approverEntries = Object.entries(resultsByApprover);

  approverEntries.forEach(([approverKey, approverResults], approverIdx) => {
    const sections = buildSections(approverResults, approverIdx === 0);
    const pages = paginateSections(sections);
    const approverName = approverKey === "_all" ? (extracted.pathologist_name || "") : approverKey;
    pages.forEach((pageSections) => {
      allPages.push({ sections: pageSections, approverKey, approverName });
    });
  });

  // Add trends pages (6 charts per page)
  const hasTrends = trends.length > 0;
  const trendPageCount = hasTrends ? Math.ceil(trends.length / 6) : 0;
  const totalPages = allPages.length + trendPageCount;

  const renderPageSections = (sections: PageSection[]) => {
    const seenDepts = new Set<string>();
    return sections.map((section, idx) => {
      if (section.type === "abnormal-summary" && section.abnormals) {
        return <ReportAbnormalSummary key={`abnormal-${idx}`} abnormalResults={section.abnormals} isContinuation={section.isContinuation} />;
      }
      if (section.type === "department-profile" && section.results && section.dept) {
        const showDeptHeader = !seenDepts.has(section.dept);
        seenDepts.add(section.dept);
        const grouped: Record<string, Record<string, TestResult[]>> = {
          [section.dept]: { [section.profName || "_individual"]: section.results },
        };
        return (
          <div key={`${section.dept}-${section.profName}-${idx}`} style={{ marginBottom: `${PROFILE_GAP_MM}mm` }}>
            <ReportResultsSection grouped={grouped} shouldShowProfile={shouldShowProfile} hideDeptHeader={!showDeptHeader} profileMetaMap={profileMetaMap} />
          </div>
        );
      }
      return null;
    });
  };

  return (
    <div className="space-y-4 print:space-y-0">
      <div className="flex items-center gap-4 print:hidden flex-wrap">
        <Button variant="outline" size="sm" onClick={() => navigate("/reports")}><ArrowLeft className="h-4 w-4 mr-1" />Back</Button>
        <Button variant="outline" size="sm" onClick={() => navigate(`/reports/review/${reportId}`)}><Pencil className="h-4 w-4 mr-1" />Edit Data</Button>
        <Button size="sm" onClick={handlePrint}><Printer className="h-4 w-4 mr-1" />Print</Button>
        <Button size="sm" variant="outline" onClick={handleDownloadClick} disabled={downloading}>
          {downloading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Download className="h-4 w-4 mr-1" />}
          {downloading ? "Downloading..." : "Download PDF"}
        </Button>
        <div className="flex items-center gap-2">
          <Switch id="show-header" checked={showHeader} onCheckedChange={setShowHeader} />
          <Label htmlFor="show-header" className="text-sm cursor-pointer">
            {showHeader ? "With Letterhead" : "Without Letterhead"}
          </Label>
        </div>
      </div>

      <div ref={printRef} className={`bg-white text-black print:text-black mx-auto max-w-[210mm] print:max-w-none report-print-area ${isPdfExporting ? 'pdf-export-mode' : ''}`} style={{ fontFamily: "'Segoe UI', Arial, sans-serif" }}>
        {allPages.map((page, pageIdx) => {
          const isAbnormalOnlyPage = page.sections.every(s => s.isAbnormalOnly);
          const contentBottomReserveMm = isAbnormalOnlyPage
            ? (PAGE_NUM_HEIGHT_MM + 2)
            : (SIGNATURE_HEIGHT_MM + PAGE_NUM_HEIGHT_MM + 4);
          const pathologist = findPathologistSig(page.approverName);
          const sigUrl = pathologist?.signature_image_path
            ? supabase.storage.from("signatures").getPublicUrl(pathologist.signature_image_path).data.publicUrl
            : null;

          const isDedicatedPage = page.sections.length === 1 && (isDedicatedReportProfile(page.sections[0]) || isForceSinglePageProfile(page.sections[0], profileMetaMap));
          // For dedicated/force-single-page profiles, compute max content height for auto-scaling
          const contentMaxHeightMm = isDedicatedPage
            ? PAGE_HEIGHT_MM - topMarginMm - bottomMarginMm - HEADER_HEIGHT_MM - SIGNATURE_HEIGHT_MM - PAGE_NUM_HEIGHT_MM - 6
            : 0;

          return (
            <div key={pageIdx} className="report-page"
              style={{ paddingTop: `${topMarginMm}mm`, paddingBottom: `${bottomMarginMm}mm` }}>
              
              <ReportHeader extracted={extracted} />

              <div className="space-y-1" style={{ paddingLeft: '12mm', paddingRight: '12mm', paddingBottom: `${contentBottomReserveMm}mm` }}>
                {isDedicatedPage ? (
                  <AutoScaleContent maxHeightMm={contentMaxHeightMm}>
                    {renderPageSections(page.sections)}
                  </AutoScaleContent>
                ) : (
                  renderPageSections(page.sections)
                )}
              </div>

              {!isAbnormalOnlyPage && (
                <div style={{ position: 'absolute', bottom: `${bottomMarginMm + PAGE_NUM_HEIGHT_MM + 1}mm`, left: '12mm', right: '12mm' }}>
                  <ReportSignatureBlock
                    signatureUrl={sigUrl}
                    pathologistName={pathologist?.pathologist_name || page.approverName}
                    qualification={pathologist?.qualification}
                    designation={pathologist?.designation}
                  />
                </div>
              )}

              <div className="page-number-footer" style={{ position: 'absolute', bottom: `${bottomMarginMm + 2}mm`, left: 0, right: 0, textAlign: 'center', fontSize: '9px', color: '#666' }}>
                Page {pageIdx + 1} of {totalPages}
              </div>
            </div>
          );
        })}

        {hasTrends && (() => {
          // Split trends into pages of 6 charts each (3 rows x 2 cols)
          const chartsPerPage = 6;
          const trendPages: TrendData[][] = [];
          for (let i = 0; i < trends.length; i += chartsPerPage) {
            trendPages.push(trends.slice(i, i + chartsPerPage));
          }
          const basePageNum = allPages.length;
          return trendPages.map((pageTrends, tpIdx) => (
            <div key={`trend-page-${tpIdx}`} className="report-page" style={{ paddingTop: `${topMarginMm}mm`, paddingBottom: `${bottomMarginMm}mm` }}>
              <ReportHeader extracted={extracted} />
              <div style={{ paddingLeft: '12mm', paddingRight: '12mm' }}>
                <ReportTrendCharts trends={pageTrends} />
              </div>
              <div className="page-number-footer" style={{ position: 'absolute', bottom: `${bottomMarginMm + 2}mm`, left: 0, right: 0, textAlign: 'center', fontSize: '9px', color: '#666' }}>
                Page {basePageNum + tpIdx + 1} of {totalPages}
              </div>
            </div>
          ));
        })()}
      </div>

      <style>{`
        @media print {
          html, body {
            margin: 0 !important;
            padding: 0 !important;
          }
          body * { visibility: hidden; }
          .report-print-area, .report-print-area * { visibility: visible; }
          .report-print-area { 
            position: absolute;
            left: 50%;
            top: 0;
            transform: translateX(-50%);
            width: 210mm !important; 
            max-width: 210mm !important;
            margin: 0 !important;
            padding: 0 !important;
          }
          .print\\:hidden { display: none !important; }
          .print\\:break-inside-avoid { break-inside: avoid; }
          .trend-chart-detail-row {
            overflow: hidden !important;
          }
          .report-print-area *::-webkit-scrollbar { display: none !important; }
          .report-print-area * { scrollbar-width: none !important; }
          .report-page {
            height: 296mm;
            max-height: 296mm;
            width: 210mm;
            box-sizing: border-box;
            position: relative;
            overflow: hidden;
            page-break-after: always;
            page-break-inside: avoid;
            margin: 0 auto !important;
          }
          .report-page:last-child {
            page-break-after: auto;
          }
          @page {
            size: A4;
            margin: 0;
          }
          ${showHeader && letterheadImageUrl ? `
          .report-page {
            background-image: url("${letterheadImageUrl}");
            background-size: 210mm 296mm;
            background-repeat: no-repeat;
            background-position: top center;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          ` : ''}
        }

        .pdf-export-mode .report-page {
          height: 297mm !important;
          max-height: 297mm !important;
          width: 210mm !important;
          margin: 0 auto !important;
          border: 0 !important;
          overflow: hidden !important;
        }
        .pdf-export-mode .recharts-tooltip-wrapper {
          display: none !important;
          visibility: hidden !important;
        }
        .pdf-export-mode .flag-badge {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-width: 14px;
          height: 14px;
          line-height: 1 !important;
          font-size: 10px !important;
          font-weight: 700;
          font-family: 'Segoe UI', Arial, sans-serif;
        }
        .pdf-export-mode .trend-chart-box {
          padding-bottom: 8px !important;
        }
        .pdf-export-mode .trend-chart-detail-row {
          padding-bottom: 2px !important;
          overflow: hidden !important;
        }
        .pdf-export-mode .trend-chart-detail-item span {
          line-height: 1.25 !important;
        }
        ${showHeader && letterheadImageUrl ? `
        .pdf-export-mode .report-page {
          background-image: url("${letterheadImageUrl}");
          background-size: 210mm 297mm;
          background-repeat: no-repeat;
          background-position: top center;
        }
        ` : ''}
        /* Screen preview */
        .report-page {
          min-height: 297mm;
          height: 297mm;
          width: 210mm;
          box-sizing: border-box;
          position: relative;
          margin: 0 auto 16px auto;
          border: 1px solid #e5e7eb;
          overflow: hidden;
          ${showHeader && letterheadImageUrl ? `
          background-image: url("${letterheadImageUrl}");
          background-size: 210mm 297mm;
          background-repeat: no-repeat;
          background-position: top center;
          ` : ''}
        }
      `}</style>

      <Dialog open={mobileDialogOpen} onOpenChange={setMobileDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Share Report on WhatsApp</DialogTitle>
            <DialogDescription>Enter the patient's mobile number to share this report.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="mobile-input">Mobile Number</Label>
            <Input
              id="mobile-input"
              placeholder="Paste number (any format)"
              type="tel"
              value={mobileNumber}
              onChange={(e) => setMobileNumber(e.target.value)}
              inputMode="numeric"
              onWheel={(e) => (e.target as HTMLInputElement).blur()}
            />
            {mobileNumber && (
              <p className="text-xs text-muted-foreground mt-1">
                Formatted: {formatWhatsApp(mobileNumber) || "Need 10+ digits"}
              </p>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setMobileDialogOpen(false)}>Skip</Button>
            <Button onClick={handleMobileSubmit} disabled={formatWhatsApp(mobileNumber).length !== 10}>
              Share on WhatsApp
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ViewReport;
