import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Save, FileCheck, AlertTriangle, Trash2, Plus, Check, ShieldCheck, MessageSquarePlus, Search } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import AddParameterToMasterDialog from "@/components/AddParameterToMasterDialog";
import { computeAbnormalFlag, normalizeTestResultFlags } from "@/lib/reportFlags";
import * as pdfjsLib from "pdfjs-dist";

pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.worker.min.mjs`;

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
  matched_parameter_id?: string;
  approved_by?: string;
  source_page?: number;
  confidence_score?: number;
  extraction_basis?: string;
  remark?: string;
  _merge_status?: "new" | "updated" | "existing";
}

const ReviewReport = () => {
  const { reportId } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [extractedData, setExtractedData] = useState<any>(null);
  const [patientName, setPatientName] = useState("");
  const [age, setAge] = useState("");
  const [gender, setGender] = useState("");
  const [umrId, setUmrId] = useState("");
  const [refDoctor, setRefDoctor] = useState("");
  const [collectionDate, setCollectionDate] = useState("");
  const [reportDate, setReportDate] = useState("");
  const [pathologistName, setPathologistName] = useState("");
  const [regNo, setRegNo] = useState("");
  const [regDate, setRegDate] = useState("");
  const [sampleCollectionDate, setSampleCollectionDate] = useState("");
  const [accessionDate, setAccessionDate] = useState("");
  const [authenticationDate, setAuthenticationDate] = useState("");
  const [printDate, setPrintDate] = useState("");
  const [locationField, setLocationField] = useState("");
  const [testResults, setTestResults] = useState<TestResult[]>([]);
  const [showUmrDialog, setShowUmrDialog] = useState(false);
  const [umrInput, setUmrInput] = useState("");
  const [pathologists, setPathologists] = useState<any[]>([]);
  const [selectedPathologist, setSelectedPathologist] = useState("");
  const [masterParams, setMasterParams] = useState<Map<string, Array<{ department_name?: string; profile_name?: string }>>>(new Map());
  const [masterParamIds, setMasterParamIds] = useState<Set<string>>(new Set());
  const [addParamDialogOpen, setAddParamDialogOpen] = useState(false);
  const [addParamIndex, setAddParamIndex] = useState<number | null>(null);
  const [reverified, setReverified] = useState(false);
  const [reverifying, setReverifying] = useState(false);
  const [remarkDialogOpen, setRemarkDialogOpen] = useState(false);
  const [remarkIndex, setRemarkIndex] = useState<number | null>(null);
  const [remarkText, setRemarkText] = useState("");
  const [paramSearch, setParamSearch] = useState("");
  const originalAiResultsRef = useRef<TestResult[] | null>(null);

  useEffect(() => {
    loadData();
  }, [reportId]);

  // Refresh master data and re-enrich current test results on page focus
  useEffect(() => {
    const handleFocus = () => {
      if (!loading) refreshMasterData();
    };
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [loading, testResults]);

  const normalizeParameterForMatch = (value: unknown) =>
    String(value ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .split(" ")
      .filter(Boolean)
      .map((token) => (token.endsWith("s") && token.length > 3 ? token.slice(0, -1) : token))
      .join(" ");

  const buildMasterMaps = async () => {
    const [{ data: params }, { data: depts }, { data: profiles }, { data: profileParams }] = await Promise.all([
      supabase.from("report_test_parameters").select("id, parameter_name, test_name, department_id, profile_id"),
      supabase.from("report_departments").select("id, department_name"),
      supabase.from("report_profiles").select("id, profile_name, department_id"),
      supabase.from("profile_parameters").select("profile_id, parameter_id, report_test_parameters(parameter_name, test_name)"),
    ]);

    const deptMap = new Map((depts || []).map((d: any) => [d.id, d.department_name]));
    const profileNameMap = new Map((profiles || []).map((p: any) => [p.id, p.profile_name]));

    // masterMap: normalized name → array of possible master entries (handles duplicate param names)
    // Each entry includes test_name and profile_name for keyword-based disambiguation
    const masterMap = new Map<string, Array<{ department_name?: string; profile_name?: string; test_name?: string }>>();
    const paramIdToNameKey = new Map<string, string>();
    const masterIds = new Set<string>();

    (params || []).forEach((p: any) => {
      const key = normalizeParameterForMatch(p.parameter_name);
      if (!key) return;
      paramIdToNameKey.set(p.id, key);
      masterIds.add(p.id);
      const deptName = p.department_id ? deptMap.get(p.department_id) || "" : "";
      const profName = p.profile_id ? profileNameMap.get(p.profile_id) || "" : "";
      const entry = { department_name: deptName, profile_name: profName, test_name: p.test_name || "" };

      const existing = masterMap.get(key) || [];
      existing.push(entry);
      masterMap.set(key, existing);
    });

    const profileGroups = new Map<string, { name: string; deptName: string; paramNames: string[] }>();
    (profileParams || []).forEach((pp: any) => {
      const paramName = paramIdToNameKey.get(pp.parameter_id) || normalizeParameterForMatch(pp.report_test_parameters?.parameter_name);
      if (!paramName) return;
      const existing = profileGroups.get(pp.profile_id);
      if (existing) {
        existing.paramNames.push(paramName);
      } else {
        const profRec = (profiles || []).find((pr: any) => pr.id === pp.profile_id);
        const profDeptName = profRec?.department_id ? deptMap.get(profRec.department_id) || "" : "";
        profileGroups.set(pp.profile_id, {
          name: profileNameMap.get(pp.profile_id) || "",
          deptName: profDeptName,
          paramNames: [paramName],
        });
      }
    });

    return { masterMap, profileGroups, paramIdToNameKey, masterIds };
  };

  // Helper: extract distinguishing keywords (skip generic lab terms)
  const GENERIC_LAB_WORDS = new Set(["physical", "chemical", "microscopic", "examination", "routine", "analysi", "analysis", "test"]);
  
  const getDistinguishingWords = (normalized: string): string[] =>
    normalized.split(" ").filter(w => w.length > 2 && !GENERIC_LAB_WORDS.has(w));

  // Helper: check if two normalized strings share significant keywords
  const hasKeywordOverlap = (a: string, b: string): boolean => {
    if (!a || !b) return false;
    if (a === b || a.includes(b) || b.includes(a)) return true;
    const wordsA = a.split(" ").filter(w => w.length > 3);
    const wordsB = new Set(b.split(" ").filter(w => w.length > 3));
    return wordsA.some(w => wordsB.has(w));
  };

  // Helper: check if two strings share distinguishing (non-generic) keywords
  const hasDistinguishingOverlap = (a: string, b: string): boolean => {
    if (!a || !b) return false;
    const wordsA = getDistinguishingWords(a);
    const wordsB = new Set(getDistinguishingWords(b));
    return wordsA.some(w => wordsB.has(w));
  };

  const enrichResults = (
    results: TestResult[],
    masterMap: Map<string, Array<{ department_name?: string; profile_name?: string; test_name?: string }>>,
    profileGroups: Map<string, { name: string; deptName: string; paramNames: string[] }>,
    paramIdToNameKey: Map<string, string>,
  ) => {
    const extractedParamNames = new Set<string>();

    results.forEach((r) => {
      const key = normalizeParameterForMatch(r.parameter_name);
      if (key) extractedParamNames.add(key);
      if (r.matched_parameter_id) {
        const matchedKey = paramIdToNameKey.get(r.matched_parameter_id);
        if (matchedKey) extractedParamNames.add(matchedKey);
      }
    });

    // matchedProfileParams: normalized param name → array of { profileName, deptName, paramCount }
    const matchedProfileParams = new Map<string, Array<{ profileName: string; deptName: string; paramCount: number }>>();
    profileGroups.forEach((group) => {
      const allPresent = group.paramNames.every((pn) => extractedParamNames.has(pn));
      if (allPresent) {
        group.paramNames.forEach((pn) => {
          const arr = matchedProfileParams.get(pn) || [];
          arr.push({ profileName: group.name, deptName: group.deptName, paramCount: group.paramNames.length });
          matchedProfileParams.set(pn, arr);
        });
      }
    });

    return results.map((r) => {
      const key = normalizeParameterForMatch(r.parameter_name);
      const matchedKeyFromId = r.matched_parameter_id ? paramIdToNameKey.get(r.matched_parameter_id) : "";

      const allMasterEntries = masterMap.get(key) || (matchedKeyFromId ? masterMap.get(matchedKeyFromId) : undefined) || [];
      const profileEntries = matchedProfileParams.get(key) || (matchedKeyFromId ? matchedProfileParams.get(matchedKeyFromId) : undefined) || [];

      // Build AI context strings for keyword matching
      const aiTestKey = normalizeParameterForMatch(r.test_name);
      const aiProfileKey = normalizeParameterForMatch(r.profile_name);
      // Combine AI test_name + profile_name for broader keyword matching
      const aiContext = [aiTestKey, aiProfileKey].filter(Boolean).join(" ");

      // When multiple master entries exist, disambiguate by keyword overlap
      // Focus on DISTINGUISHING keywords (e.g., "stool", "urine") not generic ones ("physical", "examination")
      let masterEntries = allMasterEntries;
      if (allMasterEntries.length > 1 && aiContext) {
        const scored = allMasterEntries.map(me => {
          const dbTestKey = normalizeParameterForMatch(me.test_name);
          const dbProfKey = normalizeParameterForMatch(me.profile_name);
          let score = 0;
          // Cross-match: AI profile_name keywords ↔ DB test_name (critical for stool/urine disambiguation)
          if (aiProfileKey && dbTestKey && hasDistinguishingOverlap(aiProfileKey, dbTestKey)) score += 20;
          // Cross-match: AI test_name keywords ↔ DB profile_name
          if (aiTestKey && dbProfKey && hasDistinguishingOverlap(aiTestKey, dbProfKey)) score += 20;
          // Direct profile match with distinguishing words
          if (aiProfileKey && dbProfKey && hasDistinguishingOverlap(aiProfileKey, dbProfKey)) score += 15;
          // Direct test_name match
          if (aiTestKey && dbTestKey && hasKeywordOverlap(aiTestKey, dbTestKey)) score += 5;
          return { entry: me, score };
        });
        const maxScore = Math.max(...scored.map(s => s.score));
        if (maxScore > 0) {
          masterEntries = scored.filter(s => s.score === maxScore).map(s => s.entry);
        }
      }

      // Use AI-extracted profile_name/department to disambiguate duplicates
      const aiProfile = normalizeParameterForMatch(r.profile_name);
      const aiDept = normalizeParameterForMatch(r.department);

      let bestProfile = "";
      let bestDept = "";

      if (profileEntries.length === 1) {
        bestProfile = profileEntries[0].profileName;
        bestDept = profileEntries[0].deptName;
      } else if (profileEntries.length > 1) {
        // Prefer the LARGEST profile (most parameters) — it's the most specific match
        // e.g., "CBC + ESR" (25 params) over "CBC" (24 params)
        const sorted = [...profileEntries].sort((a, b) => b.paramCount - a.paramCount);
        // If the largest profile is strictly bigger, use it directly
        if (sorted[0].paramCount > sorted[1].paramCount) {
          bestProfile = sorted[0].profileName;
          bestDept = sorted[0].deptName;
        } else {
          // Same size — fall back to keyword disambiguation
          const byProfile = aiProfile ? profileEntries.find((pe) => {
            const dbProf = normalizeParameterForMatch(pe.profileName);
            return hasKeywordOverlap(aiProfile, dbProf);
          }) : undefined;
          const byDept = aiDept ? profileEntries.find((pe) => normalizeParameterForMatch(pe.deptName) === aiDept) : undefined;
          const best = byProfile || byDept || sorted[0];
          bestProfile = best.profileName;
          bestDept = best.deptName;
        }
      }

      if (!bestDept && masterEntries.length > 0) {
        if (masterEntries.length === 1) {
          bestDept = masterEntries[0].department_name || "";
        } else {
          const byDept = aiDept ? masterEntries.find((me) => normalizeParameterForMatch(me.department_name) === aiDept) : undefined;
          bestDept = (byDept || masterEntries[0]).department_name || "";
        }
      }

      // Map AI test_name → DB master test_name for consistent grouping
      let bestTestName = r.test_name || "";
      if (masterEntries.length === 1 && masterEntries[0].test_name) {
        bestTestName = masterEntries[0].test_name;
      } else if (masterEntries.length > 1) {
        const matched = masterEntries.find(me => me.test_name);
        if (matched) bestTestName = matched.test_name || bestTestName;
      }

      return {
        ...r,
        department: bestDept,
        profile_name: bestProfile,
        test_name: bestTestName || r.test_name,
      };
    });
  };

  const hasMasterMatch = (row: TestResult) => {
    const key = normalizeParameterForMatch(row.parameter_name);
    return (key && masterParams.has(key)) || (!!row.matched_parameter_id && masterParamIds.has(row.matched_parameter_id));
  };

  // Refresh only master data and re-enrich current results (preserves user edits)
  const refreshMasterData = async () => {
    const { masterMap, profileGroups, paramIdToNameKey, masterIds } = await buildMasterMaps();
    setMasterParams(masterMap);
    setMasterParamIds(masterIds);
    setTestResults((prev) => {
      const enriched = enrichResults(prev, masterMap, profileGroups, paramIdToNameKey);
      return normalizeTestResultFlags(enriched);
    });
  };

  const loadData = async () => {
    setLoading(true);
    const [{ data: extracted }, { data: sigs }] = await Promise.all([
      supabase.from("extracted_report_data").select("*").eq("report_id", reportId).single(),
      supabase.from("pathologist_signatures").select("*"),
    ]);

    const { masterMap, profileGroups, paramIdToNameKey, masterIds } = await buildMasterMaps();
    setMasterParams(masterMap);
    setMasterParamIds(masterIds);

    if (extracted) {
      setExtractedData(extracted);
      setPatientName(extracted.patient_name || "");
      setAge(extracted.age || "");
      setGender(extracted.gender || "");
      setUmrId(extracted.umr_id || "");
      setRefDoctor(extracted.ref_doctor || "");
      setCollectionDate(extracted.collection_date || "");
      setReportDate(extracted.report_date || "");
      setPathologistName(extracted.pathologist_name || "");
      setRegNo((extracted as any).reg_no || "");
      setRegDate((extracted as any).reg_date || "");
      setSampleCollectionDate((extracted as any).sample_collection_date || "");
      setAccessionDate((extracted as any).accession_date || "");
      setAuthenticationDate((extracted as any).authentication_date || "");
      setPrintDate((extracted as any).print_date || "");
      setLocationField((extracted as any).location || "");
      const rawResults = (extracted.test_results as unknown as TestResult[]) || [];

      const enrichedResults = enrichResults(rawResults, masterMap, profileGroups, paramIdToNameKey);
      const normalized = normalizeTestResultFlags(enrichedResults);
      setTestResults(normalized);
      // Always refresh original AI results snapshot on load/reload
      originalAiResultsRef.current = normalized.map(r => ({ ...r }));

      // Persist cleanup so reopened Review/Edit stays deduplicated
      if (rawResults.length !== normalized.length) {
        await supabase
          .from("extracted_report_data")
          .update({ test_results: normalized as unknown as any })
          .eq("report_id", reportId);
      }
      if (!extracted.umr_id) setShowUmrDialog(true);
    }
    setPathologists(sigs || []);
    if (extracted?.pathologist_name && sigs?.length) {
      const match = sigs.find((s: any) => s.pathologist_name.toLowerCase().includes(extracted.pathologist_name?.toLowerCase() || ""));
      if (match) setSelectedPathologist(match.id);
    }
    setLoading(false);
  };

  const updateTestResult = (index: number, field: keyof TestResult, value: string) => {
    setReverified(false); // Reset re-verification when results change
    setTestResults((prev) => {
      const updated = prev.map((r, i) => (i === index ? { ...r, [field]: value } : r));
      if (field === "result_value" || field === "normal_range_low" || field === "normal_range_high" || field === "normal_range_text") {
        const row = updated[index];
        updated[index] = { ...row, flag: computeAbnormalFlag(row) };
      }
      return updated;
    });
  };

  const normalizeResultKey = (value: unknown) =>
    String(value ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();


  const getResultKey = (row: Partial<TestResult>, index = 0) => {
    const parameter = normalizeResultKey(row.parameter_name);
    const testName = normalizeResultKey(row.test_name || row.parameter_name);
    const sourcePage = Number(row.source_page) || 0;
    return `${parameter || `row-${index}`}|${testName}|${sourcePage}`;
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
      const current = rows.get(yBucket) || [];
      current.push({ x: item.x, text: item.text });
      rows.set(yBucket, current);
    });

    const rowText = Array.from(rows.entries())
      .sort((a, b) => b[0] - a[0])
      .map(([, rowItems]) => rowItems.sort((a, b) => a.x - b.x).map((item) => item.text).join(" | "));

    return rowText.join("\n").slice(0, 22000);
  };

  const convertPdfToPages = async (filePath: string): Promise<Array<{ pageNumber: number; image: string; textLayer: string }>> => {
    const { data: fileData } = supabase.storage.from("report-uploads").getPublicUrl(filePath);
    const response = await fetch(fileData.publicUrl);
    const arrayBuffer = await response.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const pages: Array<{ pageNumber: number; image: string; textLayer: string }> = [];
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
    }

    return pages;
  };

  const buildPageBatches = (pages: Array<{ pageNumber: number; image: string; textLayer: string }>) => {
    const MAX_BATCH_CHARS = 1_800_000;
    const MAX_PAGES_PER_BATCH = 2;
    const batches: Array<Array<{ pageNumber: number; image: string; textLayer: string }>> = [];
    let currentBatch: Array<{ pageNumber: number; image: string; textLayer: string }> = [];
    let currentChars = 0;

    for (const page of pages) {
      const payloadSize = page.image.length + page.textLayer.length;
      if (
        currentBatch.length > 0 &&
        (currentChars + payloadSize > MAX_BATCH_CHARS || currentBatch.length >= MAX_PAGES_PER_BATCH)
      ) {
        batches.push(currentBatch);
        currentBatch = [];
        currentChars = 0;
      }

      currentBatch.push(page);
      currentChars += payloadSize;
    }

    if (currentBatch.length > 0) batches.push(currentBatch);
    return batches;
  };

  const handleReverifyAbnormals = async () => {
    setReverifying(true);
    try {
      const { data: report } = await supabase
        .from("uploaded_reports")
        .select("file_path")
        .eq("id", reportId)
        .single();

      if (!report?.file_path) {
        toast({ title: "Error", description: "Could not find the uploaded PDF file.", variant: "destructive" });
        setReverifying(false);
        return;
      }

      const pages = await convertPdfToPages(report.file_path);
      const batches = buildPageBatches(pages);
      const sentKeys = new Set<string>();
      let allVerified: any[] = [];

      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        const pageNumbers = batch.map((p) => p.pageNumber);

        const scopedRows = testResults.filter((row) => {
          const key = getResultKey(row);
          if (sentKeys.has(key)) return false;

          const sourcePage = Number(row.source_page);
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
            strictMode: true,
          },
        });

        // Accept partial results even on 402 (credits exhausted)
        if (data?.verified_results) {
          allVerified = [...allVerified, ...data.verified_results];
        }
        if (data?.error?.includes("credits exhausted")) {
          toast({ title: "AI credits exhausted", description: "Partial re-verification applied.", variant: "destructive" });
          break;
        }
        if (error && !data?.verified_results) throw error;
      }

      if (allVerified.length > 0) {
        const verifiedMap = new Map<string, any>();
        allVerified.forEach((row: any) => {
          verifiedMap.set(getResultKey(row), row);
        });

        const corrected = testResults.map((row) => {
          const verified = verifiedMap.get(getResultKey(row));
          if (!verified) return row;

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

        const recalculated = dedupeTestResults(normalizeTestResultFlags(corrected));
        setTestResults(recalculated);
        const abnormalCount = recalculated.filter((r) => r.flag === "H" || r.flag === "L").length;
        toast({ title: "Re-verification complete", description: `${allVerified.length} parameters rechecked from matching pages. ${abnormalCount} abnormal result(s) confirmed.` });
      } else {
        const recalculated = dedupeTestResults(normalizeTestResultFlags(testResults));
        setTestResults(recalculated);
        toast({ title: "Re-verification complete", description: "No corrections were needed." });
      }

      setReverified(true);
    } catch (err: any) {
      console.error("Re-verify error:", err);
      toast({ title: "Re-verification failed", description: err.message || "Please try again.", variant: "destructive" });
    }
    setReverifying(false);
  };

  const removeTestResult = (index: number) => {
    setTestResults((prev) => prev.filter((_, i) => i !== index));
  };

  const calculateFlags = (results: TestResult[]): TestResult[] => {
    return normalizeTestResultFlags(results);
  };

  // Get unique approving doctors from test results
  const uniqueApprovers = [...new Set(testResults.map(r => r.approved_by).filter(Boolean))];

  const TRACKED_FIELDS: (keyof TestResult)[] = ["parameter_name", "result_value", "unit", "normal_range_low", "normal_range_high", "normal_range_text", "flag"];

  const logCorrections = async (finalResults: TestResult[]) => {
    const originals = originalAiResultsRef.current;
    if (!originals || originals.length === 0) return;

    const corrections: Array<{ parameter_name: string; field_corrected: string; original_value: string; corrected_value: string }> = [];

    // Build lookup by key, but also keep index-based fallback for parameter_name changes
    const getDedupeKeyLocal = (row: Partial<TestResult>) =>
      `${normalizeResultKey(row.parameter_name)}::${normalizeResultKey(row.test_name)}`;
    const originalsByKey = new Map<string, TestResult>();
    originals.forEach((row) => originalsByKey.set(getDedupeKeyLocal(row), row));

    for (let i = 0; i < finalResults.length; i++) {
      const curr = finalResults[i];
      const orig = originalsByKey.get(getDedupeKeyLocal(curr)) || (i < originals.length ? originals[i] : null);
      if (!orig) continue;

      for (const field of TRACKED_FIELDS) {
        const origVal = String(orig[field] ?? "");
        const currVal = String(curr[field] ?? "");
        if (origVal !== currVal && currVal !== "") {
          corrections.push({
            parameter_name: curr.parameter_name,
            field_corrected: field,
            original_value: origVal,
            corrected_value: currVal,
          });
        }
      }
    }

    if (corrections.length > 0) {
      await supabase.from("extraction_corrections" as any).insert(corrections);
      console.log(`Logged ${corrections.length} extraction corrections for feedback loop.`);
    }
  };

  const handleSaveAndGenerate = async () => {
    if (!umrId) {
      setShowUmrDialog(true);
      return;
    }
    const emptyDeptRows = testResults.filter((r, i) => !r.department?.trim());
    if (emptyDeptRows.length > 0) {
      toast({ title: "Department missing", description: `${emptyDeptRows.length} parameter(s) have no department. Add them to master data first.`, variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const flaggedResults = dedupeTestResults(calculateFlags(testResults));
      setTestResults(flaggedResults);

      // Update extracted data
      await supabase.from("extracted_report_data").update({
        patient_name: patientName,
        age,
        gender,
        umr_id: umrId,
        ref_doctor: refDoctor,
        collection_date: collectionDate,
        report_date: reportDate,
        pathologist_name: pathologistName,
        reg_no: regNo,
        reg_date: regDate,
        sample_collection_date: sampleCollectionDate,
        accession_date: accessionDate,
        authentication_date: authenticationDate,
        print_date: printDate,
        location: locationField,
        test_results: flaggedResults as unknown as any,
        verified: true,
      } as any).eq("report_id", reportId);

      // Upsert patient master
      const { data: existingPatient } = await supabase.from("patient_master").select("id").eq("umr_id", umrId).maybeSingle();
      if (existingPatient) {
        await supabase.from("patient_master").update({ patient_name: patientName, gender, age, last_visit_date: new Date().toISOString() }).eq("umr_id", umrId);
      } else {
        await supabase.from("patient_master").insert({ umr_id: umrId, patient_name: patientName, gender, age });
      }

      // Store analytics parameters in history
      const { data: analyticsParams } = await supabase.from("report_test_parameters").select("id, parameter_name").eq("store_for_analytics", true);
      const analyticsSet = new Set((analyticsParams || []).map((p: any) => p.parameter_name.toLowerCase()));

      const historyEntries = flaggedResults
        .filter((r) => {
          const numVal = parseFloat(r.result_value);
          return !isNaN(numVal) && (analyticsSet.size === 0 || analyticsSet.has(r.parameter_name.toLowerCase()));
        })
        .map((r) => ({
          umr_id: umrId,
          test_name: r.test_name || r.parameter_name,
          parameter_name: r.parameter_name,
          result_value: parseFloat(r.result_value),
          unit: r.unit || "",
          normal_range_low: parseFloat(r.normal_range_low || "") || null,
          normal_range_high: parseFloat(r.normal_range_high || "") || null,
          test_date: reportDate || new Date().toISOString(),
          department: r.department || "",
          profile_name: r.profile_name || "",
          report_id: reportId,
          flag: r.flag || "N",
        }));

      if (historyEntries.length > 0) {
        await supabase.from("test_result_history").insert(historyEntries);
      }

      // Update report status
      await supabase.from("uploaded_reports").update({
        status: "Completed",
        umr_id: umrId,
        patient_name: patientName,
        reg_no: regNo,
        reg_date: regDate,
      } as any).eq("id", reportId);

      // Log corrections feedback loop
      await logCorrections(flaggedResults);

      toast({ title: "Report verified and saved!" });
      navigate(`/reports/view/${reportId}`);
    } catch (err: any) {
      toast({ title: "Error saving", description: err.message, variant: "destructive" });
    }
    setSaving(false);
  };

  if (loading) return <div className="flex items-center justify-center p-12"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  if (!extractedData) return <div className="p-8 text-center text-muted-foreground">No extracted data found for this report.</div>;

  const abnormalCount = testResults.filter((r) => r.flag === "H" || r.flag === "L").length;

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Review Extracted Data</h1>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => navigate("/reports")}>Cancel</Button>
          <Button onClick={handleSaveAndGenerate} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <FileCheck className="h-4 w-4 mr-2" />}
            Verify & Generate Report
          </Button>
        </div>
      </div>

      {abnormalCount > 0 && (
        <div className="flex items-center gap-2 p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
          <AlertTriangle className="h-5 w-5 text-destructive" />
          <span className="font-medium text-destructive">{abnormalCount} abnormal result(s) detected</span>
        </div>
      )}

      {/* Multiple Pathologists Info */}
      {uniqueApprovers.length > 1 && (
        <div className="flex items-center gap-2 p-3 bg-blue-50 border border-blue-200 rounded-lg">
          <span className="font-medium text-blue-800">📋 Multiple approving doctors detected: {uniqueApprovers.join(", ")}</span>
        </div>
      )}

      {/* Patient Information */}
      <Card>
        <CardHeader><CardTitle className="text-lg">Patient Information</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div><Label>Patient Name</Label><Input value={patientName} onChange={(e) => setPatientName(e.target.value.toUpperCase())} /></div>
            <div><Label>UMR ID</Label><Input value={umrId} onChange={(e) => setUmrId(e.target.value)} className={!umrId ? "border-destructive" : ""} /></div>
            <div><Label>Age</Label><Input value={age} onChange={(e) => setAge(e.target.value)} /></div>
            <div>
              <Label>Gender</Label>
              <Select value={gender} onValueChange={setGender}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Male">Male</SelectItem>
                  <SelectItem value="Female">Female</SelectItem>
                  <SelectItem value="Other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>Ref. Doctor</Label><Input value={refDoctor} onChange={(e) => setRefDoctor(e.target.value)} /></div>
            <div><Label>Collection Date</Label><Input value={collectionDate} onChange={(e) => setCollectionDate(e.target.value)} /></div>
            <div><Label>Report Date</Label><Input value={reportDate} onChange={(e) => setReportDate(e.target.value)} /></div>
            <div>
              <Label>Pathologist(s)</Label>
              <Input value={pathologistName} onChange={(e) => setPathologistName(e.target.value)} placeholder="All pathologist names" />
            </div>
            <div><Label>Reg.No</Label><Input value={regNo} onChange={(e) => setRegNo(e.target.value)} /></div>
            <div><Label>Reg.Date</Label><Input value={regDate} onChange={(e) => setRegDate(e.target.value)} /></div>
            <div><Label>Sample Coll. Date</Label><Input value={sampleCollectionDate} onChange={(e) => setSampleCollectionDate(e.target.value)} /></div>
            <div><Label>Accession Date</Label><Input value={accessionDate} onChange={(e) => setAccessionDate(e.target.value)} /></div>
            <div><Label>Authentication Date</Label><Input value={authenticationDate} onChange={(e) => setAuthenticationDate(e.target.value)} /></div>
            <div><Label>Print Date</Label><Input value={printDate} onChange={(e) => setPrintDate(e.target.value)} /></div>
            <div><Label>Location</Label><Input value={locationField} onChange={(e) => setLocationField(e.target.value)} /></div>
          </div>
        </CardContent>
      </Card>

      {/* Test Results */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <CardTitle className="text-lg">Test Results ({testResults.length} parameters)</CardTitle>
              {testResults.some(r => r._merge_status === "new" || r._merge_status === "updated") && (
                <div className="flex items-center gap-2 text-xs">
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-100 text-emerald-700 border border-emerald-200">● New</span>
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-100 text-amber-700 border border-amber-200">● Updated</span>
                </div>
              )}
            </div>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search parameter..." value={paramSearch} onChange={(e) => setParamSearch(e.target.value)} className="pl-8 w-64" />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                   <TableHead className="w-[120px]">Department</TableHead>
                   <TableHead className="w-[120px]">Profile</TableHead>
                   <TableHead>Parameter</TableHead>
                   <TableHead className="w-[100px]">Result</TableHead>
                   <TableHead className="w-[80px]">Unit</TableHead>
                   <TableHead className="w-[120px]">Range</TableHead>
                   <TableHead className="w-[60px]">Flag</TableHead>
                   <TableHead className="w-[140px]">Approved By</TableHead>
                   <TableHead className="w-[40px]">Remark</TableHead>
                   <TableHead className="w-[50px]"></TableHead>
                   <TableHead className="w-[50px]">Master</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {testResults.map((r, i) => {
                  if (paramSearch && !(`${r.parameter_name} ${r.department || ""} ${r.profile_name || ""}`).toLowerCase().includes(paramSearch.toLowerCase())) return null;
                  const mergeClass = r._merge_status === "new"
                    ? "bg-emerald-50 border-l-2 border-l-emerald-500"
                    : r._merge_status === "updated"
                    ? "bg-amber-50 border-l-2 border-l-amber-500"
                    : "";
                  const abnormalClass = r.flag === "H" || r.flag === "L" ? "bg-destructive/5" : "";
                  return (
                  <TableRow key={i} className={`${mergeClass || abnormalClass}`}>
                    <TableCell>
                      <Input value={r.department || ""} readOnly className="h-8 text-xs bg-muted/50" />
                    </TableCell>
                    <TableCell>
                      <Input value={r.profile_name || ""} readOnly className="h-8 text-xs bg-muted/50" />
                    </TableCell>
                    <TableCell>
                      <Input value={r.parameter_name} onChange={(e) => updateTestResult(i, "parameter_name", e.target.value)} className="h-8 text-xs font-medium" />
                    </TableCell>
                    <TableCell>
                      <Input value={r.result_value} onChange={(e) => updateTestResult(i, "result_value", e.target.value)} className={`h-8 text-xs font-bold ${r.flag === "H" || r.flag === "L" ? "text-destructive" : ""}`} />
                    </TableCell>
                    <TableCell>
                      <Input value={r.unit || ""} onChange={(e) => updateTestResult(i, "unit", e.target.value)} className="h-8 text-xs" />
                    </TableCell>
                    <TableCell>
                      <Input value={r.normal_range_text || `${r.normal_range_low || ""}-${r.normal_range_high || ""}`} onChange={(e) => updateTestResult(i, "normal_range_text", e.target.value)} className="h-8 text-xs" />
                    </TableCell>
                    <TableCell>
                      {r.flag === "H" && <Badge variant="destructive" className="text-xs">H</Badge>}
                      {r.flag === "L" && <Badge variant="destructive" className="text-xs">L</Badge>}
                      {r.flag === "N" && <Badge variant="secondary" className="text-xs">N</Badge>}
                    </TableCell>
                    <TableCell>
                      {pathologists.length > 0 ? (
                        <Select
                          value={r.approved_by || ""}
                          onValueChange={(v) => updateTestResult(i, "approved_by" as keyof TestResult, v)}
                        >
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue placeholder="Select doctor" />
                          </SelectTrigger>
                          <SelectContent>
                            {pathologists.map((p) => (
                              <SelectItem key={p.id} value={p.pathologist_name}>{p.pathologist_name}</SelectItem>
                            ))}
                            {/* Show AI-detected names not in master */}
                            {uniqueApprovers
                              .filter(name => !pathologists.some((p: any) => p.pathologist_name === name))
                              .map(name => (
                                <SelectItem key={name} value={name}>{name} (detected)</SelectItem>
                              ))
                            }
                          </SelectContent>
                        </Select>
                      ) : (
                        <Input value={r.approved_by || ""} onChange={(e) => updateTestResult(i, "approved_by" as keyof TestResult, e.target.value)} className="h-8 text-xs" placeholder="Doctor name" />
                      )}
                    </TableCell>
                    <TableCell>
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant={r.remark ? "default" : "ghost"}
                              size="icon"
                              className={`h-7 w-7 ${r.remark ? "bg-amber-500 hover:bg-amber-600 text-white" : ""}`}
                              onClick={() => {
                                setRemarkIndex(i);
                                setRemarkText(r.remark || "Kindly correlate clinically");
                                setRemarkDialogOpen(true);
                              }}
                            >
                              <MessageSquarePlus className="h-3 w-3" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>{r.remark || "Add remark"}</TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => removeTestResult(i)}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </TableCell>
                    <TableCell>
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            {hasMasterMatch(r) ? (
                              <Check className="h-4 w-4 text-green-600" />
                            ) : (
                              <Button
                                variant="outline"
                                size="icon"
                                className="h-7 w-7 border-amber-400 text-amber-600 hover:bg-amber-50"
                                onClick={() => { setAddParamIndex(i); setAddParamDialogOpen(true); }}
                              >
                                <Plus className="h-3 w-3" />
                              </Button>
                            )}
                          </TooltipTrigger>
                          <TooltipContent>
                            {hasMasterMatch(r)
                              ? "Exists in master data"
                              : "Not in master data — click to add"}
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </TableCell>
                  </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* UMR Dialog */}
      <Dialog open={showUmrDialog} onOpenChange={setShowUmrDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>UMR Number Not Detected</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">Please enter the patient's UMR (Unique Medical Record) number to continue.</p>
          <Input value={umrInput} onChange={(e) => setUmrInput(e.target.value.toUpperCase())} placeholder="e.g. UMR0001234" />
          <DialogFooter>
            <Button onClick={() => { setUmrId(umrInput); setShowUmrDialog(false); }} disabled={!umrInput}>Confirm</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Remark Dialog */}
      <Dialog open={remarkDialogOpen} onOpenChange={setRemarkDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Remark</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Remark for: {remarkIndex !== null ? testResults[remarkIndex]?.parameter_name : ""}</Label>
            <Input
              value={remarkText}
              onChange={(e) => setRemarkText(e.target.value)}
              placeholder="Enter remark"
            />
          </div>
          <DialogFooter className="gap-2">
            {remarkIndex !== null && testResults[remarkIndex]?.remark && (
              <Button variant="outline" className="text-destructive" onClick={() => {
                updateTestResult(remarkIndex!, "remark" as keyof TestResult, "");
                setRemarkDialogOpen(false);
                setRemarkIndex(null);
              }}>Remove</Button>
            )}
            <Button onClick={() => {
              if (remarkIndex !== null && remarkText.trim()) {
                updateTestResult(remarkIndex, "remark" as keyof TestResult, remarkText.trim());
              }
              setRemarkDialogOpen(false);
              setRemarkIndex(null);
            }}>Save Remark</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Parameter to Master Dialog */}
      {addParamIndex !== null && (
        <AddParameterToMasterDialog
          open={addParamDialogOpen}
          onOpenChange={(v) => { setAddParamDialogOpen(v); if (!v) setAddParamIndex(null); }}
          parameterName={testResults[addParamIndex]?.parameter_name || ""}
          unit={testResults[addParamIndex]?.unit}
          department={testResults[addParamIndex]?.department}
          profileName={testResults[addParamIndex]?.profile_name}
          testName={testResults[addParamIndex]?.test_name}
          onAdded={(id) => {
            refreshMasterData();
            setAddParamIndex(null);
          }}
        />
      )}
    </div>
  );
};

export default ReviewReport;
