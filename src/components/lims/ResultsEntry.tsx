import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { recalculateRegistrationStatus } from "@/lib/limsStatus";
import { getCurrentUser, getCurrentUserName } from "@/lib/auth";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
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
import { Search, User, Monitor, Save, Calculator, Wifi, WifiOff, ChevronDown, ChevronUp, Check, Loader2, FlaskConical, Package, SendHorizonal, ArrowRightLeft, Eye, Trash2, StickyNote, RefreshCw } from "lucide-react";
import { DescriptiveCombobox } from "./DescriptiveCombobox";
import { useMasterLookup } from "@/hooks/useMasterLookup";
import { useRealtimeSync } from "@/hooks/useRealtimeSync";
import OutsourcedResults from "./OutsourcedResults";
import { format } from "date-fns";
import { toast } from "sonner";
import { formatDateDDMMYYYY } from "@/lib/utils";
import { expandRegistrationTests } from "@/lib/expandRegistrationTests";

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

const RE_PAGE_SIZE = 50;

const ResultsEntry = () => {
  const qc = useQueryClient();
  useRealtimeSync("outsourced_test_snips", ["results_outsourced_snips", "outsourced_snips", "outsourced_accepted_regs"]);
  useRealtimeSync("patient_results", ["patient_results_existing"]);
  const { data: masterMachines = [] } = useMasterLookup("machine_name");
  const [mode, setMode] = useState<"patient" | "machine" | "outsourced">("patient");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedMachine, setSelectedMachine] = useState<string>("all");
  const [expandedPatient, setExpandedPatient] = useState<string | null>(null);
  const [expandedTests, setExpandedTests] = useState<Set<string>>(new Set());
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
      qc.invalidateQueries({ queryKey: ["results_accepted_regs"] });
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

  const { data: reCount = 0 } = useQuery({
    queryKey: ["results_accepted_count", debouncedSearch],
    queryFn: async () => {
      let query = supabase.from("patient_registrations").select("id", { count: "exact", head: true })
        .in("status", ["sample_accepted", "partially_accepted", "processing", "partial_processing", "processed", "partial_verified", "verified", "partially_approved", "approved", "partially_dispatched", "dispatched"])
        .eq("bill_cancelled", false);
      if (debouncedSearch) query = query.or(`patient_name.ilike.%${debouncedSearch}%,mobile_number.ilike.%${debouncedSearch}%,invoice_number.ilike.%${debouncedSearch}%`);
      const { count } = await query;
      return count || 0;
    },
  });

  // ─── Fetch accepted registrations ───
  const { data: acceptedRegs = [], isLoading: loadingRegs } = useQuery({
    queryKey: ["results_accepted_regs", debouncedSearch, rePage],
    queryFn: async () => {
      let query = supabase
        .from("patient_registrations")
        .select("id, invoice_number, patient_name, mobile_number, umr_number, status, is_stat, tests, cancelled_tests, visit_type, gender, dob, created_at, updated_at, bill_cancelled, doctor_name")
        .in("status", ["sample_accepted", "partially_accepted", "processing", "partial_processing", "processed", "partial_verified", "verified", "partially_approved", "approved", "partially_dispatched", "dispatched"])
        .eq("bill_cancelled", false)
        .order("is_stat", { ascending: false })
        .order("invoice_number", { ascending: false })
        .range(rePage * RE_PAGE_SIZE, rePage * RE_PAGE_SIZE + RE_PAGE_SIZE - 1);
      if (debouncedSearch) {
        query = query.or(
          `patient_name.ilike.%${debouncedSearch}%,mobile_number.ilike.%${debouncedSearch}%,invoice_number.ilike.%${debouncedSearch}%`
        );
      }
      const { data, error } = await query;
      if (error) throw error;
      return (data || []) as any[];
    },
  });

  const reTotalPages = Math.ceil(reCount / RE_PAGE_SIZE);

  // (departments query removed – now using machine-wise grouping)

  // ─── Fetch tests master ───
  const { data: testsMap = {} } = useQuery({
    queryKey: ["results_tests_map"],
    queryFn: async () => {
      const { data } = await supabase.from("tests").select("id, test_name, department_id, instrument_name");
      const map: Record<string, any> = {};
      (data || []).forEach((t: any) => { map[t.id] = t; });
      return map;
    },
  });

  // ─── Fetch test_parameters with full param info ───
  const { data: testParamsMap = {} } = useQuery({
    queryKey: ["results_test_params_full"],
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
  });

  // ─── Fetch parameter_normal_ranges for age/gender-specific reference ranges ───
  const { data: normalRangesMap = {} } = useQuery({
    queryKey: ["results_normal_ranges"],
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
  });

  // ─── Fetch existing results for all accepted patients ───
  const regIds = acceptedRegs.map((r: any) => r.id);
  const { data: existingResults = [] } = useQuery({
    queryKey: ["patient_results_existing", regIds.join(",")],
    enabled: regIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("patient_results")
        .select("*")
        .in("registration_id", regIds);
      if (error) throw error;
      return (data || []) as any[];
    },
  });

  // ─── Fetch accepted sample_tubes to filter results by accepted tests only ───
  const { data: acceptedTubes = [] } = useQuery({
    queryKey: ["results_accepted_tubes", regIds.join(",")],
    enabled: regIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sample_tubes" as any)
        .select("registration_id, test_ids")
        .in("registration_id", regIds)
        .eq("status", "accepted");
      if (error) throw error;
      return (data || []) as any[];
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

  // ─── Fetch outsourced_test_snips to know which inhouse tests/params have been transferred ───
  const { data: outsourcedSnips = [] } = useQuery({
    queryKey: ["results_outsourced_snips", regIds.join(",")],
    enabled: regIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("outsourced_test_snips")
        .select("registration_id, test_id, outsourced_parameter_ids, outsource_status, outsourced_lab_name, sent_at, result_mode, snip_image_urls")
        .in("registration_id", regIds);
      if (error) throw error;
      return (data || []) as any[];
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

  // ─── Helper: resolve best normal range for a parameter given patient demographics ───
  const resolveNormalRange = useCallback((parameterId: string, reg: any) => {
    const ranges = normalRangesMap[parameterId];
    if (!ranges || ranges.length === 0) return { text: "", low: null as number | null, high: null as number | null, rangeType: "numeric", descriptiveOptions: [] as string[], expectedValue: "" };

    // Parse patient age (from dob or age text in registration)
    let patientAge: number | null = null;
    if (reg.dob) {
      const birth = new Date(reg.dob);
      const now = new Date();
      patientAge = Math.floor((now.getTime() - birth.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
    }
    const patientGender = (reg.gender || "").toLowerCase().charAt(0); // 'm' or 'f'

    // Filter by gender
    let candidates = ranges.filter((r: any) => {
      const g = (r.gender || "all").toLowerCase();
      if (g === "all") return true;
      if (g === "male" && patientGender === "m") return true;
      if (g === "female" && patientGender === "f") return true;
      return false;
    });

    // Filter by age if patient age is known
    if (patientAge != null) {
      const ageMatched = candidates.filter((r: any) => {
        if (r.age_min == null && r.age_max == null) return true;
        if (r.age_min != null && patientAge! < r.age_min) return false;
        if (r.age_max != null && patientAge! > r.age_max) return false;
        return true;
      });
      if (ageMatched.length > 0) candidates = ageMatched;
    }

    // Pick the most specific (prefer gender-specific over 'all')
    const best = candidates.find((r: any) => (r.gender || "all").toLowerCase() !== "all") || candidates[0];
    if (!best) return { text: "", low: null as number | null, high: null as number | null, rangeType: "numeric", descriptiveOptions: [] as string[], expectedValue: "" };

    const text = best.normal_range_text || (best.normal_range_low != null && best.normal_range_high != null ? `${best.normal_range_low} - ${best.normal_range_high}` : "");
    const rangeType = best.range_type || "numeric";
    const descriptiveOptions = Array.isArray(best.descriptive_options) ? best.descriptive_options : [];
    const expectedValue = best.expected_value || "";
    return { text, low: best.normal_range_low as number | null, high: best.normal_range_high as number | null, rangeType, descriptiveOptions, expectedValue };
  }, [normalRangesMap]);

  // ─── Build patient entries (includes outsourced tests/params with badges) ───
  const patientEntries: PatientEntry[] = useMemo(() => {
    return acceptedRegs.map((reg: any) => {
      const tests = (reg.tests || []) as any[];
      const cancelledIds = new Set(((reg.cancelled_tests || []) as any[]).map((t: any) => t.test_id));
      const acceptedTestIds = acceptedTestIdsByReg[reg.id];
      // Expand PRL/HLT container rows into their leaf tests using accepted-tube test_ids
      const expandedTests = expandRegistrationTests(tests, acceptedTestIds ?? new Set<string>(), testsMap);
      const activeTests = expandedTests.filter((t: any) => !cancelledIds.has(t.test_id) && acceptedTestIds?.has(t.test_id));

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
        
        // Track tests with no parameters configured
        const validParams = params.filter((tp: any) => !tp.is_subheader && tp.report_test_parameters);
        if (validParams.length === 0) {
          // Check if this is a snip-only outsourced test
          if (snipDetail && snipDetail.snipImageUrls.length > 0 && !["results_entered", "verified", "approved", "dispatched"].includes(snipDetail.status)) {
            snipOnlyTests.push({ testId: t.test_id, testName: t.test_name || testInfo.test_name || "", labName: snipDetail.labName, snipUrls: snipDetail.snipImageUrls, outsourceStatus: snipDetail.status });
          } else if (!snipDetail || snipDetail.snipImageUrls.length === 0) {
            incompleteTests.push({ testId: t.test_id, testName: t.test_name || testInfo.test_name || "" });
          }
          continue;
        }
        
        // Collect params for this test first to check if ALL are already entered
        const testParamResults: { param: any; tp: any; isParamOutsourced: boolean; existing: any }[] = [];
        for (const tp of params) {
          if (tp.is_subheader) continue;
          const p = tp.report_test_parameters;
          if (!p) continue;
          const isParamOutsourced = isFullTestOutsourced || (paramOutsourcedSet && paramOutsourcedSet.has(p.id));
          const existing = existingResults.find(
            (r: any) => r.registration_id === reg.id && r.parameter_id === p.id
          );
          testParamResults.push({ param: p, tp, isParamOutsourced, existing });
        }
        
        // Skip this test entirely if ALL its parameters have status 'entered' (already sent to verification)
        if (testParamResults.length > 0 && testParamResults.every(({ existing }) => existing?.status === "entered")) {
          continue;
        }

        for (const { param: p, tp, isParamOutsourced, existing } of testParamResults) {
          const resolved = resolveNormalRange(p.id, reg);
          const refText = resolved.text || p.normal_range_text || (p.normal_range_low != null && p.normal_range_high != null ? `${p.normal_range_low} - ${p.normal_range_high}` : "");
          const rangeLow = resolved.low ?? p.normal_range_low;
          const rangeHigh = resolved.high ?? p.normal_range_high;

          // For outsourced params, use saved values from patient_results if available
          const savedUnit = isParamOutsourced && existing?.unit ? existing.unit : (p.unit || "");
          const savedRefRange = isParamOutsourced && existing?.reference_range ? existing.reference_range : refText;

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
            isOutsourced: !!isParamOutsourced,
            outsourceLabName: isParamOutsourced ? (snipDetail?.labName || null) : null,
            outsourceStatus: isParamOutsourced ? (snipDetail?.status || "pending") : "",
            isSnipMode: isParamOutsourced && snipDetail?.resultMode === "snip",
            note: existing?.note || "",
          });
        }
      }
      return { registration: reg, parameters, incompleteTests, snipOnlyTests };
    }).filter(entry => entry.parameters.length > 0 || entry.incompleteTests.length > 0 || entry.snipOnlyTests.length > 0);
  }, [acceptedRegs, testsMap, testParamsMap, existingResults, resolveNormalRange, transferredTestKeys, outsourcedParamSets, outsourcedSnipDetails, acceptedTestIdsByReg]);

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
  const calculateFlag = (value: string, low: number | null, high: number | null, rangeType?: string, expectedValue?: string): string => {
    if (!value || value.trim() === "") return "";
    if (rangeType === "qualitative") {
      if (!expectedValue) return "";
      return value.trim().toLowerCase() === expectedValue.trim().toLowerCase() ? "N" : "A";
    }
    if (rangeType === "descriptive") return ""; // no flag for descriptive
    const num = parseFloat(value);
    if (isNaN(num)) return "";
    if (low != null && num < low) return "L";
    if (high != null && num > high) return "H";
    return "N";
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

  // ─── Auto-save (saves with status "pending", does NOT transfer) ───
  const autoSaveTest = async (regId: string, testId: string, entry: PatientEntry, currentEdits: Record<string, string>) => {
    const testParams = entry.parameters.filter(p => p.testId === testId);
    const upserts: any[] = [];
    for (const p of testParams) {
      const key = `${regId}||${p.parameterId}`;
      const value = currentEdits[key] !== undefined ? currentEdits[key] : p.resultValue;
      const autoFlag = calculateFlag(value, p.normalRangeLow, p.normalRangeHigh, p.rangeType, p.expectedValue);
      const flag = p.isOutsourced && editedFlags[key] !== undefined ? editedFlags[key] : autoFlag;
      const unit = p.isOutsourced && editedUnits[key] !== undefined ? editedUnits[key] : p.unit;
      const refRange = p.isOutsourced && editedRefRanges[key] !== undefined ? editedRefRanges[key] : p.referenceRange;
      upserts.push({
        registration_id: regId,
        test_id: p.testId,
        parameter_id: p.parameterId,
        param_code: p.paramCode,
        parameter_name: p.parameterName,
        result_value: value || null,
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
      // Get outsourced param IDs to preserve their results
      const outsourcedParams = outsourcedParamSets[`${regId}||${testId}`];
      if (outsourcedParams && outsourcedParams.size > 0) {
        // Delete only non-outsourced params
        const paramIdsToDelete = upserts.map(u => u.parameter_id);
        for (const pid of paramIdsToDelete) {
          await supabase.from("patient_results").delete().eq("registration_id", regId).eq("test_id", testId).eq("parameter_id", pid);
        }
      } else {
        await supabase.from("patient_results").delete().eq("registration_id", regId).eq("test_id", testId);
      }
      await supabase.from("patient_results").insert(upserts as any);
    } catch {
      // silent auto-save failure
    }
  };

  // ─── Save & send to verification (per-test) ───
  const [savingTestKey, setSavingTestKey] = useState<string | null>(null);
  const [blankConfirmTestParams, setBlankConfirmTestParams] = useState<{ entry: PatientEntry; testId: string; testName: string } | null>(null);
  const [blankParamIds, setBlankParamIds] = useState<Set<string>>(new Set());

  const saveMutation = useMutation({
    mutationFn: async ({ entry, testId }: { entry: PatientEntry; testId: string }) => {
      const reg = entry.registration;
      const testParams = entry.parameters.filter(p => p.testId === testId);
      const upserts: any[] = [];

      for (const p of testParams) {
        const key = `${reg.id}||${p.parameterId}`;
        const value = editedValues[key] !== undefined ? editedValues[key] : p.resultValue;
        const autoFlag = calculateFlag(value, p.normalRangeLow, p.normalRangeHigh, p.rangeType, p.expectedValue);
        const flag = p.isOutsourced && editedFlags[key] !== undefined ? editedFlags[key] : autoFlag;
        const unit = p.isOutsourced && editedUnits[key] !== undefined ? editedUnits[key] : p.unit;
        const refRange = p.isOutsourced && editedRefRanges[key] !== undefined ? editedRefRanges[key] : p.referenceRange;
        upserts.push({
          registration_id: reg.id,
          test_id: p.testId,
          parameter_id: p.parameterId,
          param_code: p.paramCode,
          parameter_name: p.parameterName,
          result_value: value || null,
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
        });
      }

      // Snip-only test (no parameters) — just update outsourced_test_snips status
      if (upserts.length === 0) {
        await supabase.from("outsourced_test_snips").update({ outsource_status: "results_entered" } as any).eq("registration_id", reg.id).eq("test_id", testId).in("outsource_status", ["pending", "sent", "results_saved"]);
        return;
      }

      // Delete existing results for this specific test only, preserving outsourced param results
      const outsourcedParams = outsourcedParamSets[`${reg.id}||${testId}`];
      if (outsourcedParams && outsourcedParams.size > 0) {
        // Delete only the params we're about to re-insert (non-outsourced)
        const paramIdsToDelete = upserts.map(u => u.parameter_id);
        for (const pid of paramIdsToDelete) {
          await supabase.from("patient_results").delete().eq("registration_id", reg.id).eq("test_id", testId).eq("parameter_id", pid);
        }
      } else {
        await supabase.from("patient_results").delete().eq("registration_id", reg.id).eq("test_id", testId);
      }
      const { error } = await supabase.from("patient_results").insert(upserts as any);
      if (error) throw error;
      // Update outsourced snip status to results_entered so it flows to Verification
      await supabase.from("outsourced_test_snips").update({ outsource_status: "results_entered" } as any).eq("registration_id", reg.id).eq("test_id", testId).in("outsource_status", ["pending", "sent", "results_saved"]);
    },
    onSuccess: (_, { entry, testId }) => {
      const testName = entry.parameters.find(p => p.testId === testId)?.testName || entry.snipOnlyTests.find(s => s.testId === testId)?.testName || "Test";
      toast.success(`${testName} saved & sent to verification`);
      const regId = entry.registration.id;
      // Clear edited values for this test's params only
      setEditedValues(prev => {
        const next = { ...prev };
        entry.parameters.filter(p => p.testId === testId).forEach(p => {
          delete next[`${regId}||${p.parameterId}`];
        });
        return next;
      });
      setSavingTestKey(null);
      setBlankConfirmTestParams(null);
      // Remove highlight for this reg if no more blank issues
      setHighlightBlanksForRegs(prev => { const next = new Set(prev); next.delete(`${regId}||${testId}`); return next; });
      // Recalculate registration status
      recalculateRegistrationStatus(regId).catch(console.error);
      qc.invalidateQueries({ queryKey: ["patient_results_existing"] });
      qc.invalidateQueries({ queryKey: ["verification_results_v2"] });
      qc.invalidateQueries({ queryKey: ["verification_outsourced_v2"] });
      qc.invalidateQueries({ queryKey: ["outsourced_manual_results"] });
      qc.invalidateQueries({ queryKey: ["outsourced_snips"] });
      qc.invalidateQueries({ queryKey: ["results_outsourced_snips"] });
      qc.invalidateQueries({ queryKey: ["results_accepted_regs"] });
    },
    onError: (err: any) => {
      toast.error(err.message || "Failed to save results");
      setSavingTestKey(null);
    },
  });

  // ─── Handle save & send to verification with blank check (per-test) ───
  const handleSaveAndVerify = (entry: PatientEntry, testId: string, testName: string) => {
    const reg = entry.registration;
    const testParams = entry.parameters.filter(p => p.testId === testId);
    
    // Snip-only test — no params to check for blanks, just save directly
    const isSnipOnly = entry.snipOnlyTests.some(s => s.testId === testId);
    if (isSnipOnly || testParams.length === 0) {
      setSavingTestKey(`${reg.id}||${testId}`);
      saveMutation.mutate({ entry, testId });
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
      setSavingTestKey(`${reg.id}||${testId}`);
      saveMutation.mutate({ entry, testId });
    }
  };

  // ─── Filter entries: hide patients whose all results are already "entered" ───
  const filteredEntries = useMemo(() => {
    const activeEntries = patientEntries.map(e => {
      const activeParams = e.parameters.filter((p) => {
        if (p.isOutsourced) {
          return !["results_entered", "verified", "approved", "dispatched"].includes(p.outsourceStatus || "")
            && !["entered", "verified", "approved", "dispatched"].includes(p.status || "");
        }

        return !["entered", "verified", "approved", "dispatched"].includes(p.status || "");
      });

      return { ...e, parameters: activeParams };
    }).filter(e => e.parameters.length > 0 || e.incompleteTests.length > 0 || e.snipOnlyTests.length > 0);

    if (mode === "patient") return activeEntries;
    if (selectedMachine === "all") return activeEntries;
    const filterMachine = selectedMachine === "others" ? "" : selectedMachine;
    return activeEntries
      .map(e => ({
        ...e,
        parameters: e.parameters.filter(p => (p.machineName || "") === filterMachine),
      }))
      .filter(e => e.parameters.length > 0 || e.incompleteTests.length > 0 || e.snipOnlyTests.length > 0);
  }, [patientEntries, mode, selectedMachine]);

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
    const autoFlag = calculateFlag(currentValue, p.normalRangeLow, p.normalRangeHigh, p.rangeType, p.expectedValue);
    const flag = p.isOutsourced && editedFlags[key] !== undefined ? editedFlags[key] : autoFlag;
    const isInterfaceParameter = p.sendForInterface && !p.isCalculated;
    const isAwaiting = isInterfaceParameter && !currentValue;

    const isBlank = !currentValue || currentValue.trim() === "";
    const shouldHighlightBlanks = highlightBlanksForRegs.has(`${regId}||${p.testId}`);
    const rowBg = (flag === "H" || flag === "L" || flag === "A") ? "bg-destructive/5" : (isBlank && !p.isCalculated && shouldHighlightBlanks ? "bg-yellow-50" : "");

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
                className="h-7 text-sm w-[120px]"
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
                className="h-7 text-sm w-[120px] font-mono"
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
          ) : (
            <Input
              value={currentValue}
              onChange={e => handleValueChange(regId, p.parameterId, e.target.value, entry)}
              className={`h-7 text-sm w-[180px] ${flag === "H" || flag === "L" || flag === "A" ? "border-destructive text-destructive font-bold" : ""}`}
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
                  <SelectItem value="A">Abnormal</SelectItem>
                </SelectContent>
              </Select>
            )
          ) : (
            <>
              {flag === "H" && <Badge variant="destructive" className="text-xs">HIGH</Badge>}
              {flag === "L" && <Badge variant="destructive" className="text-xs">LOW</Badge>}
              {flag === "A" && <Badge variant="destructive" className="text-xs">Abnormal</Badge>}
              {flag === "N" && <Badge variant="secondary" className="text-xs text-green-700">Normal</Badge>}
              {!flag && currentValue && <Badge variant="outline" className="text-xs">—</Badge>}
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
            <span className="text-sm text-muted-foreground ml-2">{reg.patient_name}</span>
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
                      <span className="text-base font-bold text-foreground">{tg.testName}</span>
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
                  {isTestExpanded && (
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
                masterMachines.forEach((m: any) => machines.add(m.value));
                patientEntries.forEach(e => e.parameters.forEach(p => { if (p.machineName) machines.add(p.machineName); }));
                machines.add("Others");
                return Array.from(machines).sort((a, b) => a === "Others" ? 1 : b === "Others" ? -1 : a.localeCompare(b));
              })().map(m => (
                <SelectItem key={m} value={m === "Others" ? "others" : m}>{m}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
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
          {loadingRegs ? (
            <Card><CardContent className="p-8 text-center text-muted-foreground">Loading…</CardContent></Card>
          ) : filteredEntries.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center text-muted-foreground">
                <FlaskConical className="h-8 w-8 mx-auto mb-2 opacity-40" />
                No accepted samples pending results
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {filteredEntries.map(entry => {
                const reg = entry.registration;
                const isExpanded = expandedPatient === reg.id;
                const completion = getCompletionPct(entry);
                const pendingCount = entry.parameters.filter(p => {
                  const key = `${reg.id}||${p.parameterId}`;
                  const val = editedValues[key] !== undefined ? editedValues[key] : p.resultValue;
                  return !val;
                }).length;
                const awaitingCount = entry.parameters.filter(p => {
                  const key = `${reg.id}||${p.parameterId}`;
                  const val = editedValues[key] !== undefined ? editedValues[key] : p.resultValue;
                  return p.sendForInterface && !p.isCalculated && !val;
                }).length;

                return (
                  <Card key={reg.id} className={isExpanded ? "ring-1 ring-primary/30" : ""}>
                    <div
                      className="flex flex-wrap items-center gap-2 sm:gap-3 p-3 cursor-pointer hover:bg-muted/30 transition-colors"
                      onClick={() => setExpandedPatient(isExpanded ? null : reg.id)}
                    >
                      {isExpanded ? <ChevronUp className="h-4 w-4 shrink-0" /> : <ChevronDown className="h-4 w-4 shrink-0" />}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium font-mono">{reg.invoice_number}</span>
                          {reg.status !== "sample_accepted" && Array.isArray(reg.accepted_samples) && reg.accepted_samples.length > 0 && (
                            <Badge className="bg-amber-100 text-amber-700 text-[10px]">PARTIAL</Badge>
                          )}
                          {reg.is_stat && (
                            <span className="relative inline-flex h-2.5 w-2.5">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-destructive opacity-75" />
                              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-destructive" />
                            </span>
                          )}
                          <span className="text-sm text-muted-foreground">{reg.patient_name}</span>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {reg.mobile_number} • {entry.parameters.length} parameters
                        </div>
                      </div>
                      {entry.incompleteTests.length > 0 && (
                        <Badge variant="outline" className="text-xs text-amber-600 border-amber-300 gap-0.5">
                          <FlaskConical className="h-3 w-3" /> {entry.incompleteTests.length} test{entry.incompleteTests.length > 1 ? "s" : ""} need setup
                        </Badge>
                      )}
                      <div className="flex items-center gap-2 shrink-0 flex-wrap">
                        {awaitingCount > 0 && (
                          <Badge variant="outline" className="text-xs text-orange-600 border-orange-300 gap-0.5">
                            <Wifi className="h-3 w-3" /> {awaitingCount}
                          </Badge>
                        )}
                        {pendingCount > 0 && (
                          <Badge variant="outline" className="text-xs">{pendingCount} pending</Badge>
                        )}
                        <div className="w-16 h-2 bg-muted rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${completion === 100 ? "bg-green-500" : "bg-primary"}`}
                            style={{ width: `${completion}%` }}
                          />
                        </div>
                        <span className="text-xs text-muted-foreground w-8 text-right">{completion}%</span>
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
                        {renderPatientExpanded(entry)}
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
                      const flag = p.isOutsourced && editedFlags[key] !== undefined ? editedFlags[key] : calculateFlag(currentValue, p.normalRangeLow, p.normalRangeHigh, p.rangeType, p.expectedValue);
                      const isInterfaceParameter = p.sendForInterface && !p.isCalculated;
                      const isAwaiting = isInterfaceParameter && !currentValue;
                      return (
                        <TableRow key={key} className="bg-yellow-50">
                          <TableCell className="py-2 text-xs font-mono text-muted-foreground">{p.paramCode}</TableCell>
                          <TableCell className="py-2 text-sm font-medium">{p.parameterName}</TableCell>
                          <TableCell className="py-2">
                            {p.rangeType === "qualitative" && getQualitativeOptions(p.expectedValue).length > 0 ? (
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
                                  <SelectItem value="A">Abnormal</SelectItem>
                                </SelectContent>
                              </Select>
                            ) : (
                              <>
                                {flag === "H" && <Badge variant="destructive" className="text-xs">HIGH</Badge>}
                                {flag === "L" && <Badge variant="destructive" className="text-xs">LOW</Badge>}
                                {flag === "A" && <Badge variant="destructive" className="text-xs">Abnormal</Badge>}
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
                const { entry, testId } = blankConfirmTestParams;
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
