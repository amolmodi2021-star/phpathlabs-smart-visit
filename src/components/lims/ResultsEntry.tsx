import RefreshButton from "@/components/lims/RefreshButton";
import PageSizeSelect from "@/components/lims/PageSizeSelect";
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Search, User, Monitor, Save, Calculator, Wifi, WifiOff, ChevronDown, ChevronUp, Check, Loader2, FlaskConical, Package, SendHorizonal, ArrowRightLeft, Eye, Trash2, StickyNote, RefreshCw, AlertTriangle, Image, Keyboard } from "lucide-react";
import { DescriptiveCombobox } from "./DescriptiveCombobox";
import TimeResultInput from "./TimeResultInput";
import { parseTimeResultToSeconds } from "@/lib/timeRange";
import { useMasterLookup } from "@/hooks/useMasterLookup";
import { checkDifferentialSum } from "@/lib/differentialCount";

import { useNewArrivalsBadge } from "@/hooks/useNewArrivalsBadge";
import { signalSync } from "@/lib/limsSyncSignal";
import { propagateRegistrationChange } from "@/lib/limsPropagation";
import { isResultPastPending, resolveResultForResultsEntry, healOrphanPatientResults, restoreMissingApprovedFromReports } from "@/lib/patientResultLookup";
import { fetchResultsEntryCandidateIds, fetchFilteredSortedIds } from "@/lib/limsPendingCandidates";
import { shortIdsKey } from "@/lib/queryKeys";
import { readLimsPageSize, type LimsPageSize } from "@/lib/limsListPrefs";
import SyncingOverlay from "./SyncingOverlay";
import NewBadge from "./NewBadge";
import OutsourcedResults from "./OutsourcedResults";
import SnipOnLetterhead from "./SnipOnLetterhead";
import { format } from "date-fns";
import { toast } from "sonner";
import { formatDateDDMMYYYY } from "@/lib/utils";
import { expandRegistrationTests } from "@/lib/expandRegistrationTests";
import { fetchAllByIds } from "@/lib/fetchAllRows";
import { PATIENT_RESULTS_SELECT_RESULTS } from "@/lib/patientResultsSelect";
import { isSnipResultDetail, appendOutsourcedSnipImage, clearTypedOutsourcedResults } from "@/lib/outsourcedResultMode";

/** List headers — omit tests / cancelled_tests JSON (egress). */
const REG_LIST_SELECT =
  "id, invoice_number, patient_name, title, mobile_number, umr_number, status, is_stat, visit_type, gender, dob, created_at, updated_at, bill_cancelled, doctor_name";

/** Expand — include test payloads needed to build parameter grids. */
const REG_DETAIL_SELECT = `${REG_LIST_SELECT}, tests, cancelled_tests`;

const QUALITATIVE_PAIRS = [
  { label: "Absent / Present", values: ["Absent", "Present"] },
  { label: "Reactive / Non Reactive", values: ["Reactive", "Non Reactive"] },
  { label: "Positive / Negative", values: ["Positive", "Negative"] },
];

const getQualitativeOptions = (expectedValue: string): string[] => {
  const pair = QUALITATIVE_PAIRS.find(p => p.label === expectedValue);
  if (pair) return pair.values;
  // Fallback: check if expectedValue matches any individual value
  for (const p of QUALITATIVE_PAIRS) {
    if (p.values.some(v => v.toLowerCase() === expectedValue.toLowerCase())) return p.values;
  }
  return [];
};


// ─── Types ───
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
  status: string; // pending | entered | verified
  testId: string;
  testName: string;
  departmentId: string;
  machineName: string;
  displayOrder: number;
  rangeType: string; // numeric | qualitative | descriptive
  descriptiveOptions: string[];
  expectedValue: string;
  normalFindings: string;
  normalRangeText: string;
  isOutsourced: boolean; // true if this param is outsourced (test-level or param-level)
  outsourceLabName: string | null; // lab name if sent
  outsourceStatus: string; // pending | sent | results_entered
  isSnipMode: boolean; // true if results were added via snip/image
  note: string;
}

interface IncompleteTest {
  testId: string;
  testName: string;
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
  incompleteTests: IncompleteTest[];
  snipOnlyTests: SnipOnlyTest[];
}

const handleResultTabKey = (e: React.KeyboardEvent) => {
  if (e.key !== "Tab") return;
  e.preventDefault();
  const allInputs = Array.from(document.querySelectorAll<HTMLElement>("[data-result-input]"));
  if (allInputs.length === 0) return;
  const currentIdx = allInputs.indexOf(e.currentTarget as HTMLElement);
  const direction = e.shiftKey ? -1 : 1;
  const len = allInputs.length;
  for (let i = 1; i <= len; i++) {
    const nextIdx = (currentIdx + i * direction + len) % len;
    const el = allInputs[nextIdx];
    const val = (el as HTMLInputElement).value ?? el.getAttribute("data-result-value") ?? "";
    if (!val || val.trim() === "") {
      el.focus();
      return;
    }
  }
  // No blank found — just move to next
  const nextIdx = (currentIdx + direction + len) % len;
  allInputs[nextIdx]?.focus();
};

const ResultsEntry = () => {
  const qc = useQueryClient();
  const { data: masterMachines = [] } = useMasterLookup("machine_name");
  const [mode, setMode] = useState<"patient" | "machine" | "outsourced">("patient");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedMachine, setSelectedMachine] = useState<string>("all");
  const [pageSize, setPageSize] = useState<LimsPageSize>(() => readLimsPageSize());
  const [expandedPatient, setExpandedPatient] = useState<string | null>(null);
  const [expandedTests, setExpandedTests] = useState<Set<string>>(new Set());
  const [snipEntryKeys, setSnipEntryKeys] = useState<Set<string>>(new Set());
  const [uploadingSnipKey, setUploadingSnipKey] = useState<string | null>(null);
  const [savingSnipKey, setSavingSnipKey] = useState<string | null>(null);
  const [snipModeConfirm, setSnipModeConfirm] = useState<{
    regId: string; testId: string; testName: string; paramIds?: string[]; target: "snip" | "manual";
  } | null>(null);
  const [editedValues, setEditedValues] = useState<Record<string, string>>({});
  const [editedUnits, setEditedUnits] = useState<Record<string, string>>({});
  const [editedRefRanges, setEditedRefRanges] = useState<Record<string, string>>({});
  const [editedNotes, setEditedNotes] = useState<Record<string, string>>({});
  const editedNotesRef = useRef<Record<string, string>>({});
  const [activeNoteKey, setActiveNoteKey] = useState<string | null>(null);
  const [editedTestNotes, setEditedTestNotes] = useState<Record<string, string>>({});
  const editedTestNotesRef = useRef<Record<string, string>>({});
  const [activeTestNoteKey, setActiveTestNoteKey] = useState<string | null>(null);
  const [editedFlags, setEditedFlags] = useState<Record<string, string>>({});
  const [blankParamCount, setBlankParamCount] = useState(0);
  const [highlightBlanksForRegs, setHighlightBlanksForRegs] = useState<Set<string>>(new Set());
  const autoSaveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  useEffect(() => { editedNotesRef.current = editedNotes; }, [editedNotes]);
  useEffect(() => { editedTestNotesRef.current = editedTestNotes; }, [editedTestNotes]);
  useEffect(() => {
    return () => {
      Object.values(autoSaveTimers.current).forEach(clearTimeout);
      autoSaveTimers.current = {};
    };
  }, []);
  const [rePage, setRePage] = useState(0);
  const [refreshingRegId, setRefreshingRegId] = useState<string | null>(null);

  const handleRefreshFromLims = useCallback(async (regId: string) => {
    if (refreshingRegId) return;
    setRefreshingRegId(regId);
    try {
      const { data, error } = await supabase.functions.invoke("lims-interface", {
        body: { action: "reprocess", registration_id: regId },
      });
      if (error) throw error;
      const pushed = (data as any)?.pushed ?? 0;
      if (pushed > 0) {
        toast.success(`Pulled ${pushed} new result${pushed > 1 ? "s" : ""} from LIMS`);
      } else {
        toast.info("No new results available");
      }
      qc.invalidateQueries({ queryKey: ["patient_results_existing"] });
    } catch (err: any) {
      toast.error(err?.message || "Failed to refresh from LIMS");
    } finally {
      setRefreshingRegId(null);
    }
  }, [qc, refreshingRegId]);

  useEffect(() => {
    const t = setTimeout(() => { setDebouncedSearch(search); setRePage(0); }, 400);
    return () => clearTimeout(t);
  }, [search]);

  // Reset page + collapse when switching patient/machine mode or machine filter
  useEffect(() => {
    setRePage(0);
    setExpandedPatient(null);
  }, [mode, selectedMachine]);

  const { data: pendingIds = [] as string[], isLoading: loadingIds } = useQuery({
    queryKey: ["results_accepted_count", debouncedSearch],
    queryFn: async (): Promise<string[]> => {
      const candidates = await fetchResultsEntryCandidateIds();
      return await fetchFilteredSortedIds(candidates, debouncedSearch);
    },
    placeholderData: keepPreviousData,
    staleTime: 120_000,
  });

  // Analyzer writes emit tiny lims_result_notify rows. Revalidate only the
  // affected expanded patient and the lightweight queue membership query.
  useLimsPipelineRealtime("results", 750, {
    expandedRegistrationId: expandedPatient,
    candidateRegistrationIds: pendingIds,
  });

  const machineFilterActive = mode === "machine" && selectedMachine !== "all";

  // Lean instrument map for machine-wise list filtering (no params until expand)
  const { data: testsInstrumentMap = {} as Record<string, string> } = useQuery({
    queryKey: ["results_tests_instrument_map"],
    enabled: mode === "machine",
    queryFn: async () => {
      const { data } = await supabase.from("tests").select("id, instrument_name");
      const map: Record<string, string> = {};
      (data || []).forEach((t: any) => {
        map[t.id] = String(t.instrument_name || "").trim();
      });
      return map;
    },
    staleTime: 600_000,
  });

  // Among Results candidates, keep only regs with accepted-tube tests for the selected machine
  const pendingIdsKey = shortIdsKey(pendingIds, "re-c");
  const { data: machineFilteredIds = [] as string[], isLoading: loadingMachineFilter } = useQuery({
    queryKey: ["results_machine_filtered_ids", pendingIdsKey, selectedMachine],
    enabled: machineFilterActive && pendingIds.length > 0 && Object.keys(testsInstrumentMap).length > 0,
    queryFn: async (): Promise<string[]> => {
      const want = selectedMachine === "others" ? "" : selectedMachine;
      const machineTestIds = new Set(
        Object.entries(testsInstrumentMap)
          .filter(([, inst]) => inst === want)
          .map(([id]) => id),
      );
      if (machineTestIds.size === 0) return [];

      const tubes = await fetchAllByIds<any>(
        "sample_tubes",
        "registration_id, test_ids",
        "registration_id",
        pendingIds,
        { eq: { status: "accepted" } },
      );
      const match = new Set<string>();
      for (const tube of tubes) {
        const ids = Array.isArray(tube.test_ids) ? tube.test_ids : [];
        if (ids.some((id: string) => id && machineTestIds.has(id))) {
          match.add(tube.registration_id);
        }
      }
      return pendingIds.filter((id) => match.has(id));
    },
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });

  const displayIds = machineFilterActive ? machineFilteredIds : pendingIds;
  const reCount = displayIds.length;
  const pageIds: string[] = displayIds.slice(rePage * pageSize, (rePage + 1) * pageSize);
  const pageKey = shortIdsKey(pageIds, "re");

  // ─── Fetch accepted registrations (list headers — page only) ───
  const { data: acceptedRegs = [], isLoading: loadingRegs } = useQuery({
    queryKey: ["results_accepted_regs", pageKey],
    enabled: pageIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("patient_registrations")
        .select(REG_LIST_SELECT)
        .in("id", pageIds);
      if (error) throw error;
      const order = new Map(pageIds.map((id, i) => [id, i] as const));
      return ((data || []) as any[]).sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
    },
    placeholderData: keepPreviousData,
    staleTime: 120_000,
  });

  const listLoading =
    loadingIds ||
    (pageIds.length > 0 && loadingRegs) ||
    (machineFilterActive && (loadingMachineFilter || Object.keys(testsInstrumentMap).length === 0));

  const reTotalPages = Math.max(1, Math.ceil(reCount / pageSize));
  const regIds = acceptedRegs.map((r: any) => r.id);

  // Detail scope — gate masters + heavy fetches on expand (egress)
  const detailRegIds = expandedPatient ? [expandedPatient] : [];
  const detailKey = shortIdsKey(detailRegIds, "re-d");
  const detailEnabled = !!expandedPatient;

  // ─── Masters only after expand (cached; shared across Results/Verify/Doctor) ───
  const { data: testsMap = {} } = useQuery({
    queryKey: ["results_tests_map"],
    enabled: detailEnabled,
    queryFn: async () => {
      const { data } = await supabase.from("tests").select("id, test_name, department_id, instrument_name");
      const map: Record<string, any> = {};
      (data || []).forEach((t: any) => { map[t.id] = t; });
      return map;
    },
    staleTime: 600_000,
  });

  const { data: testParamsMap = {} } = useQuery({
    queryKey: ["results_test_params_full"],
    enabled: detailEnabled,
    queryFn: async () => {
      const { data } = await supabase
        .from("test_parameters")
        .select("test_id, parameter_id, display_order, is_subheader, subheader_text, report_test_parameters(id, param_code, parameter_name, parameter_description, unit, normal_range_low, normal_range_high, normal_range_text, is_calculated, calculation_formula, send_for_interface)")
        .order("display_order");
      const map: Record<string, any[]> = {};
      (data || []).forEach((tp: any) => {
        if (!tp.test_id) return;
        if (!map[tp.test_id]) map[tp.test_id] = [];
        map[tp.test_id].push(tp);
      });
      return map;
    },
    staleTime: 600_000,
  });

  const { data: normalRangesMap = {} } = useQuery({
    queryKey: ["results_normal_ranges"],
    enabled: detailEnabled,
    queryFn: async () => {
      const { data } = await supabase
        .from("parameter_normal_ranges")
        .select("*")
        .order("age_min");
      const map: Record<string, any[]> = {};
      (data || []).forEach((r: any) => {
        if (!map[r.parameter_id]) map[r.parameter_id] = [];
        map[r.parameter_id].push(r);
      });
      return map;
    },
    staleTime: 600_000,
  });

  // Registration tests JSON — only for expanded patient
  const { data: detailReg, isFetched: detailRegFetched } = useQuery({
    queryKey: ["results_reg_detail", expandedPatient],
    enabled: detailEnabled,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("patient_registrations")
        .select(REG_DETAIL_SELECT)
        .eq("id", expandedPatient!)
        .maybeSingle();
      if (error) throw error;
      return data as any;
    },
    staleTime: 60_000,
  });

  // ─── Detail fetches ONLY for expanded patient (egress) ───

  const { data: existingResults = [], isFetched: resultsFetched } = useQuery({
    queryKey: ["patient_results_existing", detailKey],
    enabled: detailEnabled,
    queryFn: async () => {
      const regIds = detailRegIds;
      // Paginated to avoid Supabase's 1000-row cap silently dropping rows.
      const rows = await fetchAllByIds<any>("patient_results", PATIENT_RESULTS_SELECT_RESULTS, "registration_id", regIds);

      // Heal orphan interface rows (written under wrong/non-tube test_ids) onto
      // the accepted-tube tests that actually own those parameters. Fixes cases
      // like TFT approved but TSH stuck under PCOD PROFILE → still in Results.
      try {
        const tubes = await fetchAllByIds<any>(
          "sample_tubes",
          "registration_id, test_ids",
          "registration_id",
          regIds,
          { eq: { status: "accepted" } },
        );
        const acceptedByReg: Record<string, Set<string>> = {};
        for (const tube of tubes) {
          if (!acceptedByReg[tube.registration_id]) acceptedByReg[tube.registration_id] = new Set();
          for (const id of (Array.isArray(tube.test_ids) ? tube.test_ids : [])) {
            if (id) acceptedByReg[tube.registration_id].add(id);
          }
        }
        for (const regId of regIds) {
          const accepted = acceptedByReg[regId];
          if (!accepted || accepted.size === 0) continue;
          await healOrphanPatientResults(supabase, regId, accepted, rows);
        }
        // If a param was already approved into approved_reports but its live
        // patient_results row was wiped, recreate it so Results stops looping
        // empty Iron / Triglycerides / etc.
        await restoreMissingApprovedFromReports(supabase, regIds, rows);
      } catch (e) {
        // Non-fatal — Results Entry still works with sibling-coverage lookup
        console.error("[results] orphan heal failed", e);
      }

      return rows;
    },
  });

  // ─── Fetch accepted sample_tubes for expanded patient only ───
  const { data: acceptedTubes = [], isFetched: tubesFetched } = useQuery({
    queryKey: ["results_accepted_tubes", detailKey],
    enabled: detailEnabled,
    queryFn: async () => {
      return await fetchAllByIds<any>(
        "sample_tubes",
        "id, registration_id, test_ids",
        "registration_id",
        detailRegIds,
        { eq: { status: "accepted" } },
      );
    },
  });

  // Build set of accepted test_ids per registration
  const acceptedTestIdsByReg = useMemo(() => {
    const map: Record<string, Set<string>> = {};
    for (const tube of acceptedTubes) {
      if (!map[tube.registration_id]) map[tube.registration_id] = new Set();
      const ids = Array.isArray(tube.test_ids) ? tube.test_ids : [];
      ids.forEach((id: string) => map[tube.registration_id].add(id));
    }
    return map;
  }, [acceptedTubes]);
  // Apply tube filter only after expanded patient's tube query has completed once.
  const tubesReady = !detailEnabled || tubesFetched;
  const detailReady = !detailEnabled || (resultsFetched && tubesFetched && detailRegFetched && !!detailReg);

  // ─── Fetch outsourced_test_snips for expanded patient only ───
  const { data: outsourcedSnips = [] } = useQuery({
    queryKey: ["results_outsourced_snips", detailKey],
    enabled: detailEnabled,
    queryFn: async () => {
      return await fetchAllByIds<any>("outsourced_test_snips", "registration_id, test_id, outsourced_parameter_ids, outsource_status, outsourced_lab_name, sent_at, result_mode, snip_image_urls", "registration_id", detailRegIds);
    },
  });

  // Build lookup: test-level outsourced keys and parameter-level outsourced sets, plus status/lab info
  const { transferredTestKeys, outsourcedParamSets, outsourcedSnipDetails } = useMemo(() => {
    const testKeys = new Set<string>();
    const paramSets: Record<string, Set<string>> = {};
    const details: Record<string, { status: string; labName: string | null; sentAt: string | null; resultMode: string; snipImageUrls: string[] }> = {};
    outsourcedSnips.forEach((s: any) => {
      const key = `${s.registration_id}||${s.test_id}`;
      const urls = Array.isArray(s.snip_image_urls) ? s.snip_image_urls : [];
      details[key] = { status: s.outsource_status || "pending", labName: s.outsourced_lab_name || null, sentAt: s.sent_at || null, resultMode: s.result_mode || "manual", snipImageUrls: urls };
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

  // ─── Fetch historical results for expanded patient (prev 1 & prev 2) ───
  const expandedUmr = useMemo(() => {
    if (!expandedPatient) return null;
    const reg = acceptedRegs.find((r: any) => r.id === expandedPatient);
    return reg?.umr_number || null;
  }, [expandedPatient, acceptedRegs]);

  const { data: historicalResults = [] } = useQuery({
    queryKey: ["historical_results", expandedUmr, expandedPatient],
    enabled: !!expandedUmr && !!expandedPatient,
    queryFn: async () => {
      // First get all registration IDs for same UMR
      const { data: sameUmrRegs } = await supabase
        .from("patient_registrations")
        .select("id")
        .eq("umr_number", expandedUmr!)
        .neq("id", expandedPatient!);
      const regIds = (sameUmrRegs || []).map((r: any) => r.id);
      if (regIds.length === 0) return [];
      const { data, error } = await supabase
        .from("patient_results")
        .select("parameter_id, result_value, reference_range, created_at, test_id, registration_id")
        .in("registration_id", regIds)
        .not("result_value", "is", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      // Fetch snip records to tag snip-mode results
      const { data: snips } = await supabase
        .from("outsourced_test_snips")
        .select("registration_id, test_id, result_mode, outsourced_parameter_ids, snip_image_urls")
        .in("registration_id", regIds)
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
      // Tag each result with snip info
      return (data || []).map((r: any) => {
        const fullKey = `${r.registration_id}||${r.test_id}||__full__`;
        const paramKey = `${r.registration_id}||${r.test_id}||${r.parameter_id}`;
        const snipUrls = snipInfoMap[paramKey] || snipInfoMap[fullKey] || null;
        return { ...r, snipImageUrls: snipUrls };
      });
    },
  });

  // Build history map: parameterId → [{ resultValue, referenceRange, createdAt, snipImageUrls }] (max 2)
  const historyMap = useMemo(() => {
    const map: Record<string, { resultValue: string; referenceRange: string; createdAt: string; snipImageUrls: string[] | null }[]> = {};
    for (const r of historicalResults) {
      if (!r.parameter_id) continue;
      if (!map[r.parameter_id]) map[r.parameter_id] = [];
      if (map[r.parameter_id].length < 2) {
        map[r.parameter_id].push({
          resultValue: r.result_value || "",
          referenceRange: r.reference_range || "",
          createdAt: r.created_at || "",
          snipImageUrls: r.snipImageUrls || null,
        });
      }
    }
    return map;
  }, [historicalResults]);

  // ─── Snip image viewer state ───
  const [viewSnipImages, setViewSnipImages] = useState<string[] | null>(null);
  const [viewSnipContext, setViewSnipContext] = useState<{ regId: string; testId: string } | null>(null);
  const [removingSnip, setRemovingSnip] = useState(false);

  const removeSnipImages = async () => {
    if (!viewSnipContext) return;
    const { regId, testId } = viewSnipContext;
    const snipKey = `${regId}||${testId}`;
    setRemovingSnip(true);
    try {
      const { error: snipError } = await supabase.from("outsourced_test_snips").update({
        snip_image_url: null,
        snip_image_urls: [],
        result_mode: "manual",
        outsource_status: "sent",
      } as any).eq("registration_id", regId).eq("test_id", testId);
      if (snipError) throw snipError;

      const outsourcedParams = outsourcedParamSets[snipKey];
      if (outsourcedParams && outsourcedParams.size > 0) {
        const { error: resultsError } = await supabase
          .from("patient_results")
          .delete()
          .eq("registration_id", regId)
          .eq("test_id", testId)
          .in("parameter_id", Array.from(outsourcedParams));
        if (resultsError) throw resultsError;
      } else if (transferredTestKeys.has(snipKey)) {
        const { error: resultsError } = await supabase
          .from("patient_results")
          .delete()
          .eq("registration_id", regId)
          .eq("test_id", testId);
        if (resultsError) throw resultsError;
      }

      toast.success("Snipped images removed");
      setViewSnipImages(null);
      setViewSnipContext(null);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["outsourced_snips"] }),
        qc.invalidateQueries({ queryKey: ["results_outsourced_snips"] }),
        qc.invalidateQueries({ queryKey: ["outsourced_manual_results"] }),
        qc.invalidateQueries({ queryKey: ["outsourced_accepted_regs"] }),
        qc.invalidateQueries({ queryKey: ["patient_results_existing"] }),
        qc.invalidateQueries({ queryKey: ["verification_results"] }),
        qc.invalidateQueries({ queryKey: ["verification_outsourced"] }),
      ]);
    } catch (e: any) {
      toast.error("Failed to remove: " + e.message);
    } finally {
      setRemovingSnip(false);
    }
  };

  // ─── Transfer to outsourced state ───
  const [transferringKey, setTransferringKey] = useState<string | null>(null);

  // Transfer entire test to outsourced
  const transferToOutsourced = async (regId: string, testId: string, testName: string) => {
    const key = `${regId}||${testId}`;
    setTransferringKey(key);
    try {
      await supabase.from("outsourced_test_snips").upsert({
        registration_id: regId,
        test_id: testId,
        outsource_status: "pending",
        result_mode: "manual",
        outsourced_parameter_ids: null,
      } as any, { onConflict: "registration_id,test_id" });
      await supabase.from("patient_results").delete().eq("registration_id", regId).eq("test_id", testId);
      toast.success(`${testName} transferred to Outsourced`);
      qc.invalidateQueries({ queryKey: ["results_outsourced_snips"] });
      qc.invalidateQueries({ queryKey: ["outsourced_snips"] });
      qc.invalidateQueries({ queryKey: ["outsourced_accepted_regs"] });
      qc.invalidateQueries({ queryKey: ["patient_results_existing"] });
    } catch (err: any) {
      toast.error(err.message || "Transfer failed");
    } finally {
      setTransferringKey(null);
    }
  };

  // Transfer individual parameter to outsourced
  const transferParamToOutsourced = async (regId: string, testId: string, paramId: string, paramName: string) => {
    const key = `${regId}||${paramId}`;
    setTransferringKey(key);
    try {
      const snipKey = `${regId}||${testId}`;
      const existing = outsourcedParamSets[snipKey];
      const currentIds = existing ? Array.from(existing) : [];
      const newIds = [...currentIds, paramId];
      await supabase.from("outsourced_test_snips").upsert({
        registration_id: regId,
        test_id: testId,
        outsource_status: "pending",
        result_mode: "manual",
        outsourced_parameter_ids: newIds,
      } as any, { onConflict: "registration_id,test_id" });
      // Delete pending result for this param
      await supabase.from("patient_results").delete().eq("registration_id", regId).eq("test_id", testId).eq("parameter_id", paramId);
      toast.success(`${paramName} transferred to Outsourced`);
      qc.invalidateQueries({ queryKey: ["results_outsourced_snips"] });
      qc.invalidateQueries({ queryKey: ["outsourced_snips"] });
      qc.invalidateQueries({ queryKey: ["patient_results_existing"] });
    } catch (err: any) {
      toast.error(err.message || "Transfer failed");
    } finally {
      setTransferringKey(null);
    }
  };

  const outsourcedParamIdsForTest = (regId: string, testId: string): string[] | undefined => {
    const set = outsourcedParamSets[`${regId}||${testId}`];
    if (!set || set.size === 0) return undefined;
    return Array.from(set);
  };

  const applySnipEntry = async (regId: string, testId: string) => {
    const testKey = `${regId}||${testId}`;
    const paramIds = outsourcedParamIdsForTest(regId, testId);
    await clearTypedOutsourcedResults(supabase, regId, testId, paramIds);
    const { error } = await supabase.from("outsourced_test_snips").upsert({
      registration_id: regId,
      test_id: testId,
      result_mode: "snip",
      outsource_status: outsourcedSnipDetails[testKey]?.status || "sent",
    } as any, { onConflict: "registration_id,test_id" });
    if (error) throw error;
    setSnipEntryKeys((prev) => new Set(prev).add(testKey));
    setExpandedTests((prev) => new Set(prev).add(testKey));
    qc.invalidateQueries({ queryKey: ["results_outsourced_snips"] });
    qc.invalidateQueries({ queryKey: ["outsourced_snips"] });
    qc.invalidateQueries({ queryKey: ["patient_results_existing"] });
  };

  const applyManualEntry = async (regId: string, testId: string) => {
    const testKey = `${regId}||${testId}`;
    const { error } = await supabase.from("outsourced_test_snips").upsert({
      registration_id: regId,
      test_id: testId,
      result_mode: "manual",
      snip_image_url: null,
      snip_image_urls: [],
    } as any, { onConflict: "registration_id,test_id" });
    if (error) throw error;
    setSnipEntryKeys((prev) => {
      const next = new Set(prev);
      next.delete(testKey);
      return next;
    });
    setExpandedTests((prev) => new Set(prev).add(testKey));
    qc.invalidateQueries({ queryKey: ["results_outsourced_snips"] });
    qc.invalidateQueries({ queryKey: ["outsourced_snips"] });
  };

  const beginSnipEntry = async (regId: string, testId: string, testName: string, hasTypedValues: boolean) => {
    const paramIds = outsourcedParamIdsForTest(regId, testId);
    if (hasTypedValues) {
      setSnipModeConfirm({ regId, testId, testName, paramIds, target: "snip" });
      return;
    }
    try {
      await applySnipEntry(regId, testId);
    } catch (err: any) {
      toast.error(err.message || "Failed to switch to snipped image");
    }
  };

  const beginManualEntry = async (regId: string, testId: string, testName: string, hasImages: boolean) => {
    const paramIds = outsourcedParamIdsForTest(regId, testId);
    if (hasImages) {
      setSnipModeConfirm({ regId, testId, testName, paramIds, target: "manual" });
      return;
    }
    try {
      await applyManualEntry(regId, testId);
    } catch (err: any) {
      toast.error(err.message || "Failed to switch to typed values");
    }
  };

  const handlePatientSnipPaste = async (regId: string, testId: string, event: React.ClipboardEvent) => {
    const items = event.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item.type.startsWith("image/")) continue;
      event.preventDefault();
      const file = item.getAsFile();
      if (!file) continue;
      await handlePatientSnipUpload(regId, testId, file);
      return;
    }
  };

  const handlePatientSnipUpload = async (regId: string, testId: string, file: File) => {
    const key = `${regId}||${testId}`;
    setUploadingSnipKey(key);
    try {
      const existing = outsourcedSnipDetails[key]?.snipImageUrls || [];
      const newUrls = await appendOutsourcedSnipImage(
        supabase, regId, testId, file, existing, outsourcedParamIdsForTest(regId, testId),
      );
      toast.success(`Page ${newUrls.length} added successfully`);
      setSnipEntryKeys((prev) => new Set(prev).add(key));
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["results_outsourced_snips"] }),
        qc.invalidateQueries({ queryKey: ["outsourced_snips"] }),
        qc.invalidateQueries({ queryKey: ["patient_results_existing"] }),
      ]);
    } catch (err: any) {
      toast.error(err.message || "Failed to upload image");
    } finally {
      setUploadingSnipKey(null);
    }
  };

  const handlePatientSnipDeletePage = async (regId: string, testId: string, pageIndex: number) => {
    const key = `${regId}||${testId}`;
    const current = outsourcedSnipDetails[key]?.snipImageUrls || [];
    const newUrls = current.filter((_, i) => i !== pageIndex);
    try {
      if (newUrls.length === 0) {
        await supabase.from("outsourced_test_snips").update({
          snip_image_url: null,
          snip_image_urls: [],
          result_mode: "manual",
          outsource_status: "sent",
        } as any).eq("registration_id", regId).eq("test_id", testId);
        setSnipEntryKeys((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
        toast.success("All pages removed — switched back to typed values");
      } else {
        await supabase.from("outsourced_test_snips").update({
          snip_image_url: newUrls[0],
          snip_image_urls: newUrls,
        } as any).eq("registration_id", regId).eq("test_id", testId);
        toast.success(`Page ${pageIndex + 1} removed`);
      }
      qc.invalidateQueries({ queryKey: ["results_outsourced_snips"] });
      qc.invalidateQueries({ queryKey: ["outsourced_snips"] });
    } catch (err: any) {
      toast.error(err.message || "Failed to delete page");
    }
  };

  const savePatientSnipResults = async (regId: string, testId: string, testName: string) => {
    const key = `${regId}||${testId}`;
    setSavingSnipKey(key);
    try {
      await clearTypedOutsourcedResults(supabase, regId, testId, outsourcedParamIdsForTest(regId, testId));
      const { error } = await supabase.from("outsourced_test_snips").upsert({
        registration_id: regId,
        test_id: testId,
        result_mode: "snip",
        outsource_status: "results_saved",
        entered_at: new Date().toISOString(),
        entered_by: getCurrentUserName(),
      } as any, { onConflict: "registration_id,test_id" });
      if (error) throw error;
      toast.success(`Snip saved for ${testName}`);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["results_outsourced_snips"] }),
        qc.invalidateQueries({ queryKey: ["outsourced_snips"] }),
        qc.invalidateQueries({ queryKey: ["patient_results_existing"] }),
      ]);
    } catch (err: any) {
      toast.error(err.message || "Failed to save snip");
    } finally {
      setSavingSnipKey(null);
    }
  };

  // ─── Helper: resolve best normal range for a parameter given patient demographics ───
  const resolveNormalRange = useCallback((parameterId: string, reg: any) => {
    const ranges = normalRangesMap[parameterId];
    if (!ranges || ranges.length === 0) return { text: "", low: null as number | null, high: null as number | null, rangeType: "numeric", descriptiveOptions: [] as string[], expectedValue: "", normalFindings: "" };
    // Prefer gender-specific then all; within that, age-matching
    const gender = (reg?.gender || "").toLowerCase();
    const ageYears = (() => {
      if (!reg?.dob) return null;
      const d = new Date(reg.dob);
      if (isNaN(d.getTime())) return null;
      const now = new Date();
      let age = now.getFullYear() - d.getFullYear();
      const m = now.getMonth() - d.getMonth();
      if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
      return age;
    })();

    const matchesAge = (r: any) => {
      if (r.age_min == null && r.age_max == null) return true;
      if (ageYears == null) return true;
      const min = r.age_min ?? 0;
      const max = r.age_max ?? 200;
      return ageYears >= min && ageYears <= max;
    };

    const genderPool = ranges.filter((r: any) => {
      const g = (r.gender || "all").toLowerCase();
      return g === "all" || g === gender || (gender === "m" && g === "male") || (gender === "f" && g === "female") || (gender.startsWith("male") && g === "male") || (gender.startsWith("female") && g === "female");
    });
    const pool = (genderPool.length ? genderPool : ranges).filter(matchesAge);
    const best = pool[0] || ranges[0];
    if (!best) return { text: "", low: null as number | null, high: null as number | null, rangeType: "numeric", descriptiveOptions: [] as string[], expectedValue: "", normalFindings: "" };
    const text = best.normal_range_text || (best.normal_range_low != null && best.normal_range_high != null ? `${best.normal_range_low} - ${best.normal_range_high}` : "");
    const rangeType = best.range_type || "numeric";
    const descriptiveOptions = Array.isArray(best.descriptive_options) ? best.descriptive_options : [];
    const expectedValue = best.expected_value || "";
    const normalFindings = best.normal_findings || "";
    return { text, low: best.normal_range_low as number | null, high: best.normal_range_high as number | null, rangeType, descriptiveOptions, expectedValue, normalFindings };
  }, [normalRangesMap]);

  // ─── Build patient entries: full params only for expanded patient ───
  const patientEntries: PatientEntry[] = useMemo(() => {
    return acceptedRegs.map((reg: any) => {
      // Collapsed cards: header only — no parameter grid until expand
      if (reg.id !== expandedPatient) {
        return { registration: reg, parameters: [], incompleteTests: [], snipOnlyTests: [] };
      }
      if (!detailReady || !detailReg) {
        return { registration: reg, parameters: [], incompleteTests: [], snipOnlyTests: [] };
      }

      const fullReg = { ...reg, ...detailReg };
      const tests = (fullReg.tests || []) as any[];
      const cancelledIds = new Set(((fullReg.cancelled_tests || []) as any[]).map((t: any) => t.test_id));
      const acceptedTestIds = acceptedTestIdsByReg[reg.id];
      // Expand PRL/HLT container rows into their leaf tests using accepted-tube test_ids
      const expandedTests = expandRegistrationTests(tests, acceptedTestIds ?? new Set<string>(), testsMap);
      // While tubes for this page are still loading, do NOT drop every test
      // (acceptedTestIds undefined → .has() is falsy → entire Results list vanishes).
      const activeTests = expandedTests.filter((t: any) => {
        if (cancelledIds.has(t.test_id)) return false;
        if (!tubesReady) return true;
        if (!acceptedTestIds) return false;
        return acceptedTestIds.has(t.test_id);
      });

      const parameters: ParameterResult[] = [];
      const incompleteTests: IncompleteTest[] = [];
      const snipOnlyTests: SnipOnlyTest[] = [];
      for (const t of activeTests) {
        const testInfo = testsMap[t.test_id] || {};
        // Naturally outsourced tests are included — they appear with outsourced badges and can be saved & verified
        const testSnipKey = `${reg.id}||${t.test_id}`;
        const isFullTestOutsourced = transferredTestKeys.has(testSnipKey);
        const paramOutsourcedSet = outsourcedParamSets[testSnipKey];
        const snipDetail = outsourcedSnipDetails[testSnipKey];

        const params = testParamsMap[t.test_id] || [];
        const isSnipResult = isSnipResultDetail(snipDetail);
        const isParamLevel = !!(paramOutsourcedSet && paramOutsourcedSet.size > 0);
        
        // Track tests with no parameters configured
        const validParams = params.filter((tp: any) => !tp.is_subheader && tp.report_test_parameters);
        // Snip-mode outsourced tests (even when parameters exist) skip typed entry
        if (isSnipResult && !isParamLevel && !["results_entered", "verified", "approved", "dispatched"].includes(snipDetail.status)) {
          snipOnlyTests.push({ testId: t.test_id, testName: t.test_name || testInfo.test_name || "", labName: snipDetail.labName, snipUrls: snipDetail.snipImageUrls, outsourceStatus: snipDetail.status });
          continue;
        }
        if (validParams.length === 0) {
          // Check if this is a snip-only outsourced test
          if (snipDetail && snipDetail.snipImageUrls.length > 0 && !["results_entered", "verified", "approved", "dispatched"].includes(snipDetail.status)) {
            snipOnlyTests.push({ testId: t.test_id, testName: t.test_name || testInfo.test_name || "", labName: snipDetail.labName, snipUrls: snipDetail.snipImageUrls, outsourceStatus: snipDetail.status });
          } else if (!snipDetail || snipDetail.snipImageUrls.length === 0) {
            incompleteTests.push({ testId: t.test_id, testName: t.test_name || testInfo.test_name || "" });
          }
          continue;
        }
        if (isSnipResult && isParamLevel && !["results_entered", "verified", "approved", "dispatched"].includes(snipDetail.status)) {
          snipOnlyTests.push({ testId: t.test_id, testName: t.test_name || testInfo.test_name || "", labName: snipDetail.labName, snipUrls: snipDetail.snipImageUrls, outsourceStatus: snipDetail.status });
        }
        
        // Collect params for this test first to check if ALL are already entered
        const testParamResults: { param: any; tp: any; isParamOutsourced: boolean; existing: any; covered: boolean }[] = [];
        for (const tp of params) {
          if (tp.is_subheader) continue;
          const p = tp.report_test_parameters;
          if (!p) continue;
          const isParamOutsourced = isFullTestOutsourced || (paramOutsourcedSet && paramOutsourcedSet.has(p.id));
          // Snip-mode outsourced params are handled via the snip card, not typed values
          if (isSnipResult && isParamOutsourced) continue;
          const resolved = resolveResultForResultsEntry(existingResults, reg.id, t.test_id, p.id);
          testParamResults.push({ param: p, tp, isParamOutsourced, existing: resolved.row, covered: resolved.covered });
        }
        
        // Skip this test entirely if EVERY parameter is already past Results Entry
        // (on this test OR completed under a sibling test for the same parameter).
        if (testParamResults.length > 0 && testParamResults.every(({ existing, covered }) => covered || isResultPastPending(existing?.status))) {
          continue;
        }

        for (const { param: p, tp, isParamOutsourced, existing, covered } of testParamResults) {
          // Sibling already completed this parameter — don't re-ask in Results
          if (covered || isResultPastPending(existing?.status)) continue;
          const resolved = resolveNormalRange(p.id, fullReg);
          const refText = resolved.text || p.normal_range_text || (p.normal_range_low != null && p.normal_range_high != null ? `${p.normal_range_low} - ${p.normal_range_high}` : "");
          const rangeLow = resolved.low ?? p.normal_range_low;
          const rangeHigh = resolved.high ?? p.normal_range_high;

          // For outsourced params, use saved values from patient_results if available.
          // Descriptive: reference_range is Display Text only (never Normal Findings).
          const savedUnit = isParamOutsourced && existing?.unit ? existing.unit : (p.unit || "");
          const savedRefRange = resolved.rangeType === "descriptive"
            ? (resolved.text || "")
            : (isParamOutsourced && existing?.reference_range ? existing.reference_range : refText);

          parameters.push({
            parameterId: p.id,
            paramCode: p.param_code || "",
            parameterName: p.parameter_name,
            unit: savedUnit,
            referenceRange: savedRefRange,
            normalRangeLow: rangeLow,
            normalRangeHigh: rangeHigh,
            resultValue: existing?.result_value ?? "",
            flag: existing?.flag || "",
            isCalculated: p.is_calculated || false,
            calculationFormula: p.calculation_formula || [],
            isFromInterface: existing?.is_from_interface || false,
            sendForInterface: p.send_for_interface || false,
            status: existing?.status || "pending",
            testId: t.test_id,
            testName: t.test_name || testInfo.test_name || "",
            departmentId: testInfo.department_id || "",
            machineName: testInfo.instrument_name || "",
            displayOrder: tp.display_order || 0,
            rangeType: resolved.rangeType,
            descriptiveOptions: resolved.descriptiveOptions,
            expectedValue: resolved.expectedValue,
            normalFindings: resolved.normalFindings || "",
            normalRangeText: resolved.text || "",
            isOutsourced: !!isParamOutsourced,
            outsourceLabName: isParamOutsourced ? (snipDetail?.labName || null) : null,
            outsourceStatus: isParamOutsourced ? (snipDetail?.status || "pending") : "",
            isSnipMode: isParamOutsourced && snipDetail?.resultMode === "snip",
            note: existing?.note || "",
          });
        }
      }
      return { registration: fullReg, parameters, incompleteTests, snipOnlyTests };
    });
  }, [acceptedRegs, expandedPatient, detailReady, detailReg, testsMap, testParamsMap, existingResults, resolveNormalRange, transferredTestKeys, outsourcedParamSets, outsourcedSnipDetails, acceptedTestIdsByReg, tubesReady]);

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

  // ─── Calculate flag ───
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

  // ─── Apply unit suffix for "undefined" range type ───
  const applyUnitSuffix = (value: string, unit: string | null | undefined, rangeType?: string): string => {
    if (!value || rangeType !== "undefined" || !unit) return value;
    const trimmed = value.trim();
    const u = unit.trim();
    if (!u) return trimmed;
    if (trimmed.toLowerCase().endsWith(u.toLowerCase())) return trimmed;
    return `${trimmed} ${u}`;
  };

  // ─── Evaluate calculated parameters ───
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
      if (typeof result === "number" && isFinite(result)) {
        return parseFloat(result.toFixed(2)).toString();
      }
      return "";
    } catch {
      return "";
    }
  };

  // ─── Get current value for a parameter (edited or existing) ───
  const getParamValue = (regId: string, paramId: string, entry: PatientEntry): string => {
    const key = `${regId}||${paramId}`;
    if (editedValues[key] !== undefined) return editedValues[key];
    const param = entry.parameters.find(p => p.parameterId === paramId);
    return param?.resultValue || "";
  };

  // ─── Handle value change ───
  const handleValueChange = (regId: string, paramId: string, value: string, entry: PatientEntry) => {
    const key = `${regId}||${paramId}`;
    const newEdited = { ...editedValues, [key]: value };

    // Recalculate calculated parameters
    const paramValues: Record<string, string> = {};
    for (const p of entry.parameters) {
      const pk = `${regId}||${p.parameterId}`;
      paramValues[p.parameterId] = pk === key ? value : (newEdited[pk] !== undefined ? newEdited[pk] : p.resultValue);
    }

    for (const p of entry.parameters) {
      if (p.isCalculated && p.calculationFormula.length > 0) {
        const calcResult = evaluateFormula(p.calculationFormula, paramValues);
        const calcKey = `${regId}||${p.parameterId}`;
        newEdited[calcKey] = calcResult;
        paramValues[p.parameterId] = calcResult;
      }
    }

    setEditedValues(newEdited);

    // Schedule auto-save for this test (debounced)
    const testId = entry.parameters.find(p => p.parameterId === paramId)?.testId;
    if (testId) {
      const autoKey = `${regId}||${testId}`;
      if (autoSaveTimers.current[autoKey]) clearTimeout(autoSaveTimers.current[autoKey]);
      autoSaveTimers.current[autoKey] = setTimeout(() => {
        autoSaveTest(regId, testId, entry, newEdited);
        delete autoSaveTimers.current[autoKey];
      }, 1500);
    }
  };

  // Tracks tests currently being Save & Verified so a debounced auto-save cannot
  // overwrite their freshly-written `entered` rows back to `pending`.
  const saveInFlightRef = useRef<Set<string>>(new Set());

  const clearAutoSaveTimer = (regId: string, testId: string) => {
    const key = `${regId}||${testId}`;
    if (autoSaveTimers.current[key]) {
      clearTimeout(autoSaveTimers.current[key]);
      delete autoSaveTimers.current[key];
    }
  };

  // ─── Auto-save (saves with status "pending", does NOT transfer) ───
  const autoSaveTest = async (regId: string, testId: string, entry: PatientEntry, currentEdits: Record<string, string>) => {
    const saveKey = `${regId}||${testId}`;
    if (saveInFlightRef.current.has(saveKey)) return;

    const testParams = entry.parameters.filter(p => p.testId === testId);
    // Never downgrade parameters that already left Results Entry
    const unlockedParams = testParams.filter((p) => !isResultPastPending(p.status));
    if (unlockedParams.length === 0) return;

    const upserts: any[] = [];
    for (const p of unlockedParams) {
      const key = `${regId}||${p.parameterId}`;
      const value = currentEdits[key] !== undefined ? currentEdits[key] : p.resultValue;
      const autoFlag = calculateFlag(value, p.normalRangeLow, p.normalRangeHigh, p.rangeType, p.expectedValue, p.descriptiveOptions, p.normalRangeText, p.unit, p.normalFindings);
      const flag = p.isOutsourced && editedFlags[key] !== undefined ? editedFlags[key] : autoFlag;
      const unit = p.isOutsourced && editedUnits[key] !== undefined ? editedUnits[key] : p.unit;
      const refRange = p.rangeType === "descriptive"
        ? (p.normalRangeText || "")
        : (p.isOutsourced && editedRefRanges[key] !== undefined ? editedRefRanges[key] : p.referenceRange);
      upserts.push({
        registration_id: regId,
        test_id: p.testId,
        parameter_id: p.parameterId,
        param_code: p.paramCode,
        parameter_name: p.parameterName,
        result_value: applyUnitSuffix(value, unit, p.rangeType) || null,
        unit: unit,
        reference_range: refRange,
        normal_range_low: p.normalRangeLow,
        normal_range_high: p.normalRangeHigh,
        flag: flag || null,
        status: "pending",
        is_calculated: p.isCalculated,
        is_from_interface: p.isFromInterface,
         entered_by: getCurrentUserName(),
         note: editedNotesRef.current[key] !== undefined ? (editedNotesRef.current[key] || null) : (p.note || null),
         test_note: editedTestNotesRef.current[`${regId}||${testId}`] !== undefined ? (editedTestNotesRef.current[`${regId}||${testId}`] || null) : (loadedTestNotes[`${regId}||${testId}`] || null),
        });
    }
    if (upserts.length === 0) return;
    try {
      // Re-check in-flight / DB status right before write (race with Save & Verify)
      if (saveInFlightRef.current.has(saveKey)) return;
      const paramIdsToReplace = upserts.map((u) => u.parameter_id);
      const { data: liveRows } = await supabase
        .from("patient_results")
        .select("parameter_id, status")
        .eq("registration_id", regId)
        .eq("test_id", testId)
        .in("parameter_id", paramIdsToReplace);
      const lockedIds = new Set(
        (liveRows || [])
          .filter((r: any) => isResultPastPending(r.status))
          .map((r: any) => r.parameter_id),
      );
      const safeUpserts = upserts.filter((u) => !lockedIds.has(u.parameter_id));
      if (safeUpserts.length === 0) return;
      const safeIds = safeUpserts.map((u) => u.parameter_id);
      // PARTIAL-SAFE: only replace still-pending parameter rows for THIS test_id.
      await supabase
        .from("patient_results")
        .delete()
        .eq("registration_id", regId)
        .eq("test_id", testId)
        .in("parameter_id", safeIds)
        .eq("status", "pending");
      if (saveInFlightRef.current.has(saveKey)) return;
      await supabase.from("patient_results").insert(safeUpserts as any);
    } catch {
      // silent auto-save failure
    }
  };

  // ─── Auto-evaluate calculated parameters whenever entries refresh ───
  // Triggers when interface results arrive (via realtime) or when the patient
  // list rebuilds. For every calculated parameter whose displayed value would
  // change given the current dependent values, write the new value into
  // editedValues and schedule the existing debounced auto-save so the result
  // is persisted as 'pending' and visible to all other open sessions.
  const autoCalcSeenRef = useRef<Record<string, string>>({});
  useEffect(() => {
    if (!patientEntries || patientEntries.length === 0) return;
    const updates: Record<string, string> = {};
    const testsToSave = new Set<string>();
    const entryByReg: Record<string, PatientEntry> = {};

    for (const entry of patientEntries) {
      const regId = entry.registration.id;
      entryByReg[regId] = entry;

      // Lock tests where any param status is past 'pending' (verified/approved/etc.)
      const lockedTestIds = new Set<string>();
      for (const p of entry.parameters) {
        if (p.status && p.status !== "pending") lockedTestIds.add(p.testId);
      }

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
          if (lockedTestIds.has(p.testId)) continue;
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
          testsToSave.add(`${regId}||${p.testId}`);
          changed++;
        }
        if (changed === 0) break;
      }
    }

    if (Object.keys(updates).length === 0) return;
    setEditedValues((prev) => ({ ...prev, ...updates }));

    for (const tk of testsToSave) {
      const [regId, testId] = tk.split("||");
      const entry = entryByReg[regId];
      if (!entry) continue;
      if (autoSaveTimers.current[tk]) clearTimeout(autoSaveTimers.current[tk]);
      autoSaveTimers.current[tk] = setTimeout(() => {
        autoSaveTest(regId, testId, entry, { ...editedValues, ...updates });
        delete autoSaveTimers.current[tk];
      }, 1500);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientEntries]);

  // ─── Save & send to verification (per-test) ───
  const [savingTestKey, setSavingTestKey] = useState<string | null>(null);
  const [blankConfirmTestParams, setBlankConfirmTestParams] = useState<{ entry: PatientEntry; testId: string; testName: string } | null>(null);
  const [blankParamIds, setBlankParamIds] = useState<Set<string>>(new Set());
  const [diffConfirm, setDiffConfirm] = useState<{ entry: PatientEntry; testId: string; testName: string; sum: number; diff: number } | null>(null);

  // Returns null if no diff issue (or no differential params), otherwise the offending result.
  // IMPORTANT: read from the UNFILTERED patientEntries for this registration. The
  // `entry.parameters` arg is from `filteredEntries`, which strips params whose status
  // is already entered/verified/approved/dispatched. Diff params that were auto-pushed
  // by the machine interface (or saved earlier) would otherwise be excluded and the
  // 100-sum check would silently pass on an incomplete subset.
  const getDifferentialIssue = useCallback((entry: PatientEntry, testId: string) => {
    const reg = entry.registration;
    const rawEntry = patientEntries.find((pe) => pe.registration.id === reg.id) || entry;
    const testParams = rawEntry.parameters.filter((p) => p.testId === testId);
    const list = testParams.map((p) => {
      const key = `${reg.id}||${p.parameterId}`;
      const val = editedValues[key] !== undefined ? editedValues[key] : p.resultValue;
      return { paramCode: p.paramCode, value: val };
    });
    const r = checkDifferentialSum(list);
    return r.hasDifferential && !r.isOk ? r : null;
  }, [editedValues, patientEntries]);

  const saveMutation = useMutation({
    mutationFn: async ({ entry, testId }: { entry: PatientEntry; testId: string }) => {
      const reg = entry.registration;
      const testParams = entry.parameters.filter(p => p.testId === testId);
      const upserts: any[] = [];

      for (const p of testParams) {
        const key = `${reg.id}||${p.parameterId}`;
        const value = editedValues[key] !== undefined ? editedValues[key] : p.resultValue;
        const autoFlag = calculateFlag(value, p.normalRangeLow, p.normalRangeHigh, p.rangeType, p.expectedValue, p.descriptiveOptions, p.normalRangeText, p.unit, p.normalFindings);
        const flag = p.isOutsourced && editedFlags[key] !== undefined ? editedFlags[key] : autoFlag;
        const unit = p.isOutsourced && editedUnits[key] !== undefined ? editedUnits[key] : p.unit;
        const refRange = p.rangeType === "descriptive"
          ? (p.normalRangeText || "")
          : (p.isOutsourced && editedRefRanges[key] !== undefined ? editedRefRanges[key] : p.referenceRange);
        upserts.push({
          registration_id: reg.id,
          test_id: p.testId,
          parameter_id: p.parameterId,
          param_code: p.paramCode,
          parameter_name: p.parameterName,
          result_value: applyUnitSuffix(value, unit, p.rangeType) || null,
          unit: unit,
          reference_range: refRange,
          normal_range_low: p.normalRangeLow,
          normal_range_high: p.normalRangeHigh,
          flag: flag || null,
          status: "entered",
          entered_at: new Date().toISOString(),
          is_calculated: p.isCalculated,
          is_from_interface: p.isFromInterface,
          entered_by: getCurrentUserName(),
          note: editedNotesRef.current[key] !== undefined ? (editedNotesRef.current[key] || null) : (p.note || null),
          test_note: editedTestNotesRef.current[`${reg.id}||${testId}`] !== undefined ? (editedTestNotesRef.current[`${reg.id}||${testId}`] || null) : (loadedTestNotes[`${reg.id}||${testId}`] || null),
        });
      }

      // Snip-only test (no parameters) — just update outsourced_test_snips status
      if (upserts.length === 0) {
        await supabase.from("outsourced_test_snips").update({ outsource_status: "results_entered" } as any).eq("registration_id", reg.id).eq("test_id", testId).in("outsource_status", ["pending", "sent", "results_saved"]);
        return;
      }

      // PARTIAL-SAFE: only replace the exact parameter rows we are about to insert.
      // Sibling parameters of the same test (e.g. T3/T4 when re-saving TSH later)
      // must be preserved — never delete by (registration_id, test_id) alone.
      const paramIdsToReplace = upserts.map((u) => u.parameter_id);
      if (paramIdsToReplace.length > 0) {
        // Never wipe verified/approved/dispatched rows — that made already-approved
        // Iron/TG disappear from patient_results and reappear empty in Results.
        const { error: delErr } = await supabase
          .from("patient_results")
          .delete()
          .eq("registration_id", reg.id)
          .eq("test_id", testId)
          .in("parameter_id", paramIdsToReplace)
          .in("status", ["pending", "entered", "results_entered"]);
        if (delErr) throw delErr;
      }
      const { error } = await supabase.from("patient_results").insert(upserts as any);
      if (error) throw error;

      // Drop leftover pending rows for the same parameters under OTHER test_ids
      // (e.g. standalone S.ALBUMIN pending while LFT Albumin was just entered).
      // Those orphans make Results Entry look up the wrong status when matching
      // by parameter_id alone, and pollute registration status recalc.
      if (paramIdsToReplace.length > 0) {
        await supabase
          .from("patient_results")
          .delete()
          .eq("registration_id", reg.id)
          .in("parameter_id", paramIdsToReplace)
          .eq("status", "pending")
          .neq("test_id", testId);
      }

      // Post-condition self-check: confirm every param we just saved persisted
      // with status='entered', and confirm no sibling rows for this test were
      // inadvertently lost. If anything looks wrong, surface a real error
      // instead of a misleading success toast.
      const { data: postRows, error: postErr } = await supabase
        .from("patient_results")
        .select("parameter_id, status")
        .eq("registration_id", reg.id)
        .eq("test_id", testId);
      if (postErr) throw postErr;
      const persistedIds = new Set((postRows || []).map((r: any) => r.parameter_id));
      const missing = paramIdsToReplace.filter((pid) => !persistedIds.has(pid));
      if (missing.length > 0) {
        throw new Error("Save did not persist all parameters — please retry.");
      }

      // Update outsourced snip status to results_entered so it flows to Verification
      await supabase.from("outsourced_test_snips").update({ outsource_status: "results_entered" } as any).eq("registration_id", reg.id).eq("test_id", testId).in("outsource_status", ["pending", "sent", "results_saved"]);
    },
    onSuccess: async (_, { entry, testId }) => {
      const testName = entry.parameters.find(p => p.testId === testId)?.testName || entry.snipOnlyTests.find(s => s.testId === testId)?.testName || "Test";
      const regId = entry.registration.id;
      saveInFlightRef.current.delete(`${regId}||${testId}`);
      setEditedValues(prev => {
        const next = { ...prev };
        entry.parameters.filter(p => p.testId === testId).forEach(p => {
          delete next[`${regId}||${p.parameterId}`];
        });
        return next;
      });
      setSavingTestKey(null);
      setBlankConfirmTestParams(null);
      setHighlightBlanksForRegs(prev => { const next = new Set(prev); next.delete(`${regId}||${testId}`); return next; });
      // Awaited recalc + correct invalidations + sync signal — single source of truth
      await propagateRegistrationChange(qc, regId, ["results", "verification"]);
      toast.success(`${testName} saved & sent to verification`);
    },
    onError: (err: any, vars) => {
      toast.error(err.message || "Failed to save results");
      if (vars) saveInFlightRef.current.delete(`${vars.entry.registration.id}||${vars.testId}`);
      setSavingTestKey(null);
    },
  });

  // ─── Handle save & send to verification with blank check (per-test) ───
  const handleSaveAndVerify = (entry: PatientEntry, testId: string, testName: string) => {
    const reg = entry.registration;
    const testParams = entry.parameters.filter(p => p.testId === testId);

    const startSave = () => {
      clearAutoSaveTimer(reg.id, testId);
      saveInFlightRef.current.add(`${reg.id}||${testId}`);
      setSavingTestKey(`${reg.id}||${testId}`);
      saveMutation.mutate({ entry, testId });
    };

    // Snip-only test — no params to check for blanks, just save directly
    const isSnipOnly = entry.snipOnlyTests.some(s => s.testId === testId);
    if (isSnipOnly || testParams.length === 0) {
      startSave();
      return;
    }

    // Count blank parameters
    let blanks = 0;
    for (const p of testParams) {
      if (p.isCalculated) continue;
      const key = `${reg.id}||${p.parameterId}`;
      const val = editedValues[key] !== undefined ? editedValues[key] : p.resultValue;
      if (!val || val.trim() === "") blanks++;
    }
    if (blanks > 0) {
      setBlankParamCount(blanks);
      const ids = new Set<string>();
      for (const p of testParams) {
        if (p.isCalculated) continue;
        const key = `${reg.id}||${p.parameterId}`;
        const val = editedValues[key] !== undefined ? editedValues[key] : p.resultValue;
        if (!val || val.trim() === "") ids.add(p.parameterId);
      }
      setBlankParamIds(ids);
      setBlankConfirmTestParams({ entry, testId, testName });
      setHighlightBlanksForRegs(prev => new Set(prev).add(`${reg.id}||${testId}`));
    } else {
      const issue = getDifferentialIssue(entry, testId);
      if (issue) {
        setDiffConfirm({ entry, testId, testName, sum: issue.sum, diff: issue.diff });
        return;
      }
      startSave();
    }
  };

  // ─── Filter entries: lean headers; machine mode shows only that machine's tests on expand ───
  const filteredEntries = useMemo(() => {
    const activeEntries = patientEntries.map(e => {
      if (e.registration.id !== expandedPatient) return e;
      const activeParams = e.parameters.filter((p) => {
        if (p.isOutsourced) {
          return !["results_entered", "verified", "approved", "dispatched"].includes(p.outsourceStatus || "")
            && !["entered", "verified", "approved", "dispatched"].includes(p.status || "");
        }

        return !["entered", "verified", "approved", "dispatched"].includes(p.status || "");
      });

      return { ...e, parameters: activeParams };
    });

    if (mode === "patient" || selectedMachine === "all") return activeEntries;

    const filterMachine = selectedMachine === "others" ? "" : selectedMachine;
    const matchesMachine = (testId: string, machineName?: string) => {
      if (machineName !== undefined) return (machineName || "") === filterMachine;
      const inst = (testsMap[testId]?.instrument_name || testsInstrumentMap[testId] || "").trim();
      return inst === filterMachine;
    };

    return activeEntries.map((e) => {
      if (e.registration.id !== expandedPatient) return e;
      return {
        ...e,
        parameters: e.parameters.filter((p) => matchesMachine(p.testId, p.machineName)),
        incompleteTests: e.incompleteTests.filter((t) => matchesMachine(t.testId)),
        snipOnlyTests: e.snipOnlyTests.filter((t) => matchesMachine(t.testId)),
      };
    });
  }, [patientEntries, mode, selectedMachine, expandedPatient, testsMap, testsInstrumentMap]);

  // ─── NEW arrivals badge tracker ───
  const filteredRegIds = useMemo(() => filteredEntries.map(e => e.registration.id), [filteredEntries]);
  const { isNew: isNewArrival, markSeen: markArrivalSeen } = useNewArrivalsBadge("results", filteredRegIds);

  // ─── Stats (based on filtered entries, excludes already-entered patients) ───
  const stats = useMemo(() => {
    let totalParams = 0, pendingParams = 0, enteredParams = 0, awaitingInterface = 0;
    for (const e of filteredEntries) {
      for (const p of e.parameters) {
        totalParams++;
        const key = `${e.registration.id}||${p.parameterId}`;
        const val = editedValues[key] !== undefined ? editedValues[key] : p.resultValue;
        if (val) enteredParams++;
        else {
          pendingParams++;
          if (p.sendForInterface && !p.isCalculated) awaitingInterface++;
        }
      }
    }
    return { totalParams, pendingParams, enteredParams, awaitingInterface, totalPatients: filteredEntries.length };
  }, [filteredEntries, editedValues]);

  // ─── Machine-wise grouping inside a patient ───
  const groupByMachine = (params: ParameterResult[]) => {
    const groups: Record<string, { machineName: string; params: ParameterResult[] }> = {};
    for (const p of params) {
      const machine = p.machineName || "Others";
      if (!groups[machine]) {
        groups[machine] = { machineName: machine, params: [] };
      }
      groups[machine].params.push(p);
    }
    return Object.values(groups);
  };

  // ─── Group by test inside params ───
  const groupByTest = (params: ParameterResult[]) => {
    const groups: Record<string, { testId: string; testName: string; params: ParameterResult[] }> = {};
    for (const p of params) {
      if (!groups[p.testId]) groups[p.testId] = { testId: p.testId, testName: p.testName, params: [] };
      groups[p.testId].params.push(p);
    }
    return Object.values(groups);
  };

  const hasUnsavedChanges = (regId: string) => {
    return Object.keys(editedValues).some(k => k.startsWith(`${regId}||`));
  };

  const getCompletionPct = (entry: PatientEntry) => {
    if (entry.parameters.length === 0) return 100;
    let filled = 0;
    for (const p of entry.parameters) {
      const key = `${entry.registration.id}||${p.parameterId}`;
      const val = editedValues[key] !== undefined ? editedValues[key] : p.resultValue;
      if (val) filled++;
    }
    return Math.round((filled / entry.parameters.length) * 100);
  };

  // ─── Render history cell ───
  const renderHistoryCell = (parameterId: string, index: number) => {
    const hist = historyMap[parameterId]?.[index];
    if (!hist || !hist.resultValue) return <TableCell className="py-1.5 text-center text-xs text-muted-foreground">—</TableCell>;
    if (hist.snipImageUrls && hist.snipImageUrls.length > 0) {
      return (
        <TableCell className="py-1.5 text-xs">
          <div className="leading-tight">
            <Button
              size="sm"
              variant="ghost"
              className="h-5 px-1 text-xs text-blue-600 hover:text-blue-800 gap-0.5"
              onClick={() => { setViewSnipImages(hist.snipImageUrls); setViewSnipContext(null); }}
            >
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

  // ─── Render parameter row ───
  const renderParamRow = (entry: PatientEntry, p: ParameterResult) => {
    const regId = entry.registration.id;
    const key = `${regId}||${p.parameterId}`;
    const currentValue = editedValues[key] !== undefined ? editedValues[key] : p.resultValue;
    const autoFlag = calculateFlag(currentValue, p.normalRangeLow, p.normalRangeHigh, p.rangeType, p.expectedValue, p.descriptiveOptions, p.normalRangeText, p.unit, p.normalFindings);
    const flag = p.isOutsourced && editedFlags[key] !== undefined ? editedFlags[key] : autoFlag;
    const isInterfaceParameter = p.sendForInterface && !p.isCalculated;
    const isAwaiting = isInterfaceParameter && !currentValue;

    const isBlank = !currentValue || currentValue.trim() === "";
    const shouldHighlightBlanks = highlightBlanksForRegs.has(`${regId}||${p.testId}`);
    const isNegative = isSuspectNegativeResult(currentValue);
    const rowBg = isNegative
      ? "bg-red-50"
      : ((flag === "H" || flag === "L" || flag === "A" || flag === "X") ? "bg-destructive/5" : (isBlank && !p.isCalculated && shouldHighlightBlanks ? "bg-yellow-50" : ""));
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
              <Input
                value={editedNotes[key] ?? p.note ?? ""}
                onChange={e => setEditedNotes(prev => ({ ...prev, [key]: e.target.value }))}
                className="h-6 text-xs w-full"
                placeholder="Kindly correlate clinically"
                autoFocus
                onClick={e => e.stopPropagation()}
              />
              <Trash2 className="h-3.5 w-3.5 text-destructive cursor-pointer shrink-0" onClick={(e) => { e.stopPropagation(); setEditedNotes(prev => ({ ...prev, [key]: "" })); setActiveNoteKey(null); }} />
            </div>
          )}
          {(editedNotes[key] ?? p.note) && activeNoteKey !== key && (
            <div className="flex items-center gap-1 mt-0.5">
              <div className="text-xs font-bold text-amber-700 cursor-pointer" onClick={(e) => { e.stopPropagation(); setActiveNoteKey(key); }}>
                📝 {editedNotes[key] ?? p.note}
              </div>
              <Trash2 className="h-3 w-3 text-destructive/60 hover:text-destructive cursor-pointer shrink-0" onClick={(e) => { e.stopPropagation(); setEditedNotes(prev => ({ ...prev, [key]: "" })); }} />
            </div>
          )}
        </TableCell>
        {renderHistoryCell(p.parameterId, 1)}
        {renderHistoryCell(p.parameterId, 0)}
        <TableCell className="py-1.5 w-[180px]">
          {isInterfaceParameter ? (
            <div className="flex items-center gap-1">
              <Input
                value={currentValue}
                onChange={e => handleValueChange(regId, p.parameterId, e.target.value, entry)}
                className={`h-7 text-sm w-[120px] ${negCls}`}
                placeholder="Manual"
                data-result-input=""
                onKeyDown={handleResultTabKey}
              />
              <Badge
                variant="outline"
                className="text-xs text-orange-600 border-orange-300 whitespace-nowrap gap-0.5"
              >
                <Wifi className="h-3 w-3" /> {isAwaiting ? "Awaiting" : "Manual"}
              </Badge>
            </div>
          ) : p.isCalculated ? (
            <div className="flex items-center gap-1">
              <Input
                value={currentValue}
                onChange={(e) => handleValueChange(regId, p.parameterId, e.target.value, entry)}
                className={`h-7 text-sm w-[120px] font-mono ${negCls}`}
                placeholder="Auto"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                title="Recalculate"
                onClick={() => {
                  if (!p.calculationFormula) return;
                  const paramValues: Record<string, string> = {};
                  entry.parameters.forEach((ep) => { paramValues[ep.parameterId] = editedValues[`${regId}||${ep.parameterId}`] ?? ep.resultValue ?? ""; });
                  const result = evaluateFormula(p.calculationFormula, paramValues);
                  if (result) handleValueChange(regId, p.parameterId, result, entry);
                }}
              >
                <Calculator className="h-3 w-3 text-primary" />
              </Button>
              <Badge variant="secondary" className="text-xs gap-0.5">Calc</Badge>
            </div>
          ) : p.rangeType === "time" ? (
            <TimeResultInput
              value={currentValue}
              onChange={(v) => handleValueChange(regId, p.parameterId, v, entry)}
              onKeyDown={handleResultTabKey}
              abnormal={flag === "H" || flag === "L" || flag === "A" || flag === "X"}
            />
          ) : p.rangeType === "qualitative" && getQualitativeOptions(p.expectedValue).length > 0 ? (
            <Select
              value={currentValue || undefined}
              onValueChange={(v) => handleValueChange(regId, p.parameterId, v, entry)}
            >
              <SelectTrigger className="h-7 text-sm !w-[180px] min-w-[180px] max-w-[180px]" data-result-input="" data-result-value={currentValue || ""} onKeyDown={handleResultTabKey}>
                <SelectValue placeholder="Select..." />
              </SelectTrigger>
              <SelectContent>
                {getQualitativeOptions(p.expectedValue).map((opt: string) => (
                  <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : p.rangeType === "descriptive" && p.descriptiveOptions.length > 0 ? (
            <DescriptiveCombobox
              value={currentValue}
              options={p.descriptiveOptions}
              onChange={(v) => handleValueChange(regId, p.parameterId, v, entry)}
              onKeyDown={handleResultTabKey}
              className="w-[180px]"
            />
          ) : p.rangeType === "undefined" && p.descriptiveOptions.length > 0 ? (
            <DescriptiveCombobox
              value={currentValue}
              options={p.descriptiveOptions}
              onChange={(v) => handleValueChange(regId, p.parameterId, v, entry)}
              onKeyDown={handleResultTabKey}
              className="w-[180px]"
            />
          ) : p.rangeType === "undefined" ? (
            <Input
              value={currentValue}
              onChange={e => handleValueChange(regId, p.parameterId, e.target.value, entry)}
              className={`h-7 text-sm w-[180px] ${negCls}`}
              placeholder="Enter result"
              data-result-input=""
              onKeyDown={handleResultTabKey}
            />
          ) : (
            <Input
              value={currentValue}
              onChange={e => handleValueChange(regId, p.parameterId, e.target.value, entry)}
              className={`h-7 text-sm w-[180px] ${isNegative ? "border-red-500 ring-1 ring-red-300 text-red-700 font-semibold" : (flag === "H" || flag === "L" || flag === "A" || flag === "X" ? "border-destructive text-destructive font-bold" : "")}`}
              placeholder="Enter result"
              data-result-input=""
              onKeyDown={handleResultTabKey}
            />
          )}
        </TableCell>
        <TableCell className="py-1.5 text-xs text-muted-foreground">
          {p.isOutsourced ? (
            p.isSnipMode ? (
              <span className="text-xs text-muted-foreground">{p.unit || "—"}</span>
            ) : (
              <Input
                value={editedUnits[key] !== undefined ? editedUnits[key] : (p.unit || "")}
                onChange={e => setEditedUnits(prev => ({ ...prev, [key]: e.target.value }))}
                className="h-6 text-xs w-[70px]"
                placeholder="Unit"
              />
            )
          ) : p.unit}
        </TableCell>
        <TableCell className="py-1.5 text-xs text-muted-foreground">
          {p.isOutsourced ? (
            p.isSnipMode ? (
              <span className="text-xs text-muted-foreground">{p.referenceRange || "—"}</span>
            ) : (
              <Input
                value={editedRefRanges[key] !== undefined ? editedRefRanges[key] : (p.referenceRange || "")}
                onChange={e => setEditedRefRanges(prev => ({ ...prev, [key]: e.target.value }))}
                className="h-6 text-xs w-[100px]"
                placeholder="Ref Range"
              />
            )
          ) : p.referenceRange}
        </TableCell>
        <TableCell className="py-1.5 text-center">
          {p.isOutsourced ? (
            p.isSnipMode ? (
              <span className="text-xs text-muted-foreground">—</span>
            ) : (
              <Select
                value={flag || "none"}
                onValueChange={(v) => setEditedFlags(prev => ({ ...prev, [key]: v === "none" ? "" : v }))}
              >
                <SelectTrigger className="h-6 text-xs w-[80px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">—</SelectItem>
                  <SelectItem value="N">Normal</SelectItem>
                  <SelectItem value="H">HIGH</SelectItem>
                  <SelectItem value="L">LOW</SelectItem>
                </SelectContent>
              </Select>
            )
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
            ) : (p.outsourceStatus === "sent" || p.outsourceStatus === "results_saved" || p.outsourceStatus === "results_entered") && p.outsourceLabName ? (
              currentValue ? (
                <Badge variant="outline" className="text-xs text-green-600 border-green-300 whitespace-nowrap">{p.outsourceLabName}</Badge>
              ) : (
                <Badge variant="outline" className="text-xs text-blue-600 border-blue-300 whitespace-nowrap">{p.outsourceLabName}</Badge>
              )
            ) : (
              <Badge variant="outline" className="text-xs text-purple-600 border-purple-300">Outsourced</Badge>
            )
          ) : (
            <>
              {p.status === "entered" && <Badge variant="secondary" className="text-xs">Entered</Badge>}
              {p.status === "verified" && <Badge className="text-xs bg-green-600">Verified</Badge>}
              {p.status === "pending" && !currentValue && <Badge variant="outline" className="text-xs">Pending</Badge>}
            </>
          )}
        </TableCell>
        <TableCell className="py-1.5 text-center">
          <div className="flex items-center justify-center gap-1">
            {!p.isCalculated && !p.isOutsourced && (
              <Button
                size="sm"
                variant="ghost"
                className="h-5 w-5 p-0 text-muted-foreground hover:text-primary"
                title="Transfer to Outsourced"
                disabled={transferringKey === `${regId}||${p.parameterId}`}
                onClick={() => transferParamToOutsourced(regId, p.testId, p.parameterId, p.parameterName)}
              >
                {transferringKey === `${regId}||${p.parameterId}` ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <ArrowRightLeft className="h-3 w-3" />
                )}
              </Button>
            )}
            {p.isOutsourced && (() => {
              const snipDetail = outsourcedSnipDetails[`${regId}||${p.testId}`];
              if (snipDetail?.resultMode === "snip" && snipDetail.snipImageUrls.length > 0) {
                return (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-5 px-1 text-xs text-blue-600 hover:text-blue-800 gap-0.5"
                    title="View Snip"
                    onClick={() => { setViewSnipImages(snipDetail.snipImageUrls); setViewSnipContext({ regId, testId: p.testId }); }}
                  >
                    <Eye className="h-3 w-3" /> View
                  </Button>
                );
              }
              return null;
            })()}
          </div>
        </TableCell>
      </TableRow>
    );
  };

  // ─── Patient card (expanded) ───
  const renderPatientExpanded = (entry: PatientEntry) => {
    const reg = entry.registration;
    const machineGroups = groupByMachine(entry.parameters);
    const completion = getCompletionPct(entry);
    const unsaved = hasUnsavedChanges(reg.id);

    return (
      <div className="space-y-3 p-3 bg-muted/20 rounded-lg border">
        <div className="flex items-center gap-3">
          <div>
            <span className="font-semibold">{reg.invoice_number}</span>
            {reg.status !== "sample_accepted" && Array.isArray(reg.accepted_samples) && reg.accepted_samples.length > 0 && (
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
          <Badge variant={completion === 100 ? "default" : "outline"} className="text-xs">
            {completion}% Complete
          </Badge>
        </div>

        {/* Incomplete tests warning */}
        {entry.incompleteTests.length > 0 && (
          <div className="space-y-1">
            {entry.incompleteTests.map(t => (
              <div key={t.testId} className="flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded text-sm">
                <FlaskConical className="h-4 w-4 text-amber-600 shrink-0" />
                <span className="font-medium text-amber-800">{t.testName}</span>
                <span className="text-amber-600">— No parameters configured. Please complete test setup in Report Parameters to enter results.</span>
              </div>
            ))}
          </div>
        )}

        {/* Snip-only outsourced tests */}
        {entry.snipOnlyTests.length > 0 && (
          <div className="space-y-1">
            {entry.snipOnlyTests.map(st => {
              const testKey = `${reg.id}||${st.testId}`;
              const isTestSaving = saveMutation.isPending && savingTestKey === testKey;
              return (
                <div key={st.testId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-blue-50 border border-blue-200 rounded text-sm">
                  <div className="flex items-center gap-2">
                    <Package className="h-4 w-4 text-blue-600 shrink-0" />
                    <span className="font-medium text-blue-800">{st.testName}</span>
                    {st.labName && <Badge variant="outline" className="text-[10px] text-green-600 border-green-300">{st.labName}</Badge>}
                    <Button size="sm" variant="ghost" className="h-5 px-1 text-xs text-blue-600 gap-0.5" onClick={() => { setViewSnipImages(st.snipUrls); setViewSnipContext({ regId: reg.id, testId: st.testId }); }}>
                      <Eye className="h-3 w-3" /> View Snip ({st.snipUrls.length} page{st.snipUrls.length > 1 ? "s" : ""})
                    </Button>
                  </div>
                  <Button size="sm" variant="outline" className="h-6 text-[11px] gap-1" disabled={isTestSaving} onClick={() => handleSaveAndVerify(entry, st.testId, st.testName)}>
                    {isTestSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <SendHorizonal className="h-3 w-3" />}
                    Save & Verify
                  </Button>
                </div>
              );
            })}
          </div>
        )}

        {machineGroups.map((mg) => (
          <div key={mg.machineName} className="space-y-1">
            <div className="text-xs font-semibold text-primary uppercase tracking-wider px-1 pt-2 border-b border-primary/20 pb-1 flex items-center gap-1.5">
              <Monitor className="h-3.5 w-3.5" /> {mg.machineName}
            </div>
            {groupByTest(mg.params).map((tg) => {
              const testKey = `${reg.id}||${tg.testId}`;
              const isTestSaving = saveMutation.isPending && savingTestKey === testKey;
              const isFullTestOutsourced = transferredTestKeys.has(testKey);
              const testSnipDetail = outsourcedSnipDetails[testKey];
              const isTestExpanded = expandedTests.has(testKey);
              const filledCount = tg.params.filter(p => {
                const k = `${reg.id}||${p.parameterId}`;
                const v = editedValues[k] !== undefined ? editedValues[k] : p.resultValue;
                return v && v.trim() !== "";
              }).length;
              const toggleTest = () => {
                setExpandedTests(prev => {
                  const next = new Set(prev);
                  if (next.has(testKey)) next.delete(testKey); else next.add(testKey);
                  return next;
                });
              };
              return (
                <div key={tg.testId} className="ml-1">
                  <div
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 sm:gap-0 px-2 py-1.5 bg-muted/40 rounded cursor-pointer hover:bg-muted/60 transition-colors"
                    onClick={toggleTest}
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      {isTestExpanded ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
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
                      <Badge variant="outline" className="text-[10px]">{filledCount}/{tg.params.length}</Badge>
                      {isFullTestOutsourced && (() => {
                        const allHaveResults = tg.params.every(p => {
                          const k = `${reg.id}||${p.parameterId}`;
                          const v = editedValues[k] !== undefined ? editedValues[k] : p.resultValue;
                          return v && v.trim() !== "";
                        });
                        return (testSnipDetail?.status === "sent" || testSnipDetail?.status === "results_saved" || testSnipDetail?.status === "results_entered") && testSnipDetail?.labName ? (
                          <Badge variant="outline" className={`text-[10px] ${allHaveResults || testSnipDetail?.status === "results_entered" ? "text-green-600 border-green-300" : "text-blue-600 border-blue-300"}`}>{testSnipDetail.labName}</Badge>
                        ) : (
                          <Badge variant="outline" className="text-[10px] text-purple-600 border-purple-300">Outsourced</Badge>
                        );
                      })()}
                      <StickyNote
                        className={`inline h-3.5 w-3.5 cursor-pointer shrink-0 ${getTestNote(reg.id, tg.testId) ? 'text-amber-600' : 'text-muted-foreground hover:text-primary'}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (activeTestNoteKey === testKey) { setActiveTestNoteKey(null); }
                          else {
                            setActiveTestNoteKey(testKey);
                            const cur = getTestNote(reg.id, tg.testId);
                            if (!cur) setEditedTestNotes(prev => ({ ...prev, [testKey]: "Kindly correlate clinically" }));
                          }
                        }}
                      />
                    </div>
                    <div className="flex items-center gap-1 flex-wrap" onClick={e => e.stopPropagation()}>
                      {!isFullTestOutsourced && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 text-[11px] gap-1 text-muted-foreground hover:text-primary"
                          disabled={transferringKey === testKey}
                          onClick={() => transferToOutsourced(reg.id, tg.testId, tg.testName)}
                        >
                          {transferringKey === testKey ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <ArrowRightLeft className="h-3 w-3" />
                          )}
                          <span className="hidden sm:inline">Transfer to Outsourced</span><span className="sm:hidden">Outsource</span>
                        </Button>
                      )}
                      {(isFullTestOutsourced || tg.params.some((p) => p.isOutsourced)) && !(snipEntryKeys.has(testKey) || testSnipDetail?.resultMode === "snip") && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-[11px] gap-1 border-blue-300 text-blue-700 hover:bg-blue-50"
                          onClick={() => {
                            const hasTyped = tg.params.some((p) => {
                              const k = `${reg.id}||${p.parameterId}`;
                              const v = editedValues[k] !== undefined ? editedValues[k] : p.resultValue;
                              return !!(v && v.trim());
                            });
                            beginSnipEntry(reg.id, tg.testId, tg.testName, hasTyped);
                          }}
                        >
                          <Image className="h-3.5 w-3.5" />
                          Add snipped image
                        </Button>
                      )}
                      {(isFullTestOutsourced || tg.params.some((p) => p.isOutsourced)) && (snipEntryKeys.has(testKey) || testSnipDetail?.resultMode === "snip") && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-[11px] gap-1"
                          onClick={() => beginManualEntry(reg.id, tg.testId, tg.testName, (testSnipDetail?.snipImageUrls?.length || 0) > 0)}
                        >
                          <Keyboard className="h-3.5 w-3.5" />
                          Type parameter values
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 text-[11px] gap-1"
                        disabled={isTestSaving}
                        onClick={() => handleSaveAndVerify(entry, tg.testId, tg.testName)}
                      >
                        {isTestSaving ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <SendHorizonal className="h-3 w-3" />
                        )}
                        Save & Verify
                      </Button>
                    </div>
                  </div>
                  {activeTestNoteKey === testKey && (
                    <div className="flex items-center gap-1 mt-1 px-2" onClick={e => e.stopPropagation()}>
                      <Input
                        value={getTestNote(reg.id, tg.testId)}
                        onChange={e => setEditedTestNotes(prev => ({ ...prev, [testKey]: e.target.value }))}
                        className="h-6 text-xs w-full"
                        placeholder="Kindly correlate clinically"
                        autoFocus
                      />
                      <Trash2 className="h-3.5 w-3.5 text-destructive cursor-pointer shrink-0" onClick={() => { setEditedTestNotes(prev => ({ ...prev, [testKey]: "" })); setActiveTestNoteKey(null); }} />
                    </div>
                  )}
                  {getTestNote(reg.id, tg.testId) && activeTestNoteKey !== testKey && (
                    <div className="flex items-center gap-1 mt-0.5 px-2" onClick={e => e.stopPropagation()}>
                      <div className="text-xs font-bold text-amber-700 cursor-pointer" onClick={() => setActiveTestNoteKey(testKey)}>
                        📝 {getTestNote(reg.id, tg.testId)}
                      </div>
                      <Trash2 className="h-3 w-3 text-destructive/60 hover:text-destructive cursor-pointer shrink-0" onClick={() => setEditedTestNotes(prev => ({ ...prev, [testKey]: "" }))} />
                    </div>
                  )}
                  {isTestExpanded && (snipEntryKeys.has(testKey) || testSnipDetail?.resultMode === "snip") && (
                    <div className="mt-2 space-y-2 px-1" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-[11px] gap-1"
                          onClick={() => beginManualEntry(reg.id, tg.testId, tg.testName, (testSnipDetail?.snipImageUrls?.length || 0) > 0)}
                        >
                          <Keyboard className="h-3.5 w-3.5" /> Type parameter values
                        </Button>
                      </div>
                      <SnipOnLetterhead
                        regId={reg.id}
                        testId={tg.testId}
                        imageUrls={testSnipDetail?.snipImageUrls || []}
                        isUploading={uploadingSnipKey === testKey}
                        onPaste={handlePatientSnipPaste}
                        onFileUpload={handlePatientSnipUpload}
                        onDeletePage={handlePatientSnipDeletePage}
                      />
                      {(testSnipDetail?.snipImageUrls?.length || 0) > 0 && (
                        <div className="flex justify-end">
                          <Button
                            size="sm"
                            onClick={() => savePatientSnipResults(reg.id, tg.testId, tg.testName)}
                            disabled={savingSnipKey === testKey}
                          >
                            {savingSnipKey === testKey ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}
                            Save Snipped Image
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                  {isTestExpanded && !(snipEntryKeys.has(testKey) || testSnipDetail?.resultMode === "snip") && (
                    <div className="overflow-x-auto -mx-1">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="py-1 text-xs w-[80px]">Code</TableHead>
                          <TableHead className="py-1 text-xs">Parameter</TableHead>
                          <TableHead className="py-1 text-xs w-[100px]">Prev 2</TableHead>
                          <TableHead className="py-1 text-xs w-[100px]">Prev 1</TableHead>
                          <TableHead className="py-1 text-xs w-[200px]">Result</TableHead>
                          <TableHead className="py-1 text-xs w-[60px]">Unit</TableHead>
                          <TableHead className="py-1 text-xs w-[120px]">Ref. Range</TableHead>
                          <TableHead className="py-1 text-xs w-[70px] text-center">Flag</TableHead>
                          <TableHead className="py-1 text-xs w-[70px] text-center">Status</TableHead>
                          <TableHead className="py-1 text-xs w-[40px] text-center" title="Outsource"></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {tg.params.map(p => renderParamRow(entry, p))}
                      </TableBody>
                    </Table>
                    </div>
                  )}
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
      <SyncingOverlay target="results" visibleIds={regIds} />
      {/* Mode tabs */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 flex-wrap">
        <div className="relative w-full sm:flex-1 sm:max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search patient, invoice, mobile…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Tabs value={mode} onValueChange={v => setMode(v as any)} className="w-auto">
          <TabsList className="h-9">
            <TabsTrigger value="patient" className="text-xs gap-1 h-7">
              <User className="h-3.5 w-3.5" /> Patient Wise
            </TabsTrigger>
            <TabsTrigger value="machine" className="text-xs gap-1 h-7">
              <Monitor className="h-3.5 w-3.5" /> Machine Wise
            </TabsTrigger>
            <TabsTrigger value="outsourced" className="text-xs gap-1 h-7">
              <Package className="h-3.5 w-3.5" /> Outsourced
            </TabsTrigger>
          </TabsList>
        </Tabs>
        {mode === "machine" && (
          <Select value={selectedMachine} onValueChange={setSelectedMachine}>
            <SelectTrigger className="w-[200px] h-9">
              <SelectValue placeholder="All Machines" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Machines</SelectItem>
              {(() => {
                const machines = new Set<string>();
                masterMachines.forEach((m: any) => { if (m.value) machines.add(m.value); });
                Object.values(testsInstrumentMap).forEach((inst) => {
                  if (inst) machines.add(inst);
                });
                machines.add("Others");
                return Array.from(machines).sort((a, b) => (a === "Others" ? 1 : b === "Others" ? -1 : a.localeCompare(b)));
              })().map((m) => (
                <SelectItem key={m} value={m === "Others" ? "others" : m}>{m}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <RefreshButton
          queryKeys={[
            "results_accepted_count",
            "results_accepted_regs",
            "results_machine_filtered_ids",
            "results_tests_instrument_map",
            ...(expandedPatient
              ? ["patient_results_existing", "results_accepted_tubes", "results_outsourced_snips", "results_reg_detail"]
              : []),
          ]}
          className="ml-auto shrink-0"
        />
        <PageSizeSelect
          value={pageSize}
          onChange={(n) => { setPageSize(n); setRePage(0); }}
        />
      </div>

      {/* Stats bar - only for in-house modes */}
      {mode !== "outsourced" && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Card className="p-3">
            <div className="text-xs text-muted-foreground">Patients</div>
            <div className="text-xl font-bold">{stats.totalPatients}</div>
          </Card>
          <Card className="p-3">
            <div className="text-xs text-muted-foreground">Total Parameters</div>
            <div className="text-xl font-bold">{stats.totalParams}</div>
          </Card>
          <Card className="p-3">
            <div className="text-xs text-muted-foreground">Entered</div>
            <div className="text-xl font-bold text-green-600">{stats.enteredParams}</div>
          </Card>
          <Card className="p-3">
            <div className="text-xs text-muted-foreground">Pending</div>
            <div className="text-xl font-bold text-orange-600">{stats.pendingParams}</div>
          </Card>
          <Card className="p-3">
            <div className="text-xs text-muted-foreground flex items-center gap-1"><Wifi className="h-3 w-3" /> Awaiting Interface</div>
            <div className="text-xl font-bold text-blue-600">{stats.awaitingInterface}</div>
          </Card>
        </div>
      )}

      {/* Outsourced mode */}
      {mode === "outsourced" ? (
        <OutsourcedResults externalSearch={search} />
      ) : (
        <>
          {/* Patient list */}
          {(listLoading) ? (
            <Card><CardContent className="p-8 text-center text-muted-foreground">Loading…</CardContent></Card>
          ) : filteredEntries.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center text-muted-foreground">
                <FlaskConical className="h-8 w-8 mx-auto mb-2 opacity-40" />
                {machineFilterActive
                  ? `No pending results for ${selectedMachine === "others" ? "Others" : selectedMachine}`
                  : "No accepted samples pending results"}
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {filteredEntries.map(entry => {
                const reg = entry.registration;
                const isExpanded = expandedPatient === reg.id;
                const detailLoading = isExpanded && !detailReady;
                const completion = isExpanded && detailReady ? getCompletionPct(entry) : 0;
                const pendingCount = isExpanded && detailReady ? entry.parameters.filter(p => {
                  const key = `${reg.id}||${p.parameterId}`;
                  const val = editedValues[key] !== undefined ? editedValues[key] : p.resultValue;
                  return !val;
                }).length : 0;
                const awaitingCount = isExpanded && detailReady ? entry.parameters.filter(p => {
                  const key = `${reg.id}||${p.parameterId}`;
                  const val = editedValues[key] !== undefined ? editedValues[key] : p.resultValue;
                  return p.sendForInterface && !p.isCalculated && !val;
                }).length : 0;

                return (
                  <Card key={reg.id} className={isExpanded ? "ring-1 ring-primary/30" : ""}>
                    <div
                      className="flex flex-wrap items-center gap-2 sm:gap-3 p-3 cursor-pointer hover:bg-muted/30 transition-colors"
                      onClick={() => { markArrivalSeen(reg.id); setExpandedPatient(isExpanded ? null : reg.id); }}
                    >
                      {isExpanded ? <ChevronUp className="h-4 w-4 shrink-0" /> : <ChevronDown className="h-4 w-4 shrink-0" />}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium font-mono">{reg.invoice_number}</span>
                          <NewBadge show={isNewArrival(reg.id)} />
                          {reg.status !== "sample_accepted" && Array.isArray(reg.accepted_samples) && reg.accepted_samples.length > 0 && (
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
                          {reg.mobile_number}
                          {isExpanded && detailReady ? ` • ${entry.parameters.length} parameters` : ""}
                        </div>
                      </div>
                      {isExpanded && detailReady && entry.incompleteTests.length > 0 && (
                        <Badge variant="outline" className="text-xs text-amber-600 border-amber-300 gap-0.5">
                          <FlaskConical className="h-3 w-3" /> {entry.incompleteTests.length} test{entry.incompleteTests.length > 1 ? "s" : ""} need setup
                        </Badge>
                      )}
                      <div className="flex items-center gap-2 shrink-0 flex-wrap">
                        {isExpanded && detailReady && awaitingCount > 0 && (
                          <Badge variant="outline" className="text-xs text-orange-600 border-orange-300 gap-0.5">
                            <Wifi className="h-3 w-3" /> {awaitingCount}
                          </Badge>
                        )}
                        {isExpanded && detailReady && pendingCount > 0 && (
                          <Badge variant="outline" className="text-xs">{pendingCount} pending</Badge>
                        )}
                        {isExpanded && detailReady && (
                          <>
                            <div className="w-16 h-2 bg-muted rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all ${completion === 100 ? "bg-green-500" : "bg-primary"}`}
                                style={{ width: `${completion}%` }}
                              />
                            </div>
                            <span className="text-xs text-muted-foreground w-8 text-right">{completion}%</span>
                          </>
                        )}
                        {hasUnsavedChanges(reg.id) && (
                          <div className="w-2 h-2 rounded-full bg-orange-500" title="Unsaved" />
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2"
                          disabled={refreshingRegId === reg.id}
                          title="Pull latest results from LIMS interface"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRefreshFromLims(reg.id);
                          }}
                        >
                          {refreshingRegId === reg.id
                            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            : <RefreshCw className="h-3.5 w-3.5" />}
                        </Button>
                      </div>
                    </div>
                    {isExpanded && (
                      <CardContent className="pt-0 pb-3 px-3">
                        {detailLoading ? (
                          <div className="py-6 text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
                            <Loader2 className="h-4 w-4 animate-spin" /> Loading results…
                          </div>
                        ) : (
                          renderPatientExpanded(entry)
                        )}
                      </CardContent>
                    )}
                  </Card>
                );
              })}
            </div>
          )}
        </>
      )}
      {/* Blank values detailed dialog */}
      <Dialog open={!!blankConfirmTestParams} onOpenChange={open => {
        if (!open) {
          setBlankConfirmTestParams(null);
        }
      }}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-lg">
              Blank Result Values — {blankConfirmTestParams?.testName}
            </DialogTitle>
            <p className="text-sm text-muted-foreground mt-1">
              {blankParamCount} parameter{blankParamCount !== 1 ? "s have" : " has"} blank values. You can fill them below or send to verification as-is.
            </p>
          </DialogHeader>
          {blankConfirmTestParams && (() => {
            const { entry, testId } = blankConfirmTestParams;
            const reg = entry.registration;
            const blankParams = entry.parameters.filter(p => {
              if (p.testId !== testId || p.isCalculated) return false;
              return blankParamIds.has(p.parameterId);
            });
            return (
              <div className="border rounded-lg overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="py-2 text-xs w-[80px]">Code</TableHead>
                      <TableHead className="py-2 text-xs">Parameter</TableHead>
                      <TableHead className="py-2 text-xs w-[180px]">Result</TableHead>
                      <TableHead className="py-2 text-xs w-[80px]">Unit</TableHead>
                      <TableHead className="py-2 text-xs w-[120px]">Ref. Range</TableHead>
                      <TableHead className="py-2 text-xs w-[80px] text-center">Flag</TableHead>
                      <TableHead className="py-2 text-xs w-[90px] text-center">Status</TableHead>
                      <TableHead className="py-2 text-xs w-[50px] text-center"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {blankParams.map(p => {
                      const key = `${reg.id}||${p.parameterId}`;
                      const currentValue = editedValues[key] !== undefined ? editedValues[key] : p.resultValue;
                      const flag = p.isOutsourced && editedFlags[key] !== undefined ? editedFlags[key] : calculateFlag(currentValue, p.normalRangeLow, p.normalRangeHigh, p.rangeType, p.expectedValue, p.descriptiveOptions, p.normalRangeText, p.unit, p.normalFindings);
                      const isInterfaceParameter = p.sendForInterface && !p.isCalculated;
                      const isAwaiting = isInterfaceParameter && !currentValue;
                      return (
                        <TableRow key={key} className="bg-yellow-50">
                          <TableCell className="py-2 text-xs font-mono text-muted-foreground">{p.paramCode}</TableCell>
                          <TableCell className="py-2 text-sm font-medium">{p.parameterName}</TableCell>
                          <TableCell className="py-2">
                            {p.rangeType === "time" ? (
                              <TimeResultInput
                                value={currentValue}
                                onChange={(v) => handleValueChange(reg.id, p.parameterId, v, entry)}
                                onKeyDown={handleResultTabKey}
                              />
                            ) : p.rangeType === "qualitative" && getQualitativeOptions(p.expectedValue).length > 0 ? (
                              <Select
                                value={currentValue || undefined}
                                onValueChange={(v) => handleValueChange(reg.id, p.parameterId, v, entry)}
                              >
                                <SelectTrigger className="h-7 text-sm w-full" data-result-input="" data-result-value={currentValue || ""} onKeyDown={handleResultTabKey}>
                                  <SelectValue placeholder="Select..." />
                                </SelectTrigger>
                                <SelectContent>
                                  {getQualitativeOptions(p.expectedValue).map((opt: string) => (
                                    <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            ) : p.rangeType === "descriptive" && p.descriptiveOptions.length > 0 ? (
                              <DescriptiveCombobox
                                value={currentValue}
                                options={p.descriptiveOptions}
                                onChange={(v) => handleValueChange(reg.id, p.parameterId, v, entry)}
                                onKeyDown={handleResultTabKey}
                                className="w-full"
                              />
                            ) : (
                              <Input
                                value={currentValue}
                                onChange={e => handleValueChange(reg.id, p.parameterId, e.target.value, entry)}
                                className="h-7 text-sm w-full"
                                placeholder="Enter result"
                                data-result-input=""
                                onKeyDown={handleResultTabKey}
                              />
                            )}
                          </TableCell>
                          <TableCell className="py-2 text-xs text-muted-foreground">
                            {p.isOutsourced ? (
                              <Input
                                value={editedUnits[key] !== undefined ? editedUnits[key] : (p.unit || "")}
                                onChange={e => setEditedUnits(prev => ({ ...prev, [key]: e.target.value }))}
                                className="h-6 text-xs w-[70px]"
                                placeholder="Unit"
                              />
                            ) : p.unit}
                          </TableCell>
                          <TableCell className="py-2 text-xs text-muted-foreground">
                            {p.isOutsourced ? (
                              <Input
                                value={editedRefRanges[key] !== undefined ? editedRefRanges[key] : (p.referenceRange || "")}
                                onChange={e => setEditedRefRanges(prev => ({ ...prev, [key]: e.target.value }))}
                                className="h-6 text-xs w-[100px]"
                                placeholder="Ref Range"
                              />
                            ) : p.referenceRange}
                          </TableCell>
                          <TableCell className="py-2 text-center">
                            {p.isOutsourced ? (
                              <Select
                                value={flag || "none"}
                                onValueChange={(v) => setEditedFlags(prev => ({ ...prev, [key]: v === "none" ? "" : v }))}
                              >
                                <SelectTrigger className="h-6 text-xs w-[75px]">
                                  <SelectValue />
                                </SelectTrigger>
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
                                {!flag && <Badge variant="outline" className="text-xs">—</Badge>}
                              </>
                            )}
                          </TableCell>
                          <TableCell className="py-2 text-center">
                            {p.isOutsourced ? (
                              <Badge variant="outline" className="text-xs text-purple-600 border-purple-300">Outsourced</Badge>
                            ) : isAwaiting ? (
                              <Badge variant="outline" className="text-xs text-orange-600 border-orange-300 gap-0.5">
                                <Wifi className="h-3 w-3" /> Awaiting
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-xs">Pending</Badge>
                            )}
                          </TableCell>
                          <TableCell className="py-2 text-center">
                            {!p.isOutsourced && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-5 w-5 p-0 text-muted-foreground hover:text-primary"
                                title="Transfer to Outsourced"
                                onClick={() => transferParamToOutsourced(reg.id, p.testId, p.parameterId, p.parameterName)}
                              >
                                <ArrowRightLeft className="h-3 w-3" />
                              </Button>
                            )}
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
            <Button variant="outline" onClick={() => {
              setBlankConfirmTestParams(null);
            }}>
              Cancel & Review
            </Button>
            <Button onClick={() => {
              if (blankConfirmTestParams) {
                const { entry, testId, testName } = blankConfirmTestParams;
                const issue = getDifferentialIssue(entry, testId);
                setBlankConfirmTestParams(null);
                if (issue) {
                  setDiffConfirm({ entry, testId, testName, sum: issue.sum, diff: issue.diff });
                  return;
                }
                clearAutoSaveTimer(entry.registration.id, testId);
                saveInFlightRef.current.add(`${entry.registration.id}||${testId}`);
                setSavingTestKey(`${entry.registration.id}||${testId}`);
                saveMutation.mutate({ entry, testId });
              }
            }}>
              <SendHorizonal className="h-4 w-4 mr-1" />
              Send to Verification
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
              <div className="space-y-1 text-sm">
                <div><span className="font-medium">Test:</span> {diffConfirm?.testName}</div>
                <div><span className="font-medium">Current sum:</span> {diffConfirm?.sum}</div>
                <div>
                  <span className="font-medium">Difference to 100:</span>{" "}
                  <span className={(diffConfirm?.diff ?? 0) === 0 ? "" : "text-destructive font-semibold"}>
                    {diffConfirm?.diff}
                  </span>{" "}
                  <span className="text-muted-foreground">
                    ({(diffConfirm?.diff ?? 0) > 0 ? "less" : (diffConfirm?.diff ?? 0) < 0 ? "more" : "exact"})
                  </span>
                </div>
                <div className="text-muted-foreground pt-1">The sum of WBC differential parameters should be exactly 100. You can continue saving anyway.</div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => {
              if (diffConfirm) {
                const { entry, testId } = diffConfirm;
                setDiffConfirm(null);
                clearAutoSaveTimer(entry.registration.id, testId);
                saveInFlightRef.current.add(`${entry.registration.id}||${testId}`);
                setSavingTestKey(`${entry.registration.id}||${testId}`);
                saveMutation.mutate({ entry, testId });
              }
            }}>Continue Anyway</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {/* Snip Image Viewer Dialog */}
      <Dialog open={!!viewSnipImages} onOpenChange={open => { if (!open) { setViewSnipImages(null); setViewSnipContext(null); } }}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between">
              <span>Outsourced Result — Snipped Images</span>
              <Button
                size="sm"
                variant="destructive"
                className="gap-1"
                disabled={removingSnip}
                onClick={removeSnipImages}
              >
                {removingSnip ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                Remove Snip
              </Button>
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {viewSnipImages?.map((url, idx) => (
              <div key={idx} className="border rounded-lg overflow-hidden">
                <img src={url} alt={`Snip page ${idx + 1}`} className="w-full object-contain" />
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
      <AlertDialog open={!!snipModeConfirm} onOpenChange={(open) => { if (!open) setSnipModeConfirm(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {snipModeConfirm?.target === "snip" ? "Switch to snipped image?" : "Switch to typed values?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {snipModeConfirm?.target === "snip"
                ? `Typed results for ${snipModeConfirm?.testName || "this test"} will be removed. You can only keep a snipped image or typed values — not both.`
                : `Snipped images for ${snipModeConfirm?.testName || "this test"} will be removed. You can only keep typed values or a snipped image — not both.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (!snipModeConfirm) return;
                const { regId, testId, target } = snipModeConfirm;
                setSnipModeConfirm(null);
                try {
                  if (target === "snip") await applySnipEntry(regId, testId);
                  else await applyManualEntry(regId, testId);
                } catch (err: any) {
                  toast.error(err.message || "Failed to switch entry method");
                }
              }}
            >
              Switch
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {reTotalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <Button variant="outline" size="sm" disabled={rePage === 0} onClick={() => setRePage(p => p - 1)}>Prev</Button>
          <span className="text-sm text-muted-foreground">Page {rePage + 1} of {reTotalPages} ({reCount} total)</span>
          <Button variant="outline" size="sm" disabled={rePage >= reTotalPages - 1} onClick={() => setRePage(p => p + 1)}>Next</Button>
        </div>
      )}
    </div>
  );
};

export default ResultsEntry;
