import RefreshButton from "@/components/lims/RefreshButton";
import CbcMicroscopeCamera from "@/components/lims/CbcMicroscopeCamera";
import { DescriptiveCombobox } from "@/components/lims/DescriptiveCombobox";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Search,
  Loader2,
  ChevronDown,
  ChevronUp,
  Camera,
  Upload,
  Trash2,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  Stethoscope,
} from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { getCurrentUserName } from "@/lib/auth";
import { patientDisplayName } from "@/lib/patientDisplayName";
import { formatAgeGender } from "@/lib/ageGender";
import PatientTestPipelineHover from "@/components/lims/PatientTestPipelineHover";
import { checkDifferentialSum } from "@/lib/differentialCount";
import { propagateRegistrationChange } from "@/lib/limsPropagation";
import { useLimsTabActive } from "@/lib/limsTabActive";
import {
  CBC_AI_TARGET_CODES,
  CBC_CRITICAL_ONLY_DRAFT_KEYS,
  CBC_CRITICAL_ONLY_PARAM_CODES,
  CBC_DRAFT_TO_CODE,
  CBC_MAX_IMAGES,
  CBC_MIN_IMAGES_RECOMMENDED,
  CBC_MORPHOLOGY_PARAM_CODES,
  CBC_MP_PARAM_CODE,
  applyCbcDraftToVerification,
  sendCbcToDoctor,
  compressImageForCbcAi,
  isCbcLikeTest,
  normalizeDifferentialDraft,
  scrubCriticalOnlyDraftFields,
  uploadCbcSmearImage,
  type CbcAiDraft,
} from "@/lib/cbcSmear";
import {
  isAbnormalResultFlag,
  isSuspectNegativeResult,
  resolveCbcDisplayFlag,
} from "@/lib/reportFlags";

const REG_SELECT =
  "id, invoice_number, patient_name, title, mobile_number, umr_number, gender, age_text, dob, visit_type, created_at, is_stat";

type RegRow = {
  id: string;
  invoice_number: string | null;
  patient_name: string | null;
  title: string | null;
  mobile_number: string | null;
  umr_number: string | null;
  gender: string | null;
  age_text: string | null;
  dob: string | null;
  visit_type: string | null;
  created_at: string | null;
  is_stat: boolean | null;
};

type ResultRow = {
  id: string;
  registration_id: string;
  test_id: string;
  parameter_id: string;
  result_value: string | null;
  unit: string | null;
  reference_range: string | null;
  flag: string | null;
  status: string;
};

type ParamMeta = {
  parameterId: string;
  paramCode: string;
  parameterName: string;
  unit: string;
  normalRangeText: string;
  displayOrder: number;
};

type ReviewRow = {
  id: string;
  registration_id: string;
  test_id: string;
  image_urls: string[];
  ai_result: CbcAiDraft | null;
  draft_result: CbcAiDraft | null;
  status: string;
  ai_model?: string | null;
  ai_confidence?: string | null;
  ai_notes?: string | null;
  updated_at?: string | null;
};

const DRAFT_DC_FIELDS = [
  { key: "neutrophils_pct" as const, label: "Neutrophils %" },
  { key: "lymphocytes_pct" as const, label: "Lymphocytes %" },
  { key: "monocytes_pct" as const, label: "Monocytes %" },
  { key: "eosinophils_pct" as const, label: "Eosinophils %" },
  { key: "basophils_pct" as const, label: "Basophils %" },
];

const DRAFT_EXTRA_FIELDS = [
  { key: "blasts" as const, label: "Blasts" },
  { key: "promyelocytes" as const, label: "Promyelocytes" },
  { key: "myelocytes" as const, label: "Myelocytes" },
  { key: "metamyelocyte" as const, label: "Metamyelocyte" },
  { key: "band_cells" as const, label: "Band cells" },
  { key: "normoblast" as const, label: "Normoblast" },
];

const CRITICAL_ONLY_CODE_SET = new Set<string>(CBC_CRITICAL_ONLY_PARAM_CODES as readonly string[]);

function asUrlList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((u): u is string => typeof u === "string" && !!u.trim());
}

const CbcTab = () => {
  const qc = useQueryClient();
  const tabActive = useLimsTabActive();
  const fileRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [selectedTestId, setSelectedTestId] = useState<string | null>(null);
  const [draft, setDraft] = useState<CbcAiDraft>({});
  const [cameraOpen, setCameraOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [showCriticalFields, setShowCriticalFields] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 350);
    return () => clearTimeout(t);
  }, [search]);

  const { data: candidateIds = [], isLoading: loadingIds, isFetching: fetchingIds, isError: idsError, refetch: refetchIds } = useQuery({
    queryKey: ["cbc_candidate_ids"],
    enabled: tabActive,
    queryFn: async (): Promise<string[]> => {
      const { data, error } = await supabase.rpc("lims_cbc_verification_candidate_ids");
      if (error) throw error;
      return (data as string[]) || [];
    },
  });

  const { data: registrations = [], isLoading: loadingRegs } = useQuery({
    queryKey: ["cbc_regs", candidateIds.join(",")],
    enabled: tabActive && candidateIds.length > 0,
    queryFn: async (): Promise<RegRow[]> => {
      const { data, error } = await supabase
        .from("patient_registrations")
        .select(REG_SELECT)
        .in("id", candidateIds)
        .order("created_at", { ascending: false });
      if (error) throw error;
      // Newest invoice first (same as Results / Verification / Doctor Approval queues)
      return ((data as RegRow[]) || []).slice().sort((a, b) =>
        String(b.invoice_number || "").localeCompare(String(a.invoice_number || ""), undefined, {
          numeric: true,
        }),
      );
    },
  });

  const filteredRegs = useMemo(() => {
    const q = debouncedSearch.toLowerCase();
    if (!q) return registrations;
    return registrations.filter((r) => {
      const hay = [
        r.invoice_number,
        r.patient_name,
        r.umr_number,
        r.mobile_number,
      ]
        .map((x) => String(x || "").toLowerCase())
        .join(" ");
      return hay.includes(q);
    });
  }, [registrations, debouncedSearch]);

  const detailQuery = useQuery({
    queryKey: ["cbc_results", expandedId],
    enabled: tabActive && !!expandedId,
    queryFn: async () => {
      const regId = expandedId!;
      const { data: results, error: resErr } = await supabase
        .from("patient_results")
        .select("id, registration_id, test_id, parameter_id, result_value, unit, reference_range, flag, status")
        .eq("registration_id", regId)
        .in("status", ["entered", "results_entered"]);
      if (resErr) throw resErr;
      const allResults = (results as ResultRow[]) || [];
      const testIds = [...new Set(allResults.map((r) => r.test_id).filter(Boolean))];
      if (testIds.length === 0) {
        return {
          cbcTests: [] as Array<{ id: string; test_name: string; test_code: string | null }>,
          results: [] as ResultRow[],
          paramById: {} as Record<string, ParamMeta>,
          morphOptions: { wbc: [] as string[], rbc: [] as string[], platelet: [] as string[], mp: [] as string[] },
        };
      }

      const { data: tests, error: testErr } = await supabase
        .from("tests")
        .select("id, test_name, test_code")
        .in("id", testIds);
      if (testErr) throw testErr;
      const cbcTests = ((tests as any[]) || []).filter((t) =>
        isCbcLikeTest(t.test_name, t.test_code),
      );
      const cbcTestIds = new Set(cbcTests.map((t) => t.id));
      const cbcResults = allResults.filter((r) => cbcTestIds.has(r.test_id));
      const paramIds = [...new Set(cbcResults.map((r) => r.parameter_id).filter(Boolean))];

      let paramById: Record<string, ParamMeta> = {};
      if (paramIds.length > 0) {
        const { data: params, error: pErr } = await supabase
          .from("report_test_parameters")
          .select("id, param_code, parameter_name, unit, normal_range_text")
          .in("id", paramIds);
        if (pErr) throw pErr;
        const orderByParam: Record<string, number> = {};
        if (cbcTests.length > 0) {
          const { data: tpRows } = await supabase
            .from("test_parameters")
            .select("parameter_id, display_order, test_id")
            .in("test_id", cbcTests.map((x) => x.id))
            .in("parameter_id", paramIds);
          for (const row of (tpRows as any[]) || []) {
            const pid = String(row.parameter_id || "");
            const ord = Number(row.display_order ?? 9999);
            if (!pid) continue;
            if (orderByParam[pid] == null || ord < orderByParam[pid]) orderByParam[pid] = ord;
          }
        }
        for (const p of (params as any[]) || []) {
          paramById[p.id] = {
            parameterId: p.id,
            paramCode: String(p.param_code || ""),
            parameterName: String(p.parameter_name || p.param_code || ""),
            unit: String(p.unit || ""),
            normalRangeText: String(p.normal_range_text || ""),
            displayOrder: orderByParam[p.id] ?? 9999,
          };
        }
      }

      const morphCodes = [...CBC_MORPHOLOGY_PARAM_CODES, CBC_MP_PARAM_CODE];
      const morphParamIds = Object.values(paramById)
        .filter((p) => morphCodes.includes(p.paramCode as any))
        .map((p) => p.parameterId);

      const morphOptions = { wbc: [] as string[], rbc: [] as string[], platelet: [] as string[], mp: [] as string[] };
      if (morphParamIds.length > 0) {
        const { data: ranges, error: rErr } = await supabase
          .from("parameter_normal_ranges")
          .select("parameter_id, descriptive_options")
          .in("parameter_id", morphParamIds);
        if (rErr) throw rErr;
        const byParam: Record<string, string[]> = {};
        for (const row of (ranges as any[]) || []) {
          const opts = Array.isArray(row.descriptive_options)
            ? row.descriptive_options.filter((o: unknown) => typeof o === "string" && String(o).trim())
            : [];
          if (!opts.length) continue;
          const prev = byParam[row.parameter_id] || [];
          byParam[row.parameter_id] = [...new Set([...prev, ...opts])];
        }
        const codeToOpts = (code: string) => {
          const meta = Object.values(paramById).find((p) => p.paramCode === code);
          return meta ? byParam[meta.parameterId] || [] : [];
        };
        morphOptions.wbc = codeToOpts("PRM0157");
        morphOptions.rbc = codeToOpts("PRM0115");
        morphOptions.platelet = codeToOpts("PRM0102");
        morphOptions.mp = codeToOpts(CBC_MP_PARAM_CODE);
      }

      return { cbcTests, results: cbcResults, paramById, morphOptions };
    },
  });

  const cbcTests = detailQuery.data?.cbcTests || [];
  const results = detailQuery.data?.results || [];
  const paramById = detailQuery.data?.paramById || {};
  const morphOptions = detailQuery.data?.morphOptions || {
    wbc: [],
    rbc: [],
    platelet: [],
    mp: [],
  };

  useEffect(() => {
    if (!expandedId || cbcTests.length === 0) {
      setSelectedTestId(null);
      return;
    }
    setSelectedTestId((prev) =>
      prev && cbcTests.some((t) => t.id === prev) ? prev : cbcTests[0].id,
    );
  }, [expandedId, cbcTests]);

  const reviewQuery = useQuery({
    queryKey: ["cbc_review", expandedId, selectedTestId],
    enabled: tabActive && !!expandedId && !!selectedTestId,
    queryFn: async (): Promise<ReviewRow> => {
      const regId = expandedId!;
      const testId = selectedTestId!;
      const { data: existing, error } = await supabase
        .from("cbc_smear_reviews")
        .select("*")
        .eq("registration_id", regId)
        .eq("test_id", testId)
        .maybeSingle();
      if (error) throw error;
      if (existing) {
        return {
          ...(existing as any),
          image_urls: asUrlList((existing as any).image_urls),
        };
      }
      const { data: created, error: insErr } = await supabase
        .from("cbc_smear_reviews")
        .insert({ registration_id: regId, test_id: testId } as any)
        .select("*")
        .single();
      if (insErr) throw insErr;
      return {
        ...(created as any),
        image_urls: asUrlList((created as any).image_urls),
      };
    },
  });


  const review = reviewQuery.data;

  const expandedReg = useMemo(
    () => (expandedId ? registrations.find((r) => r.id === expandedId) || null : null),
    [expandedId, registrations],
  );

  const { data: historicalResults = [] } = useQuery({
    queryKey: ["cbc_historical_results", expandedReg?.umr_number, expandedId],
    enabled: !!expandedReg?.umr_number && !!expandedId,
    queryFn: async () => {
      const { data: sameUmrRegs } = await supabase
        .from("patient_registrations")
        .select("id")
        .eq("umr_number", expandedReg!.umr_number!)
        .neq("id", expandedId!);
      const regIds = (sameUmrRegs || []).map((r: any) => r.id);
      if (regIds.length === 0) return [] as any[];
      const { data, error } = await supabase
        .from("patient_results")
        .select("parameter_id, result_value, reference_range, created_at")
        .in("registration_id", regIds)
        .not("result_value", "is", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  const historyMap = useMemo(() => {
    const map: Record<string, { resultValue: string; referenceRange: string }[]> = {};
    for (const r of historicalResults as any[]) {
      if (!r.parameter_id) continue;
      if (!map[r.parameter_id]) map[r.parameter_id] = [];
      if (map[r.parameter_id].length < 2) {
        map[r.parameter_id].push({
          resultValue: r.result_value || "",
          referenceRange: r.reference_range || "",
        });
      }
    }
    return map;
  }, [historicalResults]);


  useEffect(() => {
    if (!review) {
      setDraft({});
      return;
    }
    const src = (review.draft_result || review.ai_result || {}) as CbcAiDraft;
    setDraft(scrubCriticalOnlyDraftFields({ ...src }));
    const hasCritical = CBC_CRITICAL_ONLY_DRAFT_KEYS.some(
      (k) => String((src as CbcAiDraft)[k] ?? "").trim(),
    );
    setShowCriticalFields(hasCritical);
  }, [review?.id, review?.updated_at, review?.draft_result, review?.ai_result]);

  const testResults = useMemo(() => {
    const rows = results.filter((r) => r.test_id === selectedTestId);
    return [...rows].sort((a, b) => {
      const oa = paramById[a.parameter_id]?.displayOrder ?? 9999;
      const ob = paramById[b.parameter_id]?.displayOrder ?? 9999;
      if (oa !== ob) return oa - ob;
      const na = paramById[a.parameter_id]?.parameterName || "";
      const nb = paramById[b.parameter_id]?.parameterName || "";
      return na.localeCompare(nb);
    });
  }, [results, selectedTestId, paramById]);

  const paramByCode = useMemo(() => {
    const map: Record<string, ParamMeta> = {};
    for (const r of testResults) {
      const meta = paramById[r.parameter_id];
      if (meta?.paramCode) map[meta.paramCode] = meta;
    }
    return map;
  }, [testResults, paramById]);

  const analyzerContext = useMemo(() => {
    const ctx: Record<string, string> = {};
    for (const r of testResults) {
      const meta = paramById[r.parameter_id];
      if (!meta) continue;
      const val = String(r.result_value ?? "").trim();
      if (!val) continue;
      ctx[meta.parameterName || meta.paramCode] = val;
    }
    return ctx;
  }, [testResults, paramById]);

  const missingFields = useMemo(() => {
    const missing: string[] = [];
    for (const code of CBC_AI_TARGET_CODES) {
      // Do not push AI to invent critical-only immature cells on routine cases
      if (CRITICAL_ONLY_CODE_SET.has(code)) continue;
      const meta = paramByCode[code];
      if (!meta) continue;
      const row = testResults.find((r) => r.parameter_id === meta.parameterId);
      if (!row || !String(row.result_value ?? "").trim()) missing.push(code);
    }
    return missing;
  }, [paramByCode, testResults]);


  /** DC values already present in verification ? lock these after AI returns */
  const machineDcLocked = useMemo(() => {
    const out: Partial<CbcAiDraft> = {};
    const map: Array<[keyof CbcAiDraft, string]> = [
      ["neutrophils_pct", "PRM0090"],
      ["lymphocytes_pct", "PRM0080"],
      ["monocytes_pct", "PRM0086"],
      ["eosinophils_pct", "PRM0048"],
      ["basophils_pct", "PRM0019"],
    ];
    for (const [field, code] of map) {
      const meta = paramByCode[code];
      if (!meta) continue;
      const row = testResults.find((r) => r.parameter_id === meta.parameterId);
      const val = String(row?.result_value ?? "").trim();
      if (val) out[field] = val;
    }
    return out;
  }, [paramByCode, testResults]);

  const imageUrls = review?.image_urls || [];
  const remainingSlots = Math.max(0, CBC_MAX_IMAGES - imageUrls.length);

  const diffCheck = useMemo(() => {
    return checkDifferentialSum(
      DRAFT_DC_FIELDS.map((f) => ({
        paramCode: CBC_DRAFT_TO_CODE[f.key],
        value: draft[f.key],
      })),
    );
  }, [draft]);

  const persistImageUrls = async (urls: string[]) => {
    if (!review) return;
    const { error } = await supabase
      .from("cbc_smear_reviews")
      .update({ image_urls: urls, updated_at: new Date().toISOString() } as any)
      .eq("id", review.id);
    if (error) throw error;
    await qc.invalidateQueries({ queryKey: ["cbc_review", expandedId, selectedTestId] });
  };

  const addImageBlob = async (blob: Blob) => {
    if (!expandedId || !selectedTestId || !review) return;
    if (remainingSlots <= 0) {
      toast.error(`Maximum ${CBC_MAX_IMAGES} images`);
      return;
    }
    setBusy("upload");
    try {
      const compressed = await compressImageForCbcAi(blob);
      const url = await uploadCbcSmearImage(
        expandedId,
        selectedTestId,
        compressed,
        imageUrls.length,
      );
      await persistImageUrls([...imageUrls, url]);
      toast.success("Image added");
    } catch (e: any) {
      toast.error(e?.message || "Upload failed ? check WhatsApp Cloudinary account in LIMS Settings");
    } finally {
      setBusy(null);
    }
  };

  const handleGalleryFiles = async (files: FileList | null) => {
    if (!files?.length || !expandedId || !selectedTestId || !review) return;
    const list = Array.from(files)
      .filter((f) => f.type.startsWith("image/"))
      .slice(0, remainingSlots);
    if (list.length === 0) return;
    setBusy("upload");
    try {
      let urls = [...imageUrls];
      for (let i = 0; i < list.length; i++) {
        const compressed = await compressImageForCbcAi(list[i]);
        const url = await uploadCbcSmearImage(
          expandedId,
          selectedTestId,
          compressed,
          urls.length,
        );
        urls = [...urls, url];
      }
      await persistImageUrls(urls);
      toast.success(`${list.length} image${list.length === 1 ? "" : "s"} added`);
    } catch (e: any) {
      toast.error(e?.message || "Upload failed ? check WhatsApp Cloudinary account in LIMS Settings");
    } finally {
      setBusy(null);
    }
  };

  const removeImage = async (idx: number) => {
    if (!review) return;
    setBusy("remove");
    try {
      const next = imageUrls.filter((_, i) => i !== idx);
      await persistImageUrls(next);
    } catch (e: any) {
      toast.error(e?.message || "Remove failed");
    } finally {
      setBusy(null);
    }
  };

  const handleInterpret = async () => {
    if (!review || !expandedId || !selectedTestId) return;
    if (imageUrls.length === 0) {
      toast.error("Add at least one smear image");
      return;
    }
    setBusy("interpret");
    try {
      const { data, error } = await supabase.functions.invoke("interpret-cbc-smear", {
        body: {
          imageUrls,
          analyzerContext,
          morphologyOptions: morphOptions,
          missingFields,
        },
      });
      // Supabase often wraps non-2xx as FunctionsHttpError with a generic "Failed to send..." message.
      // Prefer the JSON body error when present.
      if (data?.error) throw new Error(String(data.error));
      if (error) {
        const ctx = (error as any)?.context;
        let detail = "";
        try {
          if (ctx && typeof ctx.json === "function") {
            const body = await ctx.json();
            detail = body?.error || "";
          } else if (ctx && typeof ctx.text === "function") {
            const text = await ctx.text();
            try {
              detail = JSON.parse(text)?.error || text;
            } catch {
              detail = text;
            }
          }
        } catch {
          /* ignore parse */
        }
        throw new Error(detail || error.message || "Edge function failed");
      }

      const { model_used, ...aiFields } = data as CbcAiDraft & { model_used?: string };
      const merged: CbcAiDraft = {
        ...aiFields,
        ...machineDcLocked, // machine Neutrophils/Lymphocytes (etc.) win over AI
      };
      // If basophils empty and machine didn't send, default 0 (lab habit) then normalize to 100
      if (!String(merged.basophils_pct ?? "").trim() && !machineDcLocked.basophils_pct) {
        merged.basophils_pct = "0";
      }
      const keep = Object.keys(machineDcLocked) as Array<keyof CbcAiDraft>;
      const normalized = scrubCriticalOnlyDraftFields(normalizeDifferentialDraft(merged, keep));
      const { error: updErr } = await supabase
        .from("cbc_smear_reviews")
        .update({
          ai_result: normalized,
          draft_result: normalized,
          status: "interpreted",
          ai_model: model_used || null,
          ai_confidence: normalized.confidence || null,
          ai_notes: normalized.notes || null,
          interpreted_at: new Date().toISOString(),
          interpreted_by: getCurrentUserName(),
          updated_at: new Date().toISOString(),
        } as any)
        .eq("id", review.id);
      if (updErr) throw updErr;
      setDraft(normalized);
      await qc.invalidateQueries({ queryKey: ["cbc_review", expandedId, selectedTestId] });
      toast.success("AI draft ready — review before approve");
    } catch (e: any) {
      toast.error(e?.message || "Interpretation failed");
    } finally {
      setBusy(null);
    }
  };

  const saveDraftLocal = useCallback(
    async (next: CbcAiDraft) => {
      setDraft(next);
      if (!review) return;
      await supabase
        .from("cbc_smear_reviews")
        .update({
          draft_result: next,
          updated_at: new Date().toISOString(),
        } as any)
        .eq("id", review.id);
    },
    [review],
  );

  const handleApprove = async () => {
    if (!review || !expandedId || !selectedTestId) return;
    if (!diffCheck.isOk && diffCheck.hasDifferential) {
      toast.error(`Differential sum is ${diffCheck.sum}% (must be 100%)`);
      return;
    }
    setBusy("approve");
    try {
      const keep = Object.keys(machineDcLocked) as Array<keyof CbcAiDraft>;
      const finalDraft = scrubCriticalOnlyDraftFields(normalizeDifferentialDraft(draft, keep));
      await applyCbcDraftToVerification({
        registrationId: expandedId,
        testId: selectedTestId,
        draft: finalDraft,
        paramByCode,
      });
      const { error } = await supabase
        .from("cbc_smear_reviews")
        .update({
          draft_result: finalDraft,
          status: "approved",
          approved_at: new Date().toISOString(),
          approved_by: getCurrentUserName(),
          updated_at: new Date().toISOString(),
        } as any)
        .eq("id", review.id);
      if (error) throw error;
      await propagateRegistrationChange(qc, expandedId, ["verification", "cbc"]);
      toast.success("CBC smear approved ? sent to Result Verification");
      await qc.invalidateQueries({ queryKey: ["cbc_candidate_ids"] });
      await qc.invalidateQueries({ queryKey: ["cbc_review", expandedId, selectedTestId] });
    } catch (e: any) {
      toast.error(e?.message || "Approve failed");
    } finally {
      setBusy(null);
    }
  };


  const handleSendToDoctor = async () => {
    if (!review || !expandedId || !selectedTestId) return;
    // Images optional — doctor can review on Dr. CBC even without smear photos.
    // DC sum = 100 is NOT required here — doctor enters/corrects differential on Dr. CBC.
    // Approve → Result Verification still enforces 100%.
    setBusy("send_doctor");
    try {
      const finalDraft = scrubCriticalOnlyDraftFields(draft);
      await sendCbcToDoctor({
        reviewId: review.id,
        registrationId: expandedId,
        testId: selectedTestId,
        draft: finalDraft,
        paramByCode,
        by: getCurrentUserName() || "staff",
        skipDifferentialNormalize: true,
      });
      await propagateRegistrationChange(qc, expandedId, ["cbc", "dr_cbc"]);
      toast.success("Sent to Dr. CBC");
      setExpandedId(null);
      await qc.invalidateQueries({ queryKey: ["cbc_candidate_ids"] });
      await qc.invalidateQueries({ queryKey: ["cbc_regs"] });
      await qc.invalidateQueries({ queryKey: ["cbc_dr_candidate_ids"] });
    } catch (e: any) {
      toast.error(e?.message || "Send to doctor failed");
    } finally {
      setBusy(null);
    }
  };

  const isLoading = loadingIds || loadingRegs;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-8"
            placeholder="Search invoice / name / UMR…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <RefreshButton queryKeys={["cbc_candidate_ids", "cbc_regs", "cbc_review", "cbc_results", "cbc_historical_results"]} />
        <Badge variant="secondary">{filteredRegs.length} patients</Badge>
        {(fetchingIds || loadingRegs) && !isLoading && (
          <span className="text-xs text-muted-foreground">Updating…</span>
        )}
      </div>

      <p className="text-xs text-muted-foreground flex items-start gap-1.5">
        <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
        AI assistive draft only — technologist must review morphology, differential, and MP before
        approving or sending to Dr. CBC. Never auto-send WhatsApp from this tab.
      </p>

      {idsError ? (
        <Card>
          <CardContent className="py-10 text-center text-sm space-y-3">
            <p className="text-muted-foreground">Could not load CBC queue.</p>
            <Button size="sm" variant="outline" onClick={() => void refetchIds()}>
              Retry
            </Button>
          </CardContent>
        </Card>
      ) : isLoading ? (
        <div className="flex justify-center py-12 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : filteredRegs.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No CBC candidates with entered results.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {filteredRegs.map((reg) => {
            const open = expandedId === reg.id;
            return (
              <Card key={reg.id} className="overflow-hidden">
                <button
                  type="button"
                  className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-muted/40"
                  onClick={() => setExpandedId(open ? null : reg.id)}
                >
                  {open ? (
                    <ChevronUp className="h-4 w-4 shrink-0" />
                  ) : (
                    <ChevronDown className="h-4 w-4 shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium font-mono">{reg.invoice_number}</span>
                      <span
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => e.stopPropagation()}
                      >
                        <PatientTestPipelineHover
                          registrationId={reg.id}
                          invoiceNumber={reg.invoice_number || ""}
                        />
                      </span>
                      {reg.is_stat && <Badge variant="destructive" className="text-[10px]">STAT</Badge>}
                      <span className="text-sm text-muted-foreground truncate">
                        {patientDisplayName(reg)}
                      </span>
                      <Badge variant="outline" className="text-[10px] font-mono">
                        {formatAgeGender(reg.dob, reg.gender, reg.age_text)}
                      </Badge>
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {reg.mobile_number || "—"}
                      {reg.umr_number ? ` · UMR ${reg.umr_number}` : ""}
                    </div>
                  </div>
                </button>

                {open && (
                  <CardContent className="border-t pt-4 space-y-4">
                    {detailQuery.isLoading || reviewQuery.isLoading ? (
                      <div className="flex justify-center py-6">
                        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                      </div>
                    ) : cbcTests.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No CBC-like tests found.</p>
                    ) : (
                      <>
                        {cbcTests.length > 1 && (
                          <div className="flex flex-wrap gap-2">
                            {cbcTests.map((t) => (
                              <Button
                                key={t.id}
                                type="button"
                                size="sm"
                                variant={selectedTestId === t.id ? "default" : "outline"}
                                onClick={() => setSelectedTestId(t.id)}
                              >
                                {t.test_name}
                              </Button>
                            ))}
                          </div>
                        )}

                        <div>
                          <h4 className="text-sm font-medium mb-2">CBC parameters</h4>
                          <div className="rounded-md border overflow-x-auto">
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead className="text-xs">Code</TableHead>
                                  <TableHead className="text-xs">Parameter</TableHead>
                                  <TableHead className="text-xs">Prev 1</TableHead>
                                  <TableHead className="text-xs">Prev 2</TableHead>
                                  <TableHead className="text-xs">Result</TableHead>
                                  <TableHead className="text-xs">Unit</TableHead>
                                  <TableHead className="text-xs">Ref. Range</TableHead>
                                  <TableHead className="text-xs">Flag</TableHead>
                                  <TableHead className="text-xs">Status</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {testResults.map((r) => {
                                  const meta = paramById[r.parameter_id];
                                  const hist = historyMap[r.parameter_id] || [];
                                  const value = r.result_value || "";
                                  const flag = resolveCbcDisplayFlag({
                                    value,
                                    savedValue: r.result_value,
                                    savedFlag: r.flag,
                                    normalRangeText: r.reference_range || meta?.normalRangeText,
                                    unit: r.unit || meta?.unit,
                                  });
                                  const isNegative = isSuspectNegativeResult(value);
                                  const isAbnormal = isAbnormalResultFlag(flag);
                                  const rowBg = isNegative
                                    ? "bg-red-50"
                                    : isAbnormal
                                      ? "bg-destructive/5"
                                      : "";
                                  const resultCls = isNegative
                                    ? "text-red-700 font-semibold"
                                    : isAbnormal
                                      ? "text-destructive font-bold"
                                      : "font-medium";
                                  return (
                                    <TableRow key={r.id} className={rowBg}>
                                      <TableCell className="font-mono text-[11px] whitespace-nowrap">
                                        {meta?.paramCode || "—"}
                                      </TableCell>
                                      <TableCell className="text-xs">{meta?.parameterName || "—"}</TableCell>
                                      <TableCell className="text-xs text-muted-foreground">
                                        {hist[0]?.resultValue || "—"}
                                      </TableCell>
                                      <TableCell className="text-xs text-muted-foreground">
                                        {hist[1]?.resultValue || "—"}
                                      </TableCell>
                                      <TableCell className={`text-xs ${resultCls}`}>
                                        {value || "—"}
                                      </TableCell>
                                      <TableCell className="text-xs">{r.unit || meta?.unit || "—"}</TableCell>
                                      <TableCell className="text-xs whitespace-pre-line">
                                        {r.reference_range || meta?.normalRangeText || "—"}
                                      </TableCell>
                                      <TableCell className="text-xs text-center">
                                        {flag === "H" && <Badge variant="destructive" className="text-xs">HIGH</Badge>}
                                        {flag === "L" && <Badge variant="destructive" className="text-xs">LOW</Badge>}
                                        {flag === "N" && <Badge variant="secondary" className="text-xs text-green-700">Normal</Badge>}
                                        {flag === "X" && <Badge variant="destructive" className="text-xs">Abn</Badge>}
                                        {flag === "A" && <Badge variant="destructive" className="text-xs">Abn</Badge>}
                                        {!flag && value && <Badge variant="outline" className="text-xs">—</Badge>}
                                        {!flag && !value && "—"}
                                      </TableCell>
                                      <TableCell className="text-xs capitalize">{r.status || "—"}</TableCell>
                                    </TableRow>
                                  );
                                })}
                                {testResults.length === 0 && (
                                  <TableRow>
                                    <TableCell colSpan={9} className="text-muted-foreground">
                                      No entered CBC results
                                    </TableCell>
                                  </TableRow>
                                )}
                              </TableBody>
                            </Table>
                          </div>
                        </div>

                        <div className="space-y-2">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div>
                              <h4 className="text-sm font-medium">
                                Smear images ({imageUrls.length}/{CBC_MAX_IMAGES})
                              </h4>
                              <p className="text-[10px] text-muted-foreground">
                                Stored on WhatsApp Cloudinary (not Supabase storage / not report-PDF Cloudinary).
                              </p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                disabled={remainingSlots <= 0 || busy === "upload"}
                                onClick={() => setCameraOpen(true)}
                              >
                                <Camera className="h-4 w-4 mr-1" />
                                Open Camera
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                disabled={remainingSlots <= 0 || busy === "upload"}
                                onClick={() => fileRef.current?.click()}
                              >
                                <Upload className="h-4 w-4 mr-1" />
                                Upload from gallery
                              </Button>
                              <input
                                ref={fileRef}
                                type="file"
                                accept="image/*"
                                capture="environment"
                                multiple
                                className="hidden"
                                onChange={(e) => {
                                  void handleGalleryFiles(e.target.files);
                                  e.target.value = "";
                                }}
                              />
                            </div>
                          </div>
                          {imageUrls.length < CBC_MIN_IMAGES_RECOMMENDED && (
                            <p className="text-xs text-amber-700">
                              Recommend ≥{CBC_MIN_IMAGES_RECOMMENDED} images for better AI accuracy
                              ({remainingSlots} slots left).
                            </p>
                          )}
                          {imageUrls.length > 0 ? (
                            <div className="flex flex-wrap gap-2">
                              {imageUrls.map((url, idx) => (
                                <div
                                  key={`${url}-${idx}`}
                                  className="relative w-20 h-20 rounded border overflow-hidden group"
                                >
                                  <img
                                    src={url}
                                    alt={`Smear ${idx + 1}`}
                                    className="w-full h-full object-cover"
                                  />
                                  <button
                                    type="button"
                                    className="absolute top-0.5 right-0.5 p-0.5 rounded bg-black/60 text-white opacity-80 group-hover:opacity-100"
                                    onClick={() => void removeImage(idx)}
                                    disabled={busy === "remove"}
                                  >
                                    <Trash2 className="h-3 w-3" />
                                  </button>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="text-xs text-muted-foreground">No images yet.</p>
                          )}
                        </div>

                        <div className="flex flex-wrap gap-2">
                          <Button
                            type="button"
                            onClick={() => void handleInterpret()}
                            disabled={busy === "interpret" || imageUrls.length === 0}
                          >
                            {busy === "interpret" ? (
                              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                            ) : (
                              <Sparkles className="h-4 w-4 mr-1" />
                            )}
                            Interpret with AI
                          </Button>
                          <Button
                            type="button"
                            variant="secondary"
                            onClick={() => void handleSendToDoctor()}
                            disabled={
                              busy === "send_doctor" ||
                              review?.status === "sent_to_doctor" ||
                              review?.status === "doctor_saved"
                            }
                            title="Send to Dr. CBC"
                          >
                            {busy === "send_doctor" ? (
                              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                            ) : (
                              <Stethoscope className="h-4 w-4 mr-1" />
                            )}
                            Send to Doctor
                          </Button>
                          {review?.status && (
                            <Badge variant="secondary">Review: {review.status}</Badge>
                          )}
                          {review?.ai_confidence && (
                            <Badge variant="outline">Confidence: {review.ai_confidence}</Badge>
                          )}
                          {review?.ai_model && (
                            <Badge variant="outline">{review.ai_model}</Badge>
                          )}
                        </div>

                        {(review?.status === "interpreted" ||
                          review?.status === "approved" ||
                          draft.notes ||
                          DRAFT_DC_FIELDS.some((f) => draft[f.key])) && (
                          <Card>
                            <CardHeader className="py-3">
                              <CardTitle className="text-sm">Editable AI draft</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-3">
                              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                                {DRAFT_DC_FIELDS.map((f) => (
                                  <label key={f.key} className="text-xs space-y-1">
                                    <span className="text-muted-foreground">{f.label}</span>
                                    <Input
                                      value={draft[f.key] ?? ""}
                                      onChange={(e) =>
                                        void saveDraftLocal({ ...draft, [f.key]: e.target.value })
                                      }
                                    />
                                  </label>
                                ))}
                              </div>
                              <div className="text-xs">
                                Differential sum:{" "}
                                <span
                                  className={
                                    diffCheck.isOk ? "text-green-700 font-medium" : "text-red-600 font-medium"
                                  }
                                >
                                  {diffCheck.sum}%
                                </span>
                                {!diffCheck.isOk && diffCheck.hasDifferential && (
                                  <span className="text-red-600">
                                    {" "}
                                    (must equal 100% to Approve; Send to Doctor is allowed — doctor enters DC)
                                  </span>
                                )}
                              </div>

                              <div className="grid gap-2 sm:grid-cols-2">
                                <label className="text-xs space-y-1">
                                  <span className="text-muted-foreground">WBC morphology</span>
                                  <DescriptiveCombobox
                                    value={draft.wbc_morphology ?? ""}
                                    options={morphOptions.wbc}
                                    onChange={(v) => void saveDraftLocal({ ...draft, wbc_morphology: v })}
                                  />
                                </label>
                                <label className="text-xs space-y-1">
                                  <span className="text-muted-foreground">RBC morphology</span>
                                  <DescriptiveCombobox
                                    value={draft.rbc_morphology ?? ""}
                                    options={morphOptions.rbc}
                                    onChange={(v) => void saveDraftLocal({ ...draft, rbc_morphology: v })}
                                  />
                                </label>
                                <label className="text-xs space-y-1">
                                  <span className="text-muted-foreground">Platelet morphology</span>
                                  <DescriptiveCombobox
                                    value={draft.platelet_morphology ?? ""}
                                    options={morphOptions.platelet}
                                    onChange={(v) =>
                                      void saveDraftLocal({ ...draft, platelet_morphology: v })
                                    }
                                  />
                                </label>
                                <label className="text-xs space-y-1">
                                  <span className="text-muted-foreground">Malarial parasites</span>
                                  <DescriptiveCombobox
                                    value={draft.malarial_parasites ?? ""}
                                    options={
                                      morphOptions.mp.length
                                        ? morphOptions.mp
                                        : ["Not detected", "Detected"]
                                    }
                                    onChange={(v) =>
                                      void saveDraftLocal({ ...draft, malarial_parasites: v })
                                    }
                                  />
                                </label>
                              </div>

                              <div className="rounded border border-dashed p-2 space-y-2">
                                <div className="flex items-center justify-between gap-2">
                                  <div className="text-[11px] text-muted-foreground leading-snug">
                                    Critical only (Blasts, Promyelocytes, Myelocytes, Metamyelocyte, Band cells, Normoblast) ? leave blank unless the case is critical.
                                  </div>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="ghost"
                                    className="h-7 shrink-0 text-xs"
                                    onClick={() => setShowCriticalFields((v) => !v)}
                                  >
                                    {showCriticalFields ||
                                    CBC_CRITICAL_ONLY_DRAFT_KEYS.some((k) =>
                                      String(draft[k] ?? "").trim(),
                                    )
                                      ? "Hide"
                                      : "Show"}
                                  </Button>
                                </div>
                                {(showCriticalFields ||
                                  CBC_CRITICAL_ONLY_DRAFT_KEYS.some((k) =>
                                    String(draft[k] ?? "").trim(),
                                  )) && (
                                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                                    {DRAFT_EXTRA_FIELDS.map((f) => (
                                      <label key={f.key} className="text-xs space-y-1">
                                        <span className="text-muted-foreground">{f.label}</span>
                                        <Input
                                          value={draft[f.key] ?? ""}
                                          placeholder="Blank if not critical"
                                          onChange={(e) =>
                                            void saveDraftLocal({
                                              ...draft,
                                              [f.key]: e.target.value,
                                            })
                                          }
                                        />
                                      </label>
                                    ))}
                                  </div>
                                )}
                              </div>

                              {draft.notes && (
                                <p className="text-xs text-muted-foreground border rounded p-2 bg-muted/30">
                                  {draft.notes}
                                </p>
                              )}

                              <Button
                                type="button"
                                onClick={() => void handleApprove()}
                                disabled={
                                  busy === "approve" ||
                                  review?.status === "approved" ||
                                  (!diffCheck.isOk && diffCheck.hasDifferential)
                                }
                              >
                                {busy === "approve" ? (
                                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                                ) : (
                                  <CheckCircle2 className="h-4 w-4 mr-1" />
                                )}
                                Approve &amp; send to Result Verification
                              </Button>
                            </CardContent>
                          </Card>
                        )}
                      </>
                    )}
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <CbcMicroscopeCamera
        open={cameraOpen}
        onOpenChange={setCameraOpen}
        remainingSlots={remainingSlots}
        onCapture={(blob) => {
          void addImageBlob(blob);
        }}
      />
    </div>
  );
};

export default CbcTab;
