import RefreshButton from "@/components/lims/RefreshButton";
import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { recalculateRegistrationStatus } from "@/lib/limsStatus";
import { formatAgeGender } from "@/lib/ageGender";
import { patientDisplayName } from "@/lib/patientDisplayName";
import { isSuspectNegativeResult, calculateResultFlag } from "@/lib/reportFlags";
import { getCurrentUser, getCurrentUserName } from "@/lib/auth";
import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { useLimsPipelineRealtime } from "@/hooks/useLimsPipelineRealtime";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Search, User, Monitor, Calculator, Wifi, ChevronDown, ChevronUp, Loader2, FlaskConical, CheckCircle2, SendHorizonal, Eye, Undo2, ClipboardCheck, StickyNote, Trash2, AlertTriangle } from "lucide-react";
import { DescriptiveCombobox } from "./DescriptiveCombobox";
import TimeResultInput from "./TimeResultInput";
import { parseTimeResultToSeconds } from "@/lib/timeRange";
import { useMasterLookup } from "@/hooks/useMasterLookup";
import { checkDifferentialSum } from "@/lib/differentialCount";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { formatDateDDMMYYYY } from "@/lib/utils";
import { expandRegistrationTests } from "@/lib/expandRegistrationTests";
import { useNewArrivalsBadge } from "@/hooks/useNewArrivalsBadge";
import { signalSync } from "@/lib/limsSyncSignal";
import { propagateRegistrationChange } from "@/lib/limsPropagation";
import { fetchAllByIds } from "@/lib/fetchAllRows";
import { shortIdsKey } from "@/lib/queryKeys";
import { fetchVerificationCandidateIds, fetchFilteredSortedIds } from "@/lib/limsPendingCandidates";
import SyncingOverlay from "./SyncingOverlay";
import NewBadge from "./NewBadge";

const QUALITATIVE_PAIRS = [
  { label: "Absent / Present", values: ["Absent", "Present"] },
  { label: "Reactive / Non Reactive", values: ["Reactive", "Non Reactive"] },
  { label: "Positive / Negative", values: ["Positive", "Negative"] },
];
const getQualitativeOptions = (expectedValue: string): string[] => {
  const pair = QUALITATIVE_PAIRS.find(p => p.label === expectedValue);
  if (pair) return pair.values;
  for (const p of QUALITATIVE_PAIRS) { if (p.values.some(v => v.toLowerCase() === expectedValue.toLowerCase())) return p.values; }
  return [];
};

interface ParameterResult {
  parameterId: string;
  paramCode: string;
  parameterName: string;
  unit: string;
  referenceRange: string;
  normalRangeLow: number | null;
  normalRangeHigh: number | null;
  resultValue: string;
  flag: string;
  isCalculated: boolean;
  calculationFormula: any[];
  isFromInterface: boolean;
  sendForInterface: boolean;
  status: string;
  testId: string;
  testName: string;
  departmentId: string;
  machineName: string;
  displayOrder: number;
  rangeType: string;
  descriptiveOptions: string[];
  expectedValue: string;
  normalFindings: string;
  normalRangeText: string;
  isOutsourced: boolean;
  outsourceLabName: string | null;
  outsourceStatus: string;
  isSnipMode: boolean;
  enteredAt: string | null;
  enteredBy: string | null;
  note: string;
}

interface SnipOnlyTest {
  testId: string;
  testName: string;
  labName: string | null;
  snipUrls: string[];
  outsourceStatus: string;
}

interface PatientEntry {
  registration: any;
  parameters: ParameterResult[];
  snipOnlyTests: SnipOnlyTest[];
}

const RV_PAGE_SIZE = 50;

const ResultVerification = () => {
  const qc = useQueryClient();
  const { data: masterMachines = [] } = useMasterLookup("machine_name");
  const [mode, setMode] = useState<"patient" | "machine">("patient");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedMachine, setSelectedMachine] = useState<string>("all");
  const [expandedPatient, setExpandedPatient] = useState<string | null>(null);
  const [editedValues, setEditedValues] = useState<Record<string, string>>({});
  const [editedUnits, setEditedUnits] = useState<Record<string, string>>({});
  const [editedRefRanges, setEditedRefRanges] = useState<Record<string, string>>({});
  const [editedFlags, setEditedFlags] = useState<Record<string, string>>({});
  const [viewSnipImages, setViewSnipImages] = useState<string[] | null>(null);
  const autoSaveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const [editedNotes, setEditedNotes] = useState<Record<string, string>>({});
  const [activeNoteKey, setActiveNoteKey] = useState<string | null>(null);
  const [editedTestNotes, setEditedTestNotes] = useState<Record<string, string>>({});
  const [activeTestNoteKey, setActiveTestNoteKey] = useState<string | null>(null);
  const [blankConfirmTestParams, setBlankConfirmTestParams] = useState<{ entry: PatientEntry; testId: string; testName: string } | null>(null);
  const [blankParamCount, setBlankParamCount] = useState(0);
  const [blankParamIds, setBlankParamIds] = useState<Set<string>>(new Set());
  const [highlightBlanksForRegs, setHighlightBlanksForRegs] = useState<Set<string>>(new Set());
  const [diffConfirm, setDiffConfirm] = useState<{ entry: PatientEntry; mode: "test" | "all"; testId: string; testName: string; issues: { testName: string; sum: number; diff: number }[] } | null>(null);
  const [rvPage, setRvPage] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => { setDebouncedSearch(search); setRvPage(0); }, 400);
    return () => clearTimeout(t);
  }, [search]);

  // Pending candidates (regs with at least one entered result/snip).
  // Pagination is computed from this set so the queue's "X total" matches reality.
  const { data: pendingIds = [] as string[], isLoading: loadingIds } = useQuery({
    queryKey: ["verification_regs_count", debouncedSearch],
    queryFn: async (): Promise<string[]> => {
      const candidates = await fetchVerificationCandidateIds();
      return await fetchFilteredSortedIds(candidates, debouncedSearch);
    },
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
  const rvCount = pendingIds.length;
  const pageIds: string[] = pendingIds.slice(rvPage * RV_PAGE_SIZE, (rvPage + 1) * RV_PAGE_SIZE);
  const pageKey = shortIdsKey(pageIds, "rv-p");

  const { data: registrations = [], isLoading: loadingRegs } = useQuery({
    queryKey: ["verification_regs_v2", pageKey],
    enabled: pageIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase
        .from("patient_registrations")
        .select("id, invoice_number, patient_name, title, mobile_number, umr_number, status, is_stat, tests, cancelled_tests, visit_type, gender, dob, created_at, updated_at, bill_cancelled, doctor_name")
        .in("id", pageIds);
      const order = new Map(pageIds.map((id, i) => [id, i] as const));
      return ((data || []) as any[]).sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
    },
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });

  const rvTotalPages = Math.max(1, Math.ceil(rvCount / RV_PAGE_SIZE));

  const regIds = registrations.map((r: any) => r.id);
  const regKey = shortIdsKey(regIds, "rv");

  // Full pipeline realtime (queue membership + entered values).
  useLimsPipelineRealtime("verification");

  // Fetch entered results
  const { data: existingResults = [], isFetched: resultsFetched } = useQuery({
    queryKey: ["verification_results_v2", regKey],
    enabled: regIds.length > 0,
    queryFn: async () => {
      return await fetchAllByIds<any>("patient_results", "*", "registration_id", regIds, { eq: { status: "entered" } });
    },
    placeholderData: keepPreviousData,
  });

  // Fetch sample tubes (used to expand PRL/HLT container test rows into leaf test ids)
  const { data: regTubes = [] } = useQuery({
    queryKey: ["verification_tubes", regKey],
    enabled: regIds.length > 0,
    queryFn: async () => {
      return await fetchAllByIds<any>("sample_tubes", "id, registration_id, test_ids", "registration_id", regIds);
    },
    placeholderData: keepPreviousData,
  });

  const leafIdsByReg = useMemo(() => {
    const map: Record<string, Set<string>> = {};
    for (const tb of regTubes) {
      if (!map[tb.registration_id]) map[tb.registration_id] = new Set();
      const ids = Array.isArray(tb.test_ids) ? tb.test_ids : [];
      ids.forEach((id: string) => map[tb.registration_id].add(id));
    }
    return map;
  }, [regTubes]);

  // Fetch outsourced snips with results_entered status
  const { data: outsourcedSnips = [] } = useQuery({
    queryKey: ["verification_outsourced_v2", regKey],
    enabled: regIds.length > 0,
    queryFn: async () => {
      return await fetchAllByIds<any>(
        "outsourced_test_snips",
        "id, registration_id, test_id, outsourced_parameter_ids, outsource_status, outsourced_lab_name, sent_at, result_mode, snip_image_urls",
        "registration_id",
        regIds,
        { in: { outsource_status: ["results_entered", "entered"] } },
      );
    },
    placeholderData: keepPreviousData,
  });

  const resultsReady = regIds.length === 0 || resultsFetched;

  const { transferredTestKeys, outsourcedParamSets, outsourcedSnipDetails } = useMemo(() => {
    const testKeys = new Set<string>();
    const paramSets: Record<string, Set<string>> = {};
    const details: Record<string, { status: string; labName: string | null; resultMode: string; snipImageUrls: string[] }> = {};
    outsourcedSnips.forEach((s: any) => {
      const key = `${s.registration_id}||${s.test_id}`;
      const urls = Array.isArray(s.snip_image_urls) ? s.snip_image_urls : [];
      details[key] = { status: s.outsource_status || "pending", labName: s.outsourced_lab_name || null, resultMode: s.result_mode || "manual", snipImageUrls: urls };
      const paramIds = Array.isArray(s.outsourced_parameter_ids) ? s.outsourced_parameter_ids : [];
      if (paramIds.length > 0) {
        if (!paramSets[key]) paramSets[key] = new Set();
        paramIds.forEach((pid: string) => paramSets[key].add(pid));
      } else {
        testKeys.add(key);
      }
    });
    return { transferredTestKeys: testKeys, outsourcedParamSets: paramSets, outsourcedSnipDetails: details };
  }, [outsourcedSnips]);

  // Fetch tests master
  const { data: testsMap = {} } = useQuery({
    queryKey: ["results_tests_map"],
    queryFn: async () => {
      const { data } = await supabase.from("tests").select("id, test_name, department_id, instrument_name");
      const map: Record<string, any> = {};
      (data || []).forEach((t: any) => { map[t.id] = t; });
      return map;
    },
  });

  // Fetch test_parameters
  const { data: testParamsMap = {} } = useQuery({
    queryKey: ["results_test_params_full"],
    queryFn: async () => {
      const { data } = await supabase
        .from("test_parameters")
        .select("test_id, parameter_id, display_order, is_subheader, subheader_text, report_test_parameters(id, param_code, parameter_name, unit, normal_range_low, normal_range_high, normal_range_text, is_calculated, calculation_formula, send_for_interface)")
        .order("display_order");
      const map: Record<string, any[]> = {};
      (data || []).forEach((tp: any) => {
        if (!tp.test_id) return;
        if (!map[tp.test_id]) map[tp.test_id] = [];
        map[tp.test_id].push(tp);
      });
      return map;
    },
  });

  // Fetch parameter_normal_ranges
  const { data: normalRangesMap = {} } = useQuery({
    queryKey: ["results_normal_ranges"],
    queryFn: async () => {
      const { data } = await supabase.from("parameter_normal_ranges").select("*").order("age_min");
      const map: Record<string, any[]> = {};
      (data || []).forEach((r: any) => {
        if (!map[r.parameter_id]) map[r.parameter_id] = [];
        map[r.parameter_id].push(r);
      });
      return map;
    },
  });

  // Historical results
  const expandedUmr = useMemo(() => {
    if (!expandedPatient) return null;
    const reg = registrations.find((r: any) => r.id === expandedPatient);
    return reg?.umr_number || null;
  }, [expandedPatient, registrations]);

  const { data: historicalResults = [] } = useQuery({
    queryKey: ["historical_results_verif", expandedUmr, expandedPatient],
    enabled: !!expandedUmr && !!expandedPatient,
    queryFn: async () => {
      const { data: sameUmrRegs } = await supabase
        .from("patient_registrations")
        .select("id")
        .eq("umr_number", expandedUmr!)
        .neq("id", expandedPatient!);
      const rIds = (sameUmrRegs || []).map((r: any) => r.id);
      if (rIds.length === 0) return [];
      const { data } = await supabase
        .from("patient_results")
        .select("parameter_id, result_value, reference_range, created_at, test_id, registration_id")
        .in("registration_id", rIds)
        .not("result_value", "is", null)
        .order("created_at", { ascending: false });
      const { data: snips } = await supabase
        .from("outsourced_test_snips")
        .select("registration_id, test_id, result_mode, outsourced_parameter_ids, snip_image_urls")
        .in("registration_id", rIds)
        .eq("result_mode", "snip");
      const snipInfoMap: Record<string, string[]> = {};
      (snips || []).forEach((s: any) => {
        const urls = Array.isArray(s.snip_image_urls) ? s.snip_image_urls : [];
        const paramIds = Array.isArray(s.outsourced_parameter_ids) ? s.outsourced_parameter_ids : [];
        if (paramIds.length > 0) {
          paramIds.forEach((pid: string) => { snipInfoMap[`${s.registration_id}||${s.test_id}||${pid}`] = urls; });
        } else {
          snipInfoMap[`${s.registration_id}||${s.test_id}||__full__`] = urls;
        }
      });
      return (data || []).map((r: any) => {
        const fullKey = `${r.registration_id}||${r.test_id}||__full__`;
        const paramKey = `${r.registration_id}||${r.test_id}||${r.parameter_id}`;
        return { ...r, snipImageUrls: snipInfoMap[paramKey] || snipInfoMap[fullKey] || null };
      });
    },
  });

  const historyMap = useMemo(() => {
    const map: Record<string, { resultValue: string; referenceRange: string; createdAt: string; snipImageUrls: string[] | null }[]> = {};
    for (const r of historicalResults) {
      if (!r.parameter_id) continue;
      if (!map[r.parameter_id]) map[r.parameter_id] = [];
      if (map[r.parameter_id].length < 2) {
        map[r.parameter_id].push({ resultValue: r.result_value || "", referenceRange: r.reference_range || "", createdAt: r.created_at || "", snipImageUrls: r.snipImageUrls || null });
      }
    }
    return map;
  }, [historicalResults]);

  // Resolve normal range
  const resolveNormalRange = useCallback((parameterId: string, reg: any) => {
    const ranges = normalRangesMap[parameterId];
    if (!ranges || ranges.length === 0) return { text: "", low: null as number | null, high: null as number | null, rangeType: "numeric", descriptiveOptions: [] as string[], expectedValue: "", normalFindings: "" };
    let patientAge: number | null = null;
    if (reg.dob) {
      const birth = new Date(reg.dob);
      patientAge = Math.floor((Date.now() - birth.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
    }
    const patientGender = (reg.gender || "").toLowerCase().charAt(0);
    let candidates = ranges.filter((r: any) => {
      const g = (r.gender || "all").toLowerCase();
      return g === "all" || (g === "male" && patientGender === "m") || (g === "female" && patientGender === "f");
    });
    if (patientAge != null) {
      const ageMatched = candidates.filter((r: any) => {
        if (r.age_min == null && r.age_max == null) return true;
        if (r.age_min != null && patientAge! < r.age_min) return false;
        if (r.age_max != null && patientAge! > r.age_max) return false;
        return true;
      });
      if (ageMatched.length > 0) candidates = ageMatched;
    }
    const best = candidates.find((r: any) => (r.gender || "all").toLowerCase() !== "all") || candidates[0];
    if (!best) return { text: "", low: null as number | null, high: null as number | null, rangeType: "numeric", descriptiveOptions: [] as string[], expectedValue: "", normalFindings: "" };
    const text = best.normal_range_text || (best.normal_range_low != null && best.normal_range_high != null ? `${best.normal_range_low} - ${best.normal_range_high}` : "");
    return { text, low: best.normal_range_low as number | null, high: best.normal_range_high as number | null, rangeType: best.range_type || "numeric", descriptiveOptions: Array.isArray(best.descriptive_options) ? best.descriptive_options : [], expectedValue: best.expected_value || "", normalFindings: best.normal_findings || "" };
  }, [normalRangesMap]);

  // Build patient entries
  const patientEntries: PatientEntry[] = useMemo(() => {
    return registrations.map((reg: any) => {
      const tests = (reg.tests || []) as any[];
      const cancelledIds = new Set(((reg.cancelled_tests || []) as any[]).map((t: any) => t.test_id));
      const expandedTests = expandRegistrationTests(tests, leafIdsByReg[reg.id] ?? new Set<string>(), testsMap);
      const activeTests = expandedTests.filter((t: any) => !cancelledIds.has(t.test_id));
      const parameters: ParameterResult[] = [];
      const snipOnlyTests: SnipOnlyTest[] = [];
      for (const t of activeTests) {
        const testInfo = testsMap[t.test_id] || {};
        const testSnipKey = `${reg.id}||${t.test_id}`;
        const isFullTestOutsourced = transferredTestKeys.has(testSnipKey);
        const paramOutsourcedSet = outsourcedParamSets[testSnipKey];
        const snipDetail = outsourcedSnipDetails[testSnipKey];
        const params = testParamsMap[t.test_id] || [];
        const validParams = params.filter((tp: any) => !tp.is_subheader && tp.report_test_parameters);

        // Snip-only test: no params but has outsourced snip with results_entered status
        if (validParams.length === 0) {
          if (snipDetail && snipDetail.snipImageUrls.length > 0 && ["results_entered", "entered"].includes(snipDetail.status)) {
            snipOnlyTests.push({ testId: t.test_id, testName: t.test_name || testInfo.test_name || "", labName: snipDetail.labName, snipUrls: snipDetail.snipImageUrls, outsourceStatus: snipDetail.status });
          }
          continue;
        }

        const testEnteredResults = existingResults.filter((r: any) => r.registration_id === reg.id && r.test_id === t.test_id);
        if (testEnteredResults.length === 0 && !snipDetail) continue;

        for (const tp of params) {
          if (tp.is_subheader) continue;
          const p = tp.report_test_parameters;
          if (!p) continue;
          const isParamOutsourced = isFullTestOutsourced || (paramOutsourcedSet && paramOutsourcedSet.has(p.id));
          const existing = testEnteredResults.find((r: any) => r.parameter_id === p.id);
          if (!existing && !isParamOutsourced) continue;
          
          const resolved = resolveNormalRange(p.id, reg);
          const refText = resolved.text || p.normal_range_text || (p.normal_range_low != null && p.normal_range_high != null ? `${p.normal_range_low} - ${p.normal_range_high}` : "");
          const savedUnit = isParamOutsourced && existing?.unit ? existing.unit : (p.unit || "");
          const savedRefRange = resolved.rangeType === "descriptive"
            ? (resolved.text || "")
            : (isParamOutsourced && existing?.reference_range ? existing.reference_range : refText);
          parameters.push({
            parameterId: p.id, paramCode: p.param_code || "", parameterName: p.parameter_name,
            unit: savedUnit, referenceRange: savedRefRange,
            normalRangeLow: resolved.low ?? p.normal_range_low, normalRangeHigh: resolved.high ?? p.normal_range_high,
            resultValue: existing?.result_value || "", flag: existing?.flag || "",
            isCalculated: p.is_calculated || false, calculationFormula: p.calculation_formula || [],
            isFromInterface: existing?.is_from_interface || false, sendForInterface: p.send_for_interface || false,
            status: existing?.status || "pending", testId: t.test_id,
            testName: t.test_name || testInfo.test_name || "", departmentId: testInfo.department_id || "",
            machineName: testInfo.instrument_name || "", displayOrder: tp.display_order || 0,
            rangeType: resolved.rangeType, descriptiveOptions: resolved.descriptiveOptions, expectedValue: resolved.expectedValue, normalFindings: resolved.normalFindings, normalRangeText: resolved.text || "",
            isOutsourced: !!isParamOutsourced, outsourceLabName: isParamOutsourced ? (snipDetail?.labName || null) : null,
            outsourceStatus: isParamOutsourced ? (snipDetail?.status || "pending") : "",
            isSnipMode: isParamOutsourced && snipDetail?.resultMode === "snip",
            enteredAt: existing?.entered_at || null,
            enteredBy: existing?.entered_by || null,
            note: existing?.note || "",
          });
        }
      }
      return { registration: reg, parameters, snipOnlyTests };
    }).filter(e => e.parameters.length > 0 || e.snipOnlyTests.length > 0);
  }, [registrations, testsMap, testParamsMap, existingResults, resolveNormalRange, transferredTestKeys, outsourcedParamSets, outsourcedSnipDetails, leafIdsByReg]);

  // ─── Loaded test-level notes: first non-null test_note per (reg, test) ───
  const loadedTestNotes = useMemo(() => {
    const map: Record<string, string> = {};
    for (const r of existingResults as any[]) {
      const k = `${r.registration_id}||${r.test_id}`;
      if (map[k] == null && r.test_note) map[k] = r.test_note;
    }
    return map;
  }, [existingResults]);
  const getTestNote = useCallback((regId: string, testId: string): string => {
    const k = `${regId}||${testId}`;
    if (editedTestNotes[k] !== undefined) return editedTestNotes[k];
    return loadedTestNotes[k] || "";
  }, [editedTestNotes, loadedTestNotes]);

  // Calculate flag
  const calculateFlag = (value: string, low: number | null, high: number | null, rangeType?: string, expectedValue?: string, descriptiveOptions?: string[], normalRangeText?: string, unit?: string | null, normalFindings?: string): string => {
    if (!value || value.trim() === "") return "";
    if (rangeType === "time") {
      const total = parseTimeResultToSeconds(value);
      if (total == null) return "";
      if (low != null && total < low) return "L";
      if (high != null && total > high) return "H";
      return "N";
    }
    return calculateResultFlag({
      value,
      low,
      high,
      rangeType,
      expectedValue,
      descriptiveOptions,
      normalRangeText,
      normalFindings,
      unit,
    });
  };

  // Apply unit suffix for "undefined" range type
  const applyUnitSuffix = (value: string, unit: string | null | undefined, rangeType?: string): string => {
    if (!value || rangeType !== "undefined" || !unit) return value;
    const trimmed = value.trim();
    const u = unit.trim();
    if (!u) return trimmed;
    if (trimmed.toLowerCase().endsWith(u.toLowerCase())) return trimmed;
    return `${trimmed} ${u}`;
  };

  // Evaluate formula
  const evaluateFormula = (formula: any[], paramValues: Record<string, string>): string => {
    if (!formula || formula.length === 0) return "";
    try {
      let expr = "";
      for (let idx = 0; idx < formula.length; idx++) {
        const token = formula[idx];
        if (token.type === "bracket_open") {
          if (idx > 0 && token.operator && ["+", "-", "*", "/"].includes(token.operator)) expr += ` ${token.operator} `;
          expr += "(";
        } else if (token.type === "bracket_close") {
          expr += ")";
        } else if (token.type === "parameter") {
          if (idx > 0 && token.operator && ["+", "-", "*", "/"].includes(token.operator)) expr += ` ${token.operator} `;
          const val = paramValues[token.parameter_id];
          if (!val || isNaN(parseFloat(val))) return "";
          expr += parseFloat(val);
        } else if (token.type === "fixed_value" || token.type === "fixed") {
          if (idx > 0 && token.operator && ["+", "-", "*", "/"].includes(token.operator)) expr += ` ${token.operator} `;
          expr += token.fixed_value ?? token.value ?? "";
        }
      }
      expr = expr.replace(/\s+/g, " ").trim();
      const result = new Function(`return (${expr})`)();
      if (typeof result === "number" && isFinite(result)) return parseFloat(result.toFixed(2)).toString();
      return "";
    } catch { return ""; }
  };

  const getParamValue = (regId: string, paramId: string, entry: PatientEntry): string => {
    const key = `${regId}||${paramId}`;
    if (editedValues[key] !== undefined) return editedValues[key];
    const param = entry.parameters.find(p => p.parameterId === paramId);
    return param?.resultValue || "";
  };

  const handleValueChange = (regId: string, paramId: string, value: string, entry: PatientEntry) => {
    const key = `${regId}||${paramId}`;
    const newEdited = { ...editedValues, [key]: value };
    const paramValues: Record<string, string> = {};
    for (const p of entry.parameters) {
      const pk = `${regId}||${p.parameterId}`;
      paramValues[p.parameterId] = pk === key ? value : (newEdited[pk] !== undefined ? newEdited[pk] : p.resultValue);
    }
    for (const p of entry.parameters) {
      if (p.isCalculated && p.calculationFormula.length > 0) {
        const calcResult = evaluateFormula(p.calculationFormula, paramValues);
        newEdited[`${regId}||${p.parameterId}`] = calcResult;
        paramValues[p.parameterId] = calcResult;
      }
    }
    setEditedValues(newEdited);
  };

  // ─── Auto-evaluate calculated parameters whenever entries refresh ───
  const autoCalcSeenRef = useRef<Record<string, string>>({});
  useEffect(() => {
    if (!patientEntries || patientEntries.length === 0) return;
    const updates: Record<string, string> = {};
    for (const entry of patientEntries) {
      const regId = entry.registration.id;
      const valueMap: Record<string, string> = {};
      for (const p of entry.parameters) {
        const k = `${regId}||${p.parameterId}`;
        const v = editedValues[k] !== undefined ? editedValues[k] : (p.resultValue || "");
        if (v && v.trim() !== "") valueMap[p.parameterId] = v;
      }
      for (let pass = 0; pass < 3; pass++) {
        let changed = 0;
        for (const p of entry.parameters) {
          if (!p.isCalculated || !p.calculationFormula || p.calculationFormula.length === 0) continue;
          const computed = evaluateFormula(p.calculationFormula, valueMap);
          if (!computed) continue;
          const k = `${regId}||${p.parameterId}`;
          const currentDisplayed = updates[k] !== undefined
            ? updates[k]
            : (editedValues[k] !== undefined ? editedValues[k] : (p.resultValue || ""));
          if (currentDisplayed === computed) continue;
          if (autoCalcSeenRef.current[k] === computed && currentDisplayed === computed) continue;
          updates[k] = computed;
          autoCalcSeenRef.current[k] = computed;
          valueMap[p.parameterId] = computed;
          changed++;
        }
        if (changed === 0) break;
      }
    }
    if (Object.keys(updates).length === 0) return;
    setEditedValues((prev) => ({ ...prev, ...updates }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientEntries]);

  // Filter
  const filteredEntries = useMemo(() => {
    if (mode === "patient") return patientEntries;
    if (selectedMachine === "all") return patientEntries;
    const filterMachine = selectedMachine === "others" ? "" : selectedMachine;
    return patientEntries
      .map(e => ({ ...e, parameters: e.parameters.filter(p => (p.machineName || "") === filterMachine) }))
      .filter(e => e.parameters.length > 0 || e.snipOnlyTests.length > 0);
  }, [patientEntries, mode, selectedMachine]);

  const stats = useMemo(() => {
    let totalParams = 0;
    for (const e of filteredEntries) totalParams += e.parameters.length;
    return { totalPatients: filteredEntries.length, totalParams };
  }, [filteredEntries]);

  // ─── NEW arrivals badge tracker ───
  const filteredRegIds = useMemo(() => filteredEntries.map(e => e.registration.id), [filteredEntries]);
  const { isNew: isNewArrival, markSeen: markArrivalSeen } = useNewArrivalsBadge("verification", filteredRegIds);

  const groupByMachine = (params: ParameterResult[]) => {
    const groups: Record<string, { machineName: string; params: ParameterResult[] }> = {};
    for (const p of params) {
      const machine = p.machineName || "Others";
      if (!groups[machine]) groups[machine] = { machineName: machine, params: [] };
      groups[machine].params.push(p);
    }
    return Object.values(groups);
  };

  const groupByTest = (params: ParameterResult[]) => {
    const groups: Record<string, { testId: string; testName: string; params: ParameterResult[] }> = {};
    for (const p of params) {
      if (!groups[p.testId]) groups[p.testId] = { testId: p.testId, testName: p.testName, params: [] };
      groups[p.testId].params.push(p);
    }
    return Object.values(groups);
  };

  // ─── Blank result check before verify ───
  const countBlanks = (entry: PatientEntry, testId: string) => {
    const reg = entry.registration;
    const testParams = entry.parameters.filter(p => p.testId === testId);
    let blanks = 0;
    for (const p of testParams) {
      if (p.isCalculated) continue;
      const key = `${reg.id}||${p.parameterId}`;
      const val = editedValues[key] !== undefined ? editedValues[key] : p.resultValue;
      if (!val || val.trim() === "") blanks++;
    }
    return blanks;
  };

  // Compute differential issue for a single test of an entry
  const computeDiffIssue = (entry: PatientEntry, testId: string) => {
    const reg = entry.registration;
    const testParams = entry.parameters.filter((p) => p.testId === testId);
    const list = testParams.map((p) => {
      const key = `${reg.id}||${p.parameterId}`;
      const val = editedValues[key] !== undefined ? editedValues[key] : p.resultValue;
      return { paramCode: p.paramCode, value: val };
    });
    const r = checkDifferentialSum(list);
    return r.hasDifferential && !r.isOk ? r : null;
  };

  const handleVerifyTest = (entry: PatientEntry, testId: string, testName: string) => {
    // Snip-only test — no params to check, verify directly
    const isSnipOnly = entry.snipOnlyTests.some(s => s.testId === testId);
    if (isSnipOnly) {
      verifyTest(entry, testId, testName);
      return;
    }
    const blanks = countBlanks(entry, testId);
    if (blanks > 0) {
      setBlankParamCount(blanks);
      const ids = new Set<string>();
      const testParams = entry.parameters.filter(p => p.testId === testId);
      for (const p of testParams) {
        if (p.isCalculated) continue;
        const key = `${entry.registration.id}||${p.parameterId}`;
        const val = editedValues[key] !== undefined ? editedValues[key] : p.resultValue;
        if (!val || val.trim() === "") ids.add(p.parameterId);
      }
      setBlankParamIds(ids);
      setBlankConfirmTestParams({ entry, testId, testName });
      setHighlightBlanksForRegs(prev => new Set(prev).add(`${entry.registration.id}||${testId}`));
    } else {
      const issue = computeDiffIssue(entry, testId);
      if (issue) {
        setDiffConfirm({ entry, mode: "test", testId, testName, issues: [{ testName, sum: issue.sum, diff: issue.diff }] });
        return;
      }
      verifyTest(entry, testId, testName);
    }
  };

  const handleVerifyAll = (entry: PatientEntry) => {
    const testIds = [...new Set(entry.parameters.map(p => p.testId))];
    let totalBlanks = 0;
    for (const tid of testIds) totalBlanks += countBlanks(entry, tid);
    if (totalBlanks > 0) {
      const ids = new Set<string>();
      for (const tid of testIds) {
        for (const p of entry.parameters.filter(pp => pp.testId === tid && !pp.isCalculated)) {
          const key = `${entry.registration.id}||${p.parameterId}`;
          const val = editedValues[key] !== undefined ? editedValues[key] : p.resultValue;
          if (!val || val.trim() === "") ids.add(p.parameterId);
        }
      }
      setBlankParamIds(ids);
      setBlankConfirmTestParams({ entry, testId: "__all__", testName: "All Tests" });
    } else {
      const issues: { testName: string; sum: number; diff: number }[] = [];
      for (const tid of testIds) {
        const issue = computeDiffIssue(entry, tid);
        if (issue) {
          const tName = entry.parameters.find(p => p.testId === tid)?.testName || "Test";
          issues.push({ testName: tName, sum: issue.sum, diff: issue.diff });
        }
      }
      if (issues.length > 0) {
        setDiffConfirm({ entry, mode: "all", testId: "__all__", testName: "All Tests", issues });
        return;
      }
      verifyAllForPatient(entry);
    }
  };

  // Verify test (update status to verified)
  const [verifyingKey, setVerifyingKey] = useState<string | null>(null);

  /**
   * Build the upsert payload for verifying ONE test of a registration.
   *
   * Hardening (root-cause fix for invoice 2605010004 stuck loop):
   *   - Hydrates payload from LIVE DB rows (not stale React state) so a verify
   *     click can NEVER silently no-op when local params haven't loaded yet.
   *   - Falls back to entry.parameters only if DB has no rows for the test
   *     (true snip-only / config edge cases).
   *   - Returns null when there is genuinely nothing to verify (e.g. snip-only
   *     test with no params), so the caller can branch safely.
   */
  const buildVerifyUpserts = async (
    entry: PatientEntry,
    testId: string,
  ): Promise<any[] | null> => {
    const reg = entry.registration;
    const localParams = entry.parameters.filter((p) => p.testId === testId);

    // Live DB read — source of truth
    const { data: liveRows, error: readErr } = await supabase
      .from("patient_results")
      .select("*")
      .eq("registration_id", reg.id)
      .eq("test_id", testId);
    if (readErr) throw readErr;

    const liveByParam: Record<string, any> = {};
    (liveRows || []).forEach((r: any) => { if (r.parameter_id) liveByParam[r.parameter_id] = r; });

    // Union of local-known params + live DB params, keyed by parameter_id
    const seen = new Set<string>();
    const merged: Array<{ p: typeof localParams[number] | null; live: any | null; pid: string }> = [];
    for (const p of localParams) {
      if (!p.parameterId || seen.has(p.parameterId)) continue;
      seen.add(p.parameterId);
      merged.push({ p, live: liveByParam[p.parameterId] || null, pid: p.parameterId });
    }
    for (const r of (liveRows || []) as any[]) {
      if (!r.parameter_id || seen.has(r.parameter_id)) continue;
      seen.add(r.parameter_id);
      merged.push({ p: null, live: r, pid: r.parameter_id });
    }

    if (merged.length === 0) return null; // genuinely nothing to verify (snip-only handled by caller)

    const nowIso = new Date().toISOString();
    const verifier = getCurrentUserName();
    const upserts: any[] = [];

    for (const { p, live, pid } of merged) {
      const k = `${reg.id}||${pid}`;
      // Resolve the result value: edited > local cache > live DB
      const baseVal =
        editedValues[k] !== undefined
          ? editedValues[k]
          : p?.resultValue ?? (live?.result_value ?? "");

      const rangeLow = p?.normalRangeLow ?? live?.normal_range_low ?? null;
      const rangeHigh = p?.normalRangeHigh ?? live?.normal_range_high ?? null;
      const rangeType = p?.rangeType;
      const expectedValue = p?.expectedValue;
      const descriptiveOptions = p?.descriptiveOptions;
      const normalRangeText = p?.normalRangeText;
      const normalFindings = p?.normalFindings;

      const autoFlag = calculateFlag(baseVal, rangeLow, rangeHigh, rangeType, expectedValue, descriptiveOptions, normalRangeText, p?.unit ?? live?.unit ?? null, normalFindings);
      const isOutsourced = !!p?.isOutsourced;
      const flag = isOutsourced && editedFlags[k] !== undefined
        ? editedFlags[k]
        : (autoFlag || live?.flag || null);
      const unit = isOutsourced && editedUnits[k] !== undefined
        ? editedUnits[k]
        : (p?.unit ?? live?.unit ?? null);
      const refRange = rangeType === "descriptive"
        ? (normalRangeText || "")
        : (isOutsourced && editedRefRanges[k] !== undefined
          ? editedRefRanges[k]
          : (p?.referenceRange ?? live?.reference_range ?? null));

      const noteEdited = editedNotes[k];
      const note = noteEdited !== undefined
        ? (noteEdited || null)
        : (p?.note ?? live?.note ?? null);

      const testNoteKey = `${reg.id}||${testId}`;
      const testNoteEdited = editedTestNotes[testNoteKey];
      const test_note = testNoteEdited !== undefined
        ? (testNoteEdited || null)
        : (loadedTestNotes[testNoteKey] ?? live?.test_note ?? null);

      upserts.push({
        registration_id: reg.id,
        test_id: testId,
        parameter_id: pid,
        param_code: p?.paramCode ?? live?.param_code ?? null,
        parameter_name: p?.parameterName ?? live?.parameter_name ?? null,
        result_value: applyUnitSuffix(baseVal, unit, rangeType) || null,
        unit,
        reference_range: refRange,
        normal_range_low: rangeLow,
        normal_range_high: rangeHigh,
        flag: flag || null,
        status: "verified",
        is_calculated: p?.isCalculated ?? live?.is_calculated ?? false,
        is_from_interface: p?.isFromInterface ?? live?.is_from_interface ?? false,
        verified_at: nowIso,
        entered_at: live?.entered_at ?? p?.enteredAt ?? nowIso,
        entered_by: live?.entered_by ?? p?.enteredBy ?? null,
        verified_by: verifier,
        note,
        test_note,
      });
    }
    return upserts;
  };

  /**
   * Persist a verification for ONE test atomically and verify post-condition.
   *
   * Bug-fix surface vs the previous implementation:
   *   - Broadened delete filter (.in([pending, entered, results_entered])) so
   *     no source-state row is left behind to create duplicate keys (Bug B).
   *   - Captures every {error} returned by supabase-js and throws — no more
   *     silent success toasts (Bug C).
   *   - Re-reads patient_results after insert and asserts at least one row is
   *     status='verified'; throws otherwise (Bug D defence-in-depth).
   *   - Unique index patient_results_reg_test_param_uniq (added by migration)
   *     means the insert is now guaranteed to be a true upsert at DB level.
   */
  const persistVerifyTest = async (
    reg: { id: string },
    testId: string,
    upserts: any[] | null,
  ): Promise<void> => {
    // Always update outsourced snip status — works for snip-only tests too
    const snipUpdate = await supabase
      .from("outsourced_test_snips")
      .update({
        outsource_status: "verified",
        verified_at: new Date().toISOString(),
        verified_by: getCurrentUserName(),
      } as any)
      .eq("registration_id", reg.id)
      .eq("test_id", testId)
      .in("outsource_status", ["results_entered", "entered", "sent", "results_saved"]);
    if (snipUpdate.error) throw snipUpdate.error;

    if (upserts && upserts.length > 0) {
      const del = await supabase
        .from("patient_results")
        .delete()
        .eq("registration_id", reg.id)
        .eq("test_id", testId)
        .in("status", ["pending", "entered", "results_entered"]);
      if (del.error) throw del.error;

      const ins = await supabase.from("patient_results").insert(upserts as any);
      if (ins.error) throw ins.error;

      // Post-condition self-check — confirm the verified rows exist
      const { data: confirmRows, error: confirmErr } = await supabase
        .from("patient_results")
        .select("id, status")
        .eq("registration_id", reg.id)
        .eq("test_id", testId)
        .eq("status", "verified");
      if (confirmErr) throw confirmErr;
      if (!confirmRows || confirmRows.length === 0) {
        throw new Error("Verification did not persist (no verified rows found after insert). Please retry.");
      }
    }
  };

  const verifyTest = async (entry: PatientEntry, testId: string, testName: string) => {
    const reg = entry.registration;
    const key = `${reg.id}||${testId}`;
    setVerifyingKey(key);
    try {
      const upserts = await buildVerifyUpserts(entry, testId);
      // Snip-only? Allow only if entry tracks it as a snipOnlyTest
      const isSnipOnly = entry.snipOnlyTests.some((s) => s.testId === testId);
      if (!upserts && !isSnipOnly) {
        throw new Error("No parameters found for this test — cannot verify. Please reload and try again.");
      }
      await persistVerifyTest(reg, testId, upserts);

      const testParams = entry.parameters.filter((p) => p.testId === testId);
      setEditedValues((prev) => {
        const next = { ...prev };
        testParams.forEach((p) => { delete next[`${reg.id}||${p.parameterId}`]; });
        return next;
      });
      await propagateRegistrationChange(qc, reg.id, ["verification", "doctor_approval"]);
      toast.success(`${testName} verified & sent to Doctor Approval`);
    } catch (err: any) {
      toast.error(err.message || "Verification failed");
    } finally {
      setVerifyingKey(null);
    }
  };

  // Verify all tests for patient — uses the same hardened helpers per-test
  const verifyAllForPatient = async (entry: PatientEntry) => {
    const reg = entry.registration;
    setVerifyingKey(reg.id);
    try {
      // Union of (params-driven test ids) + (snip-only test ids)
      const testIds = [
        ...new Set([
          ...entry.parameters.map((p) => p.testId),
          ...entry.snipOnlyTests.map((s) => s.testId),
        ]),
      ];
      for (const testId of testIds) {
        const upserts = await buildVerifyUpserts(entry, testId);
        const isSnipOnly = entry.snipOnlyTests.some((s) => s.testId === testId);
        if (!upserts && !isSnipOnly) {
          throw new Error(`No parameters loaded for one of the tests — please reload and try again.`);
        }
        await persistVerifyTest(reg, testId, upserts);
      }
      await propagateRegistrationChange(qc, reg.id, ["verification", "doctor_approval"]);
      toast.success(`All tests verified for ${patientDisplayName(reg)}`);
    } catch (err: any) {
      toast.error(err.message || "Verification failed");
    } finally {
      setVerifyingKey(null);
    }
  };

  // Send back to Results Entry — persist edits FIRST, then flip status to pending
  const sendBackTest = async (regId: string, testId: string, testName: string) => {
    try {
      // Find the patient entry + parameters for this (regId, testId)
      const entry = patientEntries.find(e => e.registration.id === regId);
      const testParams = entry ? entry.parameters.filter(p => p.testId === testId) : [];

      // Build upserts that include verifier's edits, with status = "pending"
      const upserts: any[] = [];
      for (const p of testParams) {
        const k = `${regId}||${p.parameterId}`;
        const value = editedValues[k] !== undefined ? editedValues[k] : p.resultValue;
        const autoFlag = calculateFlag(value, p.normalRangeLow, p.normalRangeHigh, p.rangeType, p.expectedValue, p.descriptiveOptions, p.normalRangeText, p.unit, p.normalFindings);
        const flag = p.isOutsourced && editedFlags[k] !== undefined ? editedFlags[k] : autoFlag;
        const unit = p.isOutsourced && editedUnits[k] !== undefined ? editedUnits[k] : p.unit;
        const refRange = p.rangeType === "descriptive"
          ? (p.normalRangeText || "")
          : (p.isOutsourced && editedRefRanges[k] !== undefined ? editedRefRanges[k] : p.referenceRange);
        upserts.push({
          registration_id: regId, test_id: p.testId, parameter_id: p.parameterId,
          param_code: p.paramCode, parameter_name: p.parameterName,
          result_value: applyUnitSuffix(value, unit, p.rangeType) || null, unit, reference_range: refRange,
          normal_range_low: p.normalRangeLow, normal_range_high: p.normalRangeHigh,
          flag: flag || null, status: "pending",
          is_calculated: p.isCalculated, is_from_interface: p.isFromInterface,
          entered_at: p.enteredAt || null, entered_by: p.enteredBy || null,
          verified_at: null, verified_by: null,
          note: editedNotes[k] !== undefined ? (editedNotes[k] || null) : (p.note || null),
          test_note: editedTestNotes[`${regId}||${testId}`] !== undefined ? (editedTestNotes[`${regId}||${testId}`] || null) : (loadedTestNotes[`${regId}||${testId}`] || null),
        });
      }

      if (upserts.length > 0) {
        await supabase.from("patient_results").delete().eq("registration_id", regId).eq("test_id", testId).in("status", ["entered", "pending"]);
        await supabase.from("patient_results").insert(upserts as any);
      } else {
        // Fallback (e.g. snip-only tests with no params) — keep prior behavior
        await supabase.from("patient_results").update({ status: "pending" } as any).eq("registration_id", regId).eq("test_id", testId).eq("status", "entered");
      }

      await supabase.from("outsourced_test_snips").update({ outsource_status: "results_saved" } as any).eq("registration_id", regId).eq("test_id", testId).in("outsource_status", ["results_entered", "entered"]);

      // Recompute the parent registration status so Results Entry sees this test as pending again
      await recalculateRegistrationStatus(regId);

      // Clear local edits for parameters belonging to this test (so re-entry shows freshly persisted DB values)
      const paramIdsForTest = new Set<string>();
      for (const p of testParams) paramIdsForTest.add(p.parameterId);
      const stripKeys = (obj: Record<string, any>) => {
        const next = { ...obj };
        for (const k of Object.keys(next)) {
          const [rid, pid] = k.split("||");
          if (rid === regId && paramIdsForTest.has(pid)) delete next[k];
        }
        return next;
      };
      setEditedValues((prev) => stripKeys(prev));
      setEditedFlags((prev) => stripKeys(prev));
      setEditedUnits((prev) => stripKeys(prev));
      setEditedRefRanges((prev) => stripKeys(prev));
      setEditedNotes((prev) => stripKeys(prev));
      setEditedTestNotes((prev) => { const next = { ...prev }; delete next[`${regId}||${testId}`]; return next; });

      await propagateRegistrationChange(qc, regId, ["verification", "results"], {
        extraKeys: ["outsourced_manual_results", "outsourced_snips"],
      });
      toast.success(`${testName} sent back to Results Entry`);
    } catch (err: any) {
      toast.error(err.message || "Failed");
    }
  };

  // Render history cell
  const renderHistoryCell = (parameterId: string, index: number) => {
    const hist = historyMap[parameterId]?.[index];
    if (!hist || !hist.resultValue) return <TableCell className="py-1.5 text-center text-xs text-muted-foreground">—</TableCell>;
    if (hist.snipImageUrls && hist.snipImageUrls.length > 0) {
      return (
        <TableCell className="py-1.5 text-xs">
          <div className="leading-tight">
            <Button size="sm" variant="ghost" className="h-5 px-1 text-xs text-blue-600 hover:text-blue-800 gap-0.5" onClick={() => setViewSnipImages(hist.snipImageUrls)}>
              <Eye className="h-3 w-3" /> View Snip
            </Button>
            <div className="text-muted-foreground text-[10px]">{hist.createdAt ? formatDateDDMMYYYY(hist.createdAt) : ""}</div>
          </div>
        </TableCell>
      );
    }
    return (
      <TableCell className="py-1.5 text-xs">
        <div className="leading-tight">
          <div className="font-bold">{hist.resultValue}</div>
          <div className="text-muted-foreground">{hist.referenceRange || "—"}</div>
          <div className="text-muted-foreground text-[10px]">{hist.createdAt ? formatDateDDMMYYYY(hist.createdAt) : ""}</div>
        </div>
      </TableCell>
    );
  };

  // Render parameter row
  const renderParamRow = (entry: PatientEntry, p: ParameterResult) => {
    const regId = entry.registration.id;
    const key = `${regId}||${p.parameterId}`;
    const currentValue = editedValues[key] !== undefined ? editedValues[key] : p.resultValue;
    const autoFlag = calculateFlag(currentValue, p.normalRangeLow, p.normalRangeHigh, p.rangeType, p.expectedValue, p.descriptiveOptions, p.normalRangeText, p.unit, p.normalFindings);
    const flag = p.isOutsourced && editedFlags[key] !== undefined ? editedFlags[key] : autoFlag;
    const isNegative = isSuspectNegativeResult(currentValue);
    const rowBg = isNegative ? "bg-red-50" : ((flag === "H" || flag === "L" || flag === "A" || flag === "X") ? "bg-destructive/5" : "");
    const negCls = isNegative ? "border-red-500 ring-1 ring-red-300 text-red-700 font-semibold" : "";

    return (
      <TableRow key={key} className={rowBg}>
        <TableCell className="py-1.5 text-xs font-mono text-muted-foreground">{p.paramCode}</TableCell>
        <TableCell className="py-1.5 text-sm font-medium">
          <div className="flex items-center gap-1">
            {p.parameterName}
            {p.isCalculated && <Calculator className="inline h-3 w-3 ml-1 text-primary" />}
            <StickyNote
              className={`inline h-3 w-3 cursor-pointer shrink-0 ${(editedNotes[key] !== undefined ? editedNotes[key] : p.note) ? 'text-amber-600' : 'text-muted-foreground hover:text-primary'}`}
              onClick={(e) => { e.stopPropagation(); if (activeNoteKey === key) { setActiveNoteKey(null); } else { setActiveNoteKey(key); const currentNote = editedNotes[key] !== undefined ? editedNotes[key] : (p.note || ""); if (!currentNote) setEditedNotes(prev => ({ ...prev, [key]: "Kindly correlate clinically" })); } }}
            />
          </div>
          {activeNoteKey === key && (
            <div className="flex items-center gap-1 mt-1">
              <Input value={editedNotes[key] ?? p.note ?? ""} onChange={e => setEditedNotes(prev => ({ ...prev, [key]: e.target.value }))} className="h-6 text-xs w-full" placeholder="Kindly correlate clinically" autoFocus onClick={e => e.stopPropagation()} />
              <Trash2 className="h-3.5 w-3.5 text-destructive cursor-pointer shrink-0" onClick={(e) => { e.stopPropagation(); setEditedNotes(prev => ({ ...prev, [key]: "" })); setActiveNoteKey(null); }} />
            </div>
          )}
          {(editedNotes[key] ?? p.note) && activeNoteKey !== key && (
            <div className="flex items-center gap-1 mt-0.5">
              <div className="text-xs font-bold text-amber-700 cursor-pointer" onClick={(e) => { e.stopPropagation(); setActiveNoteKey(key); }}>📝 {editedNotes[key] ?? p.note}</div>
              <Trash2 className="h-3 w-3 text-destructive/60 hover:text-destructive cursor-pointer shrink-0" onClick={(e) => { e.stopPropagation(); setEditedNotes(prev => ({ ...prev, [key]: "" })); }} />
            </div>
          )}
        </TableCell>
        {renderHistoryCell(p.parameterId, 0)}
        {renderHistoryCell(p.parameterId, 1)}
        <TableCell className="py-1.5 w-[180px]">
          {p.isCalculated ? (
            <div className="flex items-center gap-1">
              <Input value={currentValue} onChange={(e) => handleValueChange(regId, p.parameterId, e.target.value, entry)} className={`h-7 text-sm w-[120px] font-mono ${negCls}`} placeholder="Auto" />
              <Button type="button" variant="ghost" size="icon" className="h-7 w-7" title="Recalculate" onClick={() => { if (!p.calculationFormula) return; const paramValues: Record<string, string> = {}; entry.parameters.forEach((ep) => { paramValues[ep.parameterId] = editedValues[`${regId}||${ep.parameterId}`] ?? ep.resultValue ?? ""; }); const result = evaluateFormula(p.calculationFormula, paramValues); if (result) handleValueChange(regId, p.parameterId, result, entry); }}><Calculator className="h-3 w-3 text-primary" /></Button>
            </div>
          ) : p.rangeType === "time" ? (
            <TimeResultInput
              value={currentValue}
              onChange={(v) => handleValueChange(regId, p.parameterId, v, entry)}
              abnormal={flag === "H" || flag === "L" || flag === "A" || flag === "X"}
            />
          ) : p.rangeType === "qualitative" && getQualitativeOptions(p.expectedValue).length > 0 ? (
            <Select value={currentValue || undefined} onValueChange={(v) => handleValueChange(regId, p.parameterId, v, entry)}>
              <SelectTrigger className="h-7 text-sm !w-[180px] min-w-[180px] max-w-[180px]"><SelectValue placeholder="Select..." /></SelectTrigger>
              <SelectContent>{getQualitativeOptions(p.expectedValue).map((opt: string) => (<SelectItem key={opt} value={opt}>{opt}</SelectItem>))}</SelectContent>
            </Select>
          ) : p.rangeType === "descriptive" && p.descriptiveOptions.length > 0 ? (
            <DescriptiveCombobox
              value={currentValue}
              options={p.descriptiveOptions}
              onChange={(v) => handleValueChange(regId, p.parameterId, v, entry)}
              className="!w-[180px] min-w-[180px] max-w-[180px]"
            />
          ) : p.rangeType === "undefined" && p.descriptiveOptions.length > 0 ? (
            <DescriptiveCombobox
              value={currentValue}
              options={p.descriptiveOptions}
              onChange={(v) => handleValueChange(regId, p.parameterId, v, entry)}
              className="!w-[180px] min-w-[180px] max-w-[180px]"
            />
          ) : p.rangeType === "undefined" ? (
            <Input
              value={currentValue}
              onChange={e => handleValueChange(regId, p.parameterId, e.target.value, entry)}
              className={`h-7 text-sm w-[180px] ${negCls}`}
              placeholder="Enter result"
            />
          ) : (
            <Input
              value={currentValue}
              onChange={e => handleValueChange(regId, p.parameterId, e.target.value, entry)}
              className={`h-7 text-sm w-[180px] ${isNegative ? "border-red-500 ring-1 ring-red-300 text-red-700 font-semibold" : (flag === "H" || flag === "L" || flag === "A" || flag === "X" ? "border-destructive text-destructive font-bold" : "")}`}
              placeholder="Enter result"
            />
          )}
        </TableCell>
        <TableCell className="py-1.5 text-xs text-muted-foreground">
          {p.isOutsourced && !p.isSnipMode ? (
            <Input value={editedUnits[key] !== undefined ? editedUnits[key] : (p.unit || "")} onChange={e => setEditedUnits(prev => ({ ...prev, [key]: e.target.value }))} className="h-6 text-xs w-[70px]" placeholder="Unit" />
          ) : p.unit}
        </TableCell>
        <TableCell className="py-1.5 text-xs text-muted-foreground">
          {p.isOutsourced && !p.isSnipMode ? (
            <Input value={editedRefRanges[key] !== undefined ? editedRefRanges[key] : (p.referenceRange || "")} onChange={e => setEditedRefRanges(prev => ({ ...prev, [key]: e.target.value }))} className="h-6 text-xs w-[100px]" placeholder="Ref Range" />
          ) : p.referenceRange}
        </TableCell>
        <TableCell className="py-1.5 text-center">
          {p.isOutsourced && !p.isSnipMode ? (
            <Select value={flag || "none"} onValueChange={(v) => setEditedFlags(prev => ({ ...prev, [key]: v === "none" ? "" : v }))}>
              <SelectTrigger className="h-6 text-xs w-[80px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">—</SelectItem>
                <SelectItem value="N">Normal</SelectItem>
                <SelectItem value="H">HIGH</SelectItem>
                <SelectItem value="L">LOW</SelectItem>
              </SelectContent>
            </Select>
          ) : (
            <>
              {flag === "H" && <Badge variant="destructive" className="text-xs">HIGH</Badge>}
              {flag === "L" && <Badge variant="destructive" className="text-xs">LOW</Badge>}
              {flag === "N" && <Badge variant="secondary" className="text-xs text-green-700">Normal</Badge>}
              {!flag && currentValue && p.rangeType !== "undefined" && <Badge variant="outline" className="text-xs">—</Badge>}
            </>
          )}
        </TableCell>
        <TableCell className="py-1.5 text-center">
          {p.isOutsourced ? (
            p.isSnipMode && p.outsourceLabName ? (
              <Badge variant="outline" className="text-xs text-green-600 border-green-300 bg-green-50 whitespace-nowrap">{p.outsourceLabName}</Badge>
            ) : p.outsourceLabName ? (
              <Badge variant="outline" className="text-xs text-green-600 border-green-300 whitespace-nowrap">{p.outsourceLabName}</Badge>
            ) : (
              <Badge variant="outline" className="text-xs text-purple-600 border-purple-300">Outsourced</Badge>
            )
          ) : (
            <Badge variant="secondary" className="text-xs">Entered</Badge>
          )}
        </TableCell>
        <TableCell className="py-1.5 text-center">
          {p.isOutsourced && (() => {
            const snipDetail = outsourcedSnipDetails[`${regId}||${p.testId}`];
            if (snipDetail?.resultMode === "snip" && snipDetail.snipImageUrls.length > 0) {
              return (
                <Button size="sm" variant="ghost" className="h-5 px-1 text-xs text-blue-600 hover:text-blue-800 gap-0.5" onClick={() => setViewSnipImages(snipDetail.snipImageUrls)}>
                  <Eye className="h-3 w-3" /> View
                </Button>
              );
            }
            return null;
          })()}
        </TableCell>
      </TableRow>
    );
  };

  const renderPatientExpanded = (entry: PatientEntry) => {
    const reg = entry.registration;
    const machineGroups = groupByMachine(entry.parameters);

    return (
      <div className="space-y-3 p-3 bg-muted/20 rounded-lg border">
        <div className="flex items-center gap-3">
          <div>
            <span className="font-semibold">{reg.invoice_number}</span>
            {reg.status !== "sample_accepted" && reg.status !== "entered" && Array.isArray(reg.accepted_samples) && reg.accepted_samples.length > 0 && (
              <Badge className="bg-amber-100 text-amber-700 text-[10px] ml-1">PARTIAL</Badge>
            )}
            {reg.is_stat && (
              <span className="relative inline-flex h-2.5 w-2.5 ml-1.5 align-middle">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-destructive opacity-75" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-destructive" />
              </span>
            )}
            <span className="text-sm text-muted-foreground ml-2">{patientDisplayName(reg)}</span>
            <Badge variant="outline" className="text-[10px] font-mono ml-1">{formatAgeGender(reg.dob, reg.gender)}</Badge>
          </div>
        </div>

        {/* Snip-only outsourced tests */}
        {entry.snipOnlyTests.length > 0 && entry.snipOnlyTests.map(st => {
          const testKey = `${reg.id}||${st.testId}`;
          const isVerifying = verifyingKey === testKey;
          return (
            <div key={`snip-${st.testId}`} className="flex items-center justify-between px-3 py-2 bg-blue-50 border border-blue-200 rounded text-sm">
              <div className="flex items-center gap-2">
                <FlaskConical className="h-4 w-4 text-blue-600 shrink-0" />
                <span className="font-medium text-blue-800">{st.testName}</span>
                {st.labName && <Badge variant="outline" className="text-[10px] text-green-600 border-green-300">{st.labName}</Badge>}
                <Button size="sm" variant="ghost" className="h-5 px-1 text-xs text-blue-600 gap-0.5" onClick={() => setViewSnipImages(st.snipUrls)}>
                  <Eye className="h-3 w-3" /> View Snip ({st.snipUrls.length} page{st.snipUrls.length > 1 ? "s" : ""})
                </Button>
              </div>
              <div className="flex items-center gap-1">
                <Button size="sm" variant="ghost" className="h-6 text-[11px] gap-1 text-orange-600" onClick={() => sendBackTest(reg.id, st.testId, st.testName)}>
                  <Undo2 className="h-3 w-3" /> Send Back
                </Button>
                <Button size="sm" variant="outline" className="h-6 text-[11px] gap-1" disabled={isVerifying} onClick={() => handleVerifyTest(entry, st.testId, st.testName)}>
                  {isVerifying ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                  Verify & Send to Doctor
                </Button>
              </div>
            </div>
          );
        })}

        {machineGroups.map((mg) => (
          <div key={mg.machineName} className="space-y-1">
            <div className="text-xs font-semibold text-primary uppercase tracking-wider px-1 pt-2 border-b border-primary/20 pb-1 flex items-center gap-1.5">
              <Monitor className="h-3.5 w-3.5" /> {mg.machineName}
            </div>
            {groupByTest(mg.params).map((tg) => {
              const testKey = `${reg.id}||${tg.testId}`;
              const isVerifying = verifyingKey === testKey;
              return (
                <div key={tg.testId} className="ml-1">
                  <div className="flex items-center justify-between px-1 py-0.5 bg-muted/40 rounded-t">
                    <div className="flex items-center gap-2">
                      {(() => {
                        const hasNegative = tg.params.some(p => {
                          const k = `${reg.id}||${p.parameterId}`;
                          const v = editedValues[k] !== undefined ? editedValues[k] : p.resultValue;
                          return isSuspectNegativeResult(v);
                        });
                        return (
                          <>
                            <span className={`text-base font-bold ${hasNegative ? "text-red-600" : "text-foreground"}`}>{tg.testName}</span>
                            {hasNegative && (
                              <Badge className="text-[10px] bg-red-600 text-white hover:bg-red-700 gap-0.5">
                                <AlertTriangle className="h-3 w-3" /> Negative value — please verify
                              </Badge>
                            )}
                          </>
                        );
                      })()}
                      <StickyNote
                        className={`inline h-3.5 w-3.5 cursor-pointer shrink-0 ${getTestNote(reg.id, tg.testId) ? 'text-amber-600' : 'text-muted-foreground hover:text-primary'}`}
                        onClick={() => {
                          if (activeTestNoteKey === testKey) { setActiveTestNoteKey(null); }
                          else {
                            setActiveTestNoteKey(testKey);
                            const cur = getTestNote(reg.id, tg.testId);
                            if (!cur) setEditedTestNotes(prev => ({ ...prev, [testKey]: "Kindly correlate clinically" }));
                          }
                        }}
                      />
                    </div>
                    <div className="flex items-center gap-1">
                      <Button size="sm" variant="ghost" className="h-6 text-[11px] gap-1 text-orange-600" onClick={() => sendBackTest(reg.id, tg.testId, tg.testName)}>
                        <Undo2 className="h-3 w-3" /> Send Back
                      </Button>
                      <Button size="sm" variant="outline" className="h-6 text-[11px] gap-1" disabled={isVerifying} onClick={() => handleVerifyTest(entry, tg.testId, tg.testName)}>
                        {isVerifying ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                        Verify & Send to Doctor
                      </Button>
                    </div>
                  </div>
                  {activeTestNoteKey === testKey && (
                    <div className="flex items-center gap-1 mt-1 px-1">
                      <Input value={getTestNote(reg.id, tg.testId)} onChange={e => setEditedTestNotes(prev => ({ ...prev, [testKey]: e.target.value }))} className="h-6 text-xs w-full" placeholder="Kindly correlate clinically" autoFocus />
                      <Trash2 className="h-3.5 w-3.5 text-destructive cursor-pointer shrink-0" onClick={() => { setEditedTestNotes(prev => ({ ...prev, [testKey]: "" })); setActiveTestNoteKey(null); }} />
                    </div>
                  )}
                  {getTestNote(reg.id, tg.testId) && activeTestNoteKey !== testKey && (
                    <div className="flex items-center gap-1 mt-0.5 px-1">
                      <div className="text-xs font-bold text-amber-700 cursor-pointer" onClick={() => setActiveTestNoteKey(testKey)}>📝 {getTestNote(reg.id, tg.testId)}</div>
                      <Trash2 className="h-3 w-3 text-destructive/60 hover:text-destructive cursor-pointer shrink-0" onClick={() => setEditedTestNotes(prev => ({ ...prev, [testKey]: "" }))} />
                    </div>
                  )}
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="py-1 text-xs w-[80px]">Code</TableHead>
                        <TableHead className="py-1 text-xs">Parameter</TableHead>
                        <TableHead className="py-1 text-xs w-[100px]">Prev 1</TableHead>
                        <TableHead className="py-1 text-xs w-[100px]">Prev 2</TableHead>
                        <TableHead className="py-1 text-xs w-[200px]">Result</TableHead>
                        <TableHead className="py-1 text-xs w-[60px]">Unit</TableHead>
                        <TableHead className="py-1 text-xs w-[120px]">Ref. Range</TableHead>
                        <TableHead className="py-1 text-xs w-[70px] text-center">Flag</TableHead>
                        <TableHead className="py-1 text-xs w-[70px] text-center">Status</TableHead>
                        <TableHead className="py-1 text-xs w-[40px] text-center"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>{tg.params.map(p => renderParamRow(entry, p))}</TableBody>
                  </Table>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <SyncingOverlay target="verification" visibleIds={regIds} />
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search patient, invoice, mobile…" value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Tabs value={mode} onValueChange={v => setMode(v as any)} className="w-auto">
          <TabsList className="h-9">
            <TabsTrigger value="patient" className="text-xs gap-1 h-7"><User className="h-3.5 w-3.5" /> Patient Wise</TabsTrigger>
            <TabsTrigger value="machine" className="text-xs gap-1 h-7"><Monitor className="h-3.5 w-3.5" /> Machine Wise</TabsTrigger>
          </TabsList>
        </Tabs>
        {mode === "machine" && (
          <Select value={selectedMachine} onValueChange={setSelectedMachine}>
            <SelectTrigger className="w-[200px] h-9"><SelectValue placeholder="All Machines" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Machines</SelectItem>
              {(() => {
                const machines = new Set<string>();
                masterMachines.forEach((m: any) => machines.add(m.value));
                patientEntries.forEach(e => e.parameters.forEach(p => { if (p.machineName) machines.add(p.machineName); }));
                machines.add("Others");
                return Array.from(machines).sort((a, b) => a === "Others" ? 1 : b === "Others" ? -1 : a.localeCompare(b));
              })().map(m => (<SelectItem key={m} value={m === "Others" ? "others" : m}>{m}</SelectItem>))}
            </SelectContent>
          </Select>
        )}
        <RefreshButton
          queryKeys={["verification_regs_count", "verification_regs_v2", "verification_results_v2", "verification_tubes", "verification_outsourced_v2", "results_tests_map", "results_test_params_full", "results_normal_ranges"]}
          className="ml-auto shrink-0"
        />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">Patients Pending Verification</div>
          <div className="text-xl font-bold">{stats.totalPatients}</div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">Parameters to Verify</div>
          <div className="text-xl font-bold">{stats.totalParams}</div>
        </Card>
      </div>

      {(loadingIds || loadingRegs || (registrations.length > 0 && !resultsReady)) ? (
        <Card><CardContent className="p-8 text-center text-muted-foreground">Loading…</CardContent></Card>
      ) : filteredEntries.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <ClipboardCheck className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p className="text-lg font-medium">No results pending verification</p>
          <p className="text-sm">All entered results have been verified</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filteredEntries.map(entry => {
            const reg = entry.registration;
            const isExpanded = expandedPatient === reg.id;
            const isVerifying = verifyingKey === reg.id;
            return (
              <Card key={reg.id} className={isExpanded ? "ring-1 ring-primary/30" : ""}>
                <div className="flex items-center gap-3 p-3 cursor-pointer hover:bg-muted/30 transition-colors" onClick={() => { markArrivalSeen(reg.id); setExpandedPatient(isExpanded ? null : reg.id); }}>
                  {isExpanded ? <ChevronUp className="h-4 w-4 shrink-0" /> : <ChevronDown className="h-4 w-4 shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium font-mono">{reg.invoice_number}</span>
                      <NewBadge show={isNewArrival(reg.id)} />
                      {reg.status !== "sample_accepted" && reg.status !== "entered" && Array.isArray(reg.accepted_samples) && reg.accepted_samples.length > 0 && (
                        <Badge className="bg-amber-100 text-amber-700 text-[10px]">PARTIAL</Badge>
                      )}
                      {reg.is_stat && (
                        <span className="relative inline-flex h-2.5 w-2.5">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-destructive opacity-75" />
                          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-destructive" />
                        </span>
                      )}
                        <span className="text-sm text-muted-foreground">{patientDisplayName(reg)}</span>
                        <Badge variant="outline" className="text-[10px] font-mono">{formatAgeGender(reg.dob, reg.gender)}</Badge>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {reg.mobile_number} • {entry.parameters.length} parameters to verify
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs gap-1"
                      title="Preview provisional report"
                      onClick={(e) => {
                        e.stopPropagation();
                        // Open in a new tab so Verification stays mounted — navigating away
                        // and Back remounts the list and briefly drops every patient.
                        window.open(`/lims/report/${reg.id}?provisional=1`, "_blank", "noopener,noreferrer");
                      }}
                    >
                      <Eye className="h-3.5 w-3.5 mr-1" /> View Report
                    </Button>
                    <Button size="sm" variant="default" className="h-7 text-xs" disabled={isVerifying} onClick={(e) => { e.stopPropagation(); handleVerifyAll(entry); }}>
                      {isVerifying ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <CheckCircle2 className="h-3.5 w-3.5 mr-1" />}
                      Verify All
                    </Button>
                  </div>
                </div>
                {isExpanded && (
                  <CardContent className="pt-0 pb-3 px-3">
                    {renderPatientExpanded(entry)}
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* Blank values dialog */}
      <Dialog open={!!blankConfirmTestParams} onOpenChange={open => { if (!open) setBlankConfirmTestParams(null); }}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-lg">
              Blank Result Values — {blankConfirmTestParams?.testName}
            </DialogTitle>
            <p className="text-sm text-muted-foreground mt-1">
              {blankParamCount} parameter{blankParamCount !== 1 ? "s have" : " has"} blank values. You can fill them below or send to Doctor Approval as-is.
            </p>
          </DialogHeader>
          {blankConfirmTestParams && (() => {
            const { entry, testId } = blankConfirmTestParams;
            const reg = entry.registration;
            const isAll = testId === "__all__";
            const relevantParams = isAll
              ? entry.parameters.filter(p => !p.isCalculated)
              : entry.parameters.filter(p => p.testId === testId && !p.isCalculated);
            const blankParams = relevantParams.filter(p => blankParamIds.has(p.parameterId));
            return (
              <div className="border rounded-lg overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="py-2 text-xs w-[80px]">Code</TableHead>
                      <TableHead className="py-2 text-xs">Parameter</TableHead>
                      <TableHead className="py-2 text-xs w-[180px]">Result</TableHead>
                      <TableHead className="py-2 text-xs w-[80px]">Unit</TableHead>
                      <TableHead className="py-2 text-xs w-[120px]">Ref. Range</TableHead>
                      <TableHead className="py-2 text-xs w-[80px] text-center">Flag</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {blankParams.map(p => {
                      const key = `${reg.id}||${p.parameterId}`;
                      const currentValue = editedValues[key] !== undefined ? editedValues[key] : p.resultValue;
                      const flag = calculateFlag(currentValue, p.normalRangeLow, p.normalRangeHigh, p.rangeType, p.expectedValue, p.descriptiveOptions, p.normalRangeText, p.unit, p.normalFindings);
                      return (
                        <TableRow key={key} className="bg-yellow-50">
                          <TableCell className="py-2 text-xs font-mono text-muted-foreground">{p.paramCode}</TableCell>
                          <TableCell className="py-2 text-sm font-medium">{p.parameterName}</TableCell>
                          <TableCell className="py-2">
                            {p.rangeType === "time" ? (
                              <TimeResultInput
                                value={currentValue}
                                onChange={(v) => handleValueChange(reg.id, p.parameterId, v, entry)}
                              />
                            ) : p.rangeType === "qualitative" && getQualitativeOptions(p.expectedValue).length > 0 ? (
                              <Select value={currentValue || undefined} onValueChange={(v) => handleValueChange(reg.id, p.parameterId, v, entry)}>
                                <SelectTrigger className="h-7 text-sm w-full"><SelectValue placeholder="Select..." /></SelectTrigger>
                                <SelectContent>{getQualitativeOptions(p.expectedValue).map((opt: string) => (<SelectItem key={opt} value={opt}>{opt}</SelectItem>))}</SelectContent>
                              </Select>
                            ) : p.rangeType === "descriptive" && p.descriptiveOptions.length > 0 ? (
                              <DescriptiveCombobox
                                value={currentValue}
                                options={p.descriptiveOptions}
                                onChange={(v) => handleValueChange(reg.id, p.parameterId, v, entry)}
                                className="w-full"
                              />
                            ) : p.rangeType === "undefined" && p.descriptiveOptions.length > 0 ? (
                              <DescriptiveCombobox
                                value={currentValue}
                                options={p.descriptiveOptions}
                                onChange={(v) => handleValueChange(reg.id, p.parameterId, v, entry)}
                                className="w-full"
                              />
                            ) : (
                              <Input value={currentValue} onChange={e => handleValueChange(reg.id, p.parameterId, e.target.value, entry)} className="h-7 text-sm w-full" placeholder="Enter result" />
                            )}
                          </TableCell>
                          <TableCell className="py-2 text-xs text-muted-foreground">
                            {p.isOutsourced ? (
                              <Input value={editedUnits[key] !== undefined ? editedUnits[key] : (p.unit || "")} onChange={e => setEditedUnits(prev => ({ ...prev, [key]: e.target.value }))} className="h-6 text-xs w-[70px]" placeholder="Unit" />
                            ) : p.unit}
                          </TableCell>
                          <TableCell className="py-2 text-xs text-muted-foreground">
                            {p.isOutsourced ? (
                              <Input value={editedRefRanges[key] !== undefined ? editedRefRanges[key] : (p.referenceRange || "")} onChange={e => setEditedRefRanges(prev => ({ ...prev, [key]: e.target.value }))} className="h-6 text-xs w-[100px]" placeholder="Ref Range" />
                            ) : p.referenceRange}
                          </TableCell>
                          <TableCell className="py-2 text-center">
                            {flag === "H" && <Badge variant="destructive" className="text-xs">HIGH</Badge>}
                            {flag === "L" && <Badge variant="destructive" className="text-xs">LOW</Badge>}
                            {!flag && p.rangeType !== "undefined" && <Badge variant="outline" className="text-xs">—</Badge>}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            );
          })()}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setBlankConfirmTestParams(null)}>Cancel & Review</Button>
            <Button onClick={() => {
              if (blankConfirmTestParams) {
                const { entry, testId, testName } = blankConfirmTestParams;
                setBlankConfirmTestParams(null);
                setHighlightBlanksForRegs(prev => { const next = new Set(prev); next.delete(`${entry.registration.id}||${testId}`); return next; });
                if (testId === "__all__") {
                  const testIds = [...new Set(entry.parameters.map(p => p.testId))];
                  const issues: { testName: string; sum: number; diff: number }[] = [];
                  for (const tid of testIds) {
                    const issue = computeDiffIssue(entry, tid);
                    if (issue) {
                      const tName = entry.parameters.find(p => p.testId === tid)?.testName || "Test";
                      issues.push({ testName: tName, sum: issue.sum, diff: issue.diff });
                    }
                  }
                  if (issues.length > 0) {
                    setDiffConfirm({ entry, mode: "all", testId: "__all__", testName: "All Tests", issues });
                    return;
                  }
                  verifyAllForPatient(entry);
                } else {
                  const issue = computeDiffIssue(entry, testId);
                  if (issue) {
                    setDiffConfirm({ entry, mode: "test", testId, testName, issues: [{ testName, sum: issue.sum, diff: issue.diff }] });
                    return;
                  }
                  verifyTest(entry, testId, testName);
                }
              }
            }}>
              <SendHorizonal className="h-4 w-4 mr-1" />
              Send to Doctor Approval
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* Differential count mismatch dialog */}
      <AlertDialog open={!!diffConfirm} onOpenChange={(open) => { if (!open) setDiffConfirm(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Differential Count Mismatch</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                {diffConfirm?.issues.map((i, idx) => (
                  <div key={idx} className="border-l-2 border-destructive pl-2">
                    <div><span className="font-medium">Test:</span> {i.testName}</div>
                    <div><span className="font-medium">Current sum:</span> {i.sum}</div>
                    <div>
                      <span className="font-medium">Difference to 100:</span>{" "}
                      <span className="text-destructive font-semibold">{i.diff}</span>{" "}
                      <span className="text-muted-foreground">({i.diff > 0 ? "less" : i.diff < 0 ? "more" : "exact"})</span>
                    </div>
                  </div>
                ))}
                <div className="text-muted-foreground pt-1">The sum of WBC differential parameters should be exactly 100. You can continue anyway.</div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => {
              if (diffConfirm) {
                const { entry, mode, testId, testName } = diffConfirm;
                setDiffConfirm(null);
                if (mode === "all") verifyAllForPatient(entry);
                else verifyTest(entry, testId, testName);
              }
            }}>Continue Anyway</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Snip Image Viewer */}
      <Dialog open={!!viewSnipImages} onOpenChange={open => { if (!open) setViewSnipImages(null); }}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Outsourced Result — Snipped Images</DialogTitle></DialogHeader>
          <div className="space-y-4">
            {viewSnipImages?.map((url, idx) => (
              <div key={idx} className="border rounded-lg overflow-hidden">
                <img src={url} alt={`Snip page ${idx + 1}`} className="w-full object-contain" />
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
      {rvTotalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <Button variant="outline" size="sm" disabled={rvPage === 0} onClick={() => setRvPage(p => p - 1)}>Prev</Button>
          <span className="text-sm text-muted-foreground">Page {rvPage + 1} of {rvTotalPages} ({rvCount} total)</span>
          <Button variant="outline" size="sm" disabled={rvPage >= rvTotalPages - 1} onClick={() => setRvPage(p => p + 1)}>Next</Button>
        </div>
      )}
    </div>
  );
};

export default ResultVerification;
