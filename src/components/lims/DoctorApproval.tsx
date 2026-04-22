import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { recalculateRegistrationStatus } from "@/lib/limsStatus";
import { getCurrentUser, getCurrentUserName } from "@/lib/auth";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Search, User, Monitor, Calculator, ChevronDown, ChevronUp, Loader2, CheckCircle2, Undo2, RotateCcw, Eye, Stethoscope, FileCheck, StickyNote, Trash2 } from "lucide-react";
import { DescriptiveCombobox } from "./DescriptiveCombobox";
import { useMasterLookup } from "@/hooks/useMasterLookup";
import { toast } from "sonner";
import { formatDateDDMMYYYY } from "@/lib/utils";
import { expandRegistrationTests } from "@/lib/expandRegistrationTests";
import ModifiedApproval from "./ModifiedApproval";
import SelectApproverDialog, { ApproverChoice } from "./SelectApproverDialog";

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
  parameterId: string; paramCode: string; parameterName: string; unit: string; referenceRange: string;
  normalRangeLow: number | null; normalRangeHigh: number | null; resultValue: string; flag: string;
  isCalculated: boolean; calculationFormula: any[]; isFromInterface: boolean; sendForInterface: boolean;
  status: string; testId: string; testName: string; departmentId: string; machineName: string;
  displayOrder: number; rangeType: string; descriptiveOptions: string[]; expectedValue: string;
  isOutsourced: boolean; outsourceLabName: string | null; outsourceStatus: string; isSnipMode: boolean;
  enteredAt: string | null; enteredBy: string | null; verifiedAt: string | null; verifiedBy: string | null;
  note: string;
}

interface SnipOnlyTest {
  testId: string;
  testName: string;
  labName: string | null;
  snipUrls: string[];
  outsourceStatus: string;
}

interface PatientEntry { registration: any; parameters: ParameterResult[]; snipOnlyTests: SnipOnlyTest[]; }

const DA_PAGE_SIZE = 50;

const DoctorApproval = () => {
  const qc = useQueryClient();
  const { data: masterMachines = [] } = useMasterLookup("machine_name");
  const [activeSection, setActiveSection] = useState<"approval" | "modified">("approval");
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
  const [actionKey, setActionKey] = useState<string | null>(null);
  const [daPage, setDaPage] = useState(0);
  const [editedNotes, setEditedNotes] = useState<Record<string, string>>({});
  const [activeNoteKey, setActiveNoteKey] = useState<string | null>(null);
  const [editedTestNotes, setEditedTestNotes] = useState<Record<string, string>>({});
  const [activeTestNoteKey, setActiveTestNoteKey] = useState<string | null>(null);
  const [approverDialogOpen, setApproverDialogOpen] = useState(false);
  const pendingApprovalRef = useRef<null | ((choice: ApproverChoice) => void)>(null);
  const currentUserSigCacheRef = useRef<{ userId: string | null; checked: boolean; choice: ApproverChoice | null }>({ userId: null, checked: false, choice: null });

  // Resolve who should sign this approval. Returns null if blocked (toast already shown) or pending dialog selection.
  const resolveApprover = (): Promise<ApproverChoice | null> => {
    return new Promise(async (resolve) => {
      const currentUser = getCurrentUser();
      if (!currentUser?.id) { toast.error("Not signed in"); return resolve(null); }
      // Cache: check if current user has own pathologist signature
      if (!currentUserSigCacheRef.current.checked || currentUserSigCacheRef.current.userId !== currentUser.id) {
        const { data: sigData } = await supabase
          .from("pathologist_signatures")
          .select("pathologist_name, qualification, designation, signature_image_path")
          .eq("mapped_user_id", currentUser.id)
          .maybeSingle();
        let choice: ApproverChoice | null = null;
        if (sigData) {
          let signatureUrl: string | null = null;
          if (sigData.signature_image_path) {
            const { data: u } = supabase.storage.from("signatures").getPublicUrl(sigData.signature_image_path);
            signatureUrl = u.publicUrl;
          }
          choice = {
            pathologistName: sigData.pathologist_name || currentUser.display_name || "Doctor",
            qualification: sigData.qualification || null,
            designation: sigData.designation || null,
            signatureUrl,
          };
        }
        currentUserSigCacheRef.current = { userId: currentUser.id, checked: true, choice };
      }
      const ownChoice = currentUserSigCacheRef.current.choice;
      if (ownChoice) return resolve(ownChoice);
      // No own signature — check permission (always fetch fresh from DB; localStorage may be stale from older login)
      let canApproveAsDoctor = (currentUser as any).can_approve_as_doctor === true;
      try {
        const { data: freshUser } = await supabase
          .from("app_users")
          .select("can_approve_as_doctor")
          .eq("id", currentUser.id)
          .maybeSingle();
        if (freshUser) canApproveAsDoctor = freshUser.can_approve_as_doctor === true;
      } catch {}
      if (!canApproveAsDoctor) {
        toast.error("You don't have permission to approve. Ask Admin to grant approval rights or sign in as a pathologist.");
        return resolve(null);
      }
      // Open dialog
      pendingApprovalRef.current = (choice: ApproverChoice) => resolve(choice);
      setApproverDialogOpen(true);
    });
  };

  const handleApproverDialogConfirm = (choice: ApproverChoice) => {
    setApproverDialogOpen(false);
    const cb = pendingApprovalRef.current;
    pendingApprovalRef.current = null;
    if (cb) cb(choice);
  };

  const handleApproverDialogCancel = (open: boolean) => {
    if (open) { setApproverDialogOpen(true); return; }
    setApproverDialogOpen(false);
    const cb = pendingApprovalRef.current;
    pendingApprovalRef.current = null;
    if (cb) cb(null as any); // resolve null → caller treats as cancel
  };
  useEffect(() => { const t = setTimeout(() => { setDebouncedSearch(search); setDaPage(0); }, 400); return () => clearTimeout(t); }, [search]);

  const { data: daCount = 0 } = useQuery({
    queryKey: ["doctor_approval_count", debouncedSearch],
    queryFn: async () => {
      let query = supabase.from("patient_registrations").select("id", { count: "exact", head: true })
        .in("status", ["partial_verified", "verified", "partially_approved", "approved", "partially_dispatched", "dispatched"])
        .eq("bill_cancelled", false);
      if (debouncedSearch) query = query.or(`patient_name.ilike.%${debouncedSearch}%,mobile_number.ilike.%${debouncedSearch}%,invoice_number.ilike.%${debouncedSearch}%,umr_number.ilike.%${debouncedSearch}%`);
      const { count } = await query;
      return count || 0;
    },
  });

  const { data: registrations = [], isLoading: loadingRegs } = useQuery({
    queryKey: ["doctor_approval_regs", debouncedSearch, daPage],
    queryFn: async () => {
      let query = supabase.from("patient_registrations")
        .select("id, invoice_number, patient_name, mobile_number, umr_number, status, is_stat, tests, cancelled_tests, visit_type, gender, dob, created_at, updated_at, bill_cancelled, doctor_name")
        .in("status", ["partial_verified", "verified", "partially_approved", "approved", "partially_dispatched", "dispatched"])
        .eq("bill_cancelled", false).order("is_stat", { ascending: false }).order("invoice_number", { ascending: false })
        .range(daPage * DA_PAGE_SIZE, daPage * DA_PAGE_SIZE + DA_PAGE_SIZE - 1);
      if (debouncedSearch) query = query.or(`patient_name.ilike.%${debouncedSearch}%,mobile_number.ilike.%${debouncedSearch}%,invoice_number.ilike.%${debouncedSearch}%,umr_number.ilike.%${debouncedSearch}%`);
      const { data } = await query;
      return (data || []) as any[];
    },
  });

  const daTotalPages = Math.ceil(daCount / DA_PAGE_SIZE);

  const regIds = registrations.map((r: any) => r.id);

  const { data: existingResults = [] } = useQuery({
    queryKey: ["doctor_approval_results", regIds.join(",")],
    enabled: regIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase.from("patient_results").select("*").in("registration_id", regIds).eq("status", "verified");
      return (data || []) as any[];
    },
  });

  // Fetch sample tubes to expand PRL/HLT container rows into leaf tests
  const { data: regTubes = [] } = useQuery({
    queryKey: ["doctor_approval_tubes", regIds.join(",")],
    enabled: regIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase.from("sample_tubes" as any).select("registration_id, test_ids").in("registration_id", regIds);
      return (data || []) as any[];
    },
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

  const { data: outsourcedSnips = [] } = useQuery({
    queryKey: ["doctor_approval_snips", regIds.join(",")],
    enabled: regIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase.from("outsourced_test_snips").select("registration_id, test_id, outsourced_parameter_ids, outsource_status, outsourced_lab_name, result_mode, snip_image_urls").in("registration_id", regIds).eq("outsource_status", "verified");
      return (data || []) as any[];
    },
  });

  const { transferredTestKeys, outsourcedParamSets, outsourcedSnipDetails } = useMemo(() => {
    const testKeys = new Set<string>(); const paramSets: Record<string, Set<string>> = {};
    const details: Record<string, { status: string; labName: string | null; resultMode: string; snipImageUrls: string[] }> = {};
    outsourcedSnips.forEach((s: any) => {
      const key = `${s.registration_id}||${s.test_id}`;
      const urls = Array.isArray(s.snip_image_urls) ? s.snip_image_urls : [];
      details[key] = { status: s.outsource_status || "pending", labName: s.outsourced_lab_name || null, resultMode: s.result_mode || "manual", snipImageUrls: urls };
      const paramIds = Array.isArray(s.outsourced_parameter_ids) ? s.outsourced_parameter_ids : [];
      if (paramIds.length > 0) { if (!paramSets[key]) paramSets[key] = new Set(); paramIds.forEach((pid: string) => paramSets[key].add(pid)); }
      else testKeys.add(key);
    });
    return { transferredTestKeys: testKeys, outsourcedParamSets: paramSets, outsourcedSnipDetails: details };
  }, [outsourcedSnips]);

  const { data: testsMap = {} } = useQuery({ queryKey: ["results_tests_map"], queryFn: async () => { const { data } = await supabase.from("tests").select("id, test_name, department_id, instrument_name"); const map: Record<string, any> = {}; (data || []).forEach((t: any) => { map[t.id] = t; }); return map; } });
  const { data: testParamsMap = {} } = useQuery({ queryKey: ["results_test_params_full"], queryFn: async () => { const { data } = await supabase.from("test_parameters").select("test_id, parameter_id, display_order, is_subheader, subheader_text, report_test_parameters(id, param_code, parameter_name, unit, normal_range_low, normal_range_high, normal_range_text, is_calculated, calculation_formula, send_for_interface)").order("display_order"); const map: Record<string, any[]> = {}; (data || []).forEach((tp: any) => { if (!tp.test_id) return; if (!map[tp.test_id]) map[tp.test_id] = []; map[tp.test_id].push(tp); }); return map; } });
  const { data: normalRangesMap = {} } = useQuery({ queryKey: ["results_normal_ranges"], queryFn: async () => { const { data } = await supabase.from("parameter_normal_ranges").select("*").order("age_min"); const map: Record<string, any[]> = {}; (data || []).forEach((r: any) => { if (!map[r.parameter_id]) map[r.parameter_id] = []; map[r.parameter_id].push(r); }); return map; } });

  // Historical
  const expandedUmr = useMemo(() => { if (!expandedPatient) return null; const reg = registrations.find((r: any) => r.id === expandedPatient); return reg?.umr_number || null; }, [expandedPatient, registrations]);
  const { data: historicalResults = [] } = useQuery({
    queryKey: ["historical_results_dr", expandedUmr, expandedPatient], enabled: !!expandedUmr && !!expandedPatient,
    queryFn: async () => {
      const { data: sameUmrRegs } = await supabase.from("patient_registrations").select("id").eq("umr_number", expandedUmr!).neq("id", expandedPatient!);
      const rIds = (sameUmrRegs || []).map((r: any) => r.id); if (rIds.length === 0) return [];
      const { data } = await supabase.from("patient_results").select("parameter_id, result_value, reference_range, created_at, test_id, registration_id").in("registration_id", rIds).not("result_value", "is", null).order("created_at", { ascending: false });
      const { data: snips } = await supabase.from("outsourced_test_snips").select("registration_id, test_id, result_mode, outsourced_parameter_ids, snip_image_urls").in("registration_id", rIds).eq("result_mode", "snip");
      const snipInfoMap: Record<string, string[]> = {};
      (snips || []).forEach((s: any) => { const urls = Array.isArray(s.snip_image_urls) ? s.snip_image_urls : []; const paramIds = Array.isArray(s.outsourced_parameter_ids) ? s.outsourced_parameter_ids : []; if (paramIds.length > 0) { paramIds.forEach((pid: string) => { snipInfoMap[`${s.registration_id}||${s.test_id}||${pid}`] = urls; }); } else { snipInfoMap[`${s.registration_id}||${s.test_id}||__full__`] = urls; } });
      return (data || []).map((r: any) => { const fk = `${r.registration_id}||${r.test_id}||__full__`; const pk = `${r.registration_id}||${r.test_id}||${r.parameter_id}`; return { ...r, snipImageUrls: snipInfoMap[pk] || snipInfoMap[fk] || null }; });
    },
  });
  const historyMap = useMemo(() => { const map: Record<string, any[]> = {}; for (const r of historicalResults) { if (!r.parameter_id) continue; if (!map[r.parameter_id]) map[r.parameter_id] = []; if (map[r.parameter_id].length < 2) map[r.parameter_id].push({ resultValue: r.result_value || "", referenceRange: r.reference_range || "", createdAt: r.created_at || "", snipImageUrls: r.snipImageUrls || null }); } return map; }, [historicalResults]);

  const resolveNormalRange = useCallback((parameterId: string, reg: any) => {
    const ranges = normalRangesMap[parameterId];
    if (!ranges || ranges.length === 0) return { text: "", low: null as number | null, high: null as number | null, rangeType: "numeric", descriptiveOptions: [] as string[], expectedValue: "" };
    let patientAge: number | null = null;
    if (reg.dob) { patientAge = Math.floor((Date.now() - new Date(reg.dob).getTime()) / (365.25 * 24 * 60 * 60 * 1000)); }
    const pg = (reg.gender || "").toLowerCase().charAt(0);
    let candidates = ranges.filter((r: any) => { const g = (r.gender || "all").toLowerCase(); return g === "all" || (g === "male" && pg === "m") || (g === "female" && pg === "f"); });
    if (patientAge != null) { const am = candidates.filter((r: any) => { if (r.age_min == null && r.age_max == null) return true; if (r.age_min != null && patientAge! < r.age_min) return false; if (r.age_max != null && patientAge! > r.age_max) return false; return true; }); if (am.length > 0) candidates = am; }
    const best = candidates.find((r: any) => (r.gender || "all").toLowerCase() !== "all") || candidates[0];
    if (!best) return { text: "", low: null as number | null, high: null as number | null, rangeType: "numeric", descriptiveOptions: [] as string[], expectedValue: "" };
    const text = best.normal_range_text || (best.normal_range_low != null && best.normal_range_high != null ? `${best.normal_range_low} - ${best.normal_range_high}` : "");
    return { text, low: best.normal_range_low, high: best.normal_range_high, rangeType: best.range_type || "numeric", descriptiveOptions: Array.isArray(best.descriptive_options) ? best.descriptive_options : [], expectedValue: best.expected_value || "" };
  }, [normalRangesMap]);

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

        if (validParams.length === 0) {
          if (snipDetail && snipDetail.snipImageUrls.length > 0 && snipDetail.status === "verified") {
            snipOnlyTests.push({ testId: t.test_id, testName: t.test_name || testInfo.test_name || "", labName: snipDetail.labName, snipUrls: snipDetail.snipImageUrls, outsourceStatus: snipDetail.status });
          }
          continue;
        }

        const testVerifiedResults = existingResults.filter((r: any) => r.registration_id === reg.id && r.test_id === t.test_id);
        if (testVerifiedResults.length === 0 && !snipDetail) continue;
        for (const tp of params) {
          if (tp.is_subheader) continue;
          const p = tp.report_test_parameters; if (!p) continue;
          const isParamOutsourced = isFullTestOutsourced || (paramOutsourcedSet && paramOutsourcedSet.has(p.id));
          const existing = testVerifiedResults.find((r: any) => r.parameter_id === p.id);
          if (!existing && !isParamOutsourced) continue;
          const resolved = resolveNormalRange(p.id, reg);
          const refText = resolved.text || p.normal_range_text || (p.normal_range_low != null && p.normal_range_high != null ? `${p.normal_range_low} - ${p.normal_range_high}` : "");
          const savedUnit = isParamOutsourced && existing?.unit ? existing.unit : (p.unit || "");
          const savedRefRange = isParamOutsourced && existing?.reference_range ? existing.reference_range : refText;
          parameters.push({
            parameterId: p.id, paramCode: p.param_code || "", parameterName: p.parameter_name,
            unit: savedUnit, referenceRange: savedRefRange, normalRangeLow: resolved.low ?? p.normal_range_low, normalRangeHigh: resolved.high ?? p.normal_range_high,
            resultValue: existing?.result_value || "", flag: existing?.flag || "", isCalculated: p.is_calculated || false,
            calculationFormula: p.calculation_formula || [], isFromInterface: existing?.is_from_interface || false,
            sendForInterface: p.send_for_interface || false, status: existing?.status || "pending", testId: t.test_id,
            testName: t.test_name || testInfo.test_name || "", departmentId: testInfo.department_id || "",
            machineName: testInfo.instrument_name || "", displayOrder: tp.display_order || 0,
            rangeType: resolved.rangeType, descriptiveOptions: resolved.descriptiveOptions, expectedValue: resolved.expectedValue,
            isOutsourced: !!isParamOutsourced, outsourceLabName: isParamOutsourced ? (snipDetail?.labName || null) : null,
            outsourceStatus: isParamOutsourced ? (snipDetail?.status || "pending") : "",
            isSnipMode: isParamOutsourced && snipDetail?.resultMode === "snip",
            enteredAt: existing?.entered_at || null, enteredBy: existing?.entered_by || null, verifiedAt: existing?.verified_at || null, verifiedBy: existing?.verified_by || null,
            note: existing?.note || "",
          });
        }
      }
      return { registration: reg, parameters, snipOnlyTests };
    }).filter(e => e.parameters.length > 0 || e.snipOnlyTests.length > 0);
  }, [registrations, testsMap, testParamsMap, existingResults, resolveNormalRange, transferredTestKeys, outsourcedParamSets, outsourcedSnipDetails, leafIdsByReg]);

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

  const calculateFlag = (value: string, low: number | null, high: number | null, rangeType?: string, expectedValue?: string, descriptiveOptions?: string[]): string => {
    if (!value || !value.trim()) return "";
    if (rangeType === "qualitative") { if (!expectedValue) return ""; return value.trim().toLowerCase() === expectedValue.trim().toLowerCase() ? "N" : "X"; }
    if (rangeType === "descriptive") {
      const opts = (descriptiveOptions || []).map(o => (o || "").trim().toLowerCase()).filter(Boolean);
      if (opts.length === 0) return "";
      return opts.includes(value.trim().toLowerCase()) ? "N" : "X";
    }
    const num = parseFloat(value); if (isNaN(num)) return "";
    if (low != null && num < low) return "L"; if (high != null && num > high) return "H"; return "N";
  };

  const evaluateFormula = (formula: any[], paramValues: Record<string, string>): string => {
    if (!formula || formula.length === 0) return "";
    try { let expr = ""; for (let idx = 0; idx < formula.length; idx++) { const token = formula[idx]; if (token.type === "bracket_open") { if (idx > 0 && token.operator && ["+", "-", "*", "/"].includes(token.operator)) expr += ` ${token.operator} `; expr += "("; } else if (token.type === "bracket_close") { expr += ")"; } else if (token.type === "parameter") { if (idx > 0 && token.operator && ["+", "-", "*", "/"].includes(token.operator)) expr += ` ${token.operator} `; const val = paramValues[token.parameter_id]; if (!val || isNaN(parseFloat(val))) return ""; expr += parseFloat(val); } else if (token.type === "fixed_value" || token.type === "fixed") { if (idx > 0 && token.operator && ["+", "-", "*", "/"].includes(token.operator)) expr += ` ${token.operator} `; expr += token.fixed_value ?? token.value ?? ""; } } expr = expr.replace(/\s+/g, " ").trim(); const result = new Function(`return (${expr})`)(); if (typeof result === "number" && isFinite(result)) return parseFloat(result.toFixed(2)).toString(); return ""; } catch { return ""; }
  };

  const handleValueChange = (regId: string, paramId: string, value: string, entry: PatientEntry) => {
    const key = `${regId}||${paramId}`;
    const newEdited = { ...editedValues, [key]: value };
    const paramValues: Record<string, string> = {};
    for (const p of entry.parameters) { const pk = `${regId}||${p.parameterId}`; paramValues[p.parameterId] = pk === key ? value : (newEdited[pk] !== undefined ? newEdited[pk] : p.resultValue); }
    for (const p of entry.parameters) { if (p.isCalculated && p.calculationFormula.length > 0) { const r = evaluateFormula(p.calculationFormula, paramValues); newEdited[`${regId}||${p.parameterId}`] = r; paramValues[p.parameterId] = r; } }
    setEditedValues(newEdited);
  };

  const filteredEntries = useMemo(() => {
    if (mode === "patient") return patientEntries;
    if (selectedMachine === "all") return patientEntries;
    const fm = selectedMachine === "others" ? "" : selectedMachine;
    return patientEntries.map(e => ({ ...e, parameters: e.parameters.filter(p => (p.machineName || "") === fm) })).filter(e => e.parameters.length > 0 || e.snipOnlyTests.length > 0);
  }, [patientEntries, mode, selectedMachine]);

  const stats = useMemo(() => ({ totalPatients: filteredEntries.length, totalParams: filteredEntries.reduce((s, e) => s + e.parameters.length, 0) }), [filteredEntries]);

  const groupByMachine = (params: ParameterResult[]) => { const g: Record<string, { machineName: string; params: ParameterResult[] }> = {}; for (const p of params) { const m = p.machineName || "Others"; if (!g[m]) g[m] = { machineName: m, params: [] }; g[m].params.push(p); } return Object.values(g); };
  const groupByTest = (params: ParameterResult[]) => { const g: Record<string, { testId: string; testName: string; params: ParameterResult[] }> = {}; for (const p of params) { if (!g[p.testId]) g[p.testId] = { testId: p.testId, testName: p.testName, params: [] }; g[p.testId].params.push(p); } return Object.values(g); };

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["doctor_approval_regs"] });
    qc.invalidateQueries({ queryKey: ["doctor_approval_results"] });
    qc.invalidateQueries({ queryKey: ["doctor_approval_snips"] });
    qc.invalidateQueries({ queryKey: ["doctor_approval_history"] });
    qc.invalidateQueries({ queryKey: ["verification_results_v2"] });
    qc.invalidateQueries({ queryKey: ["verification_outsourced_v2"] });
    qc.invalidateQueries({ queryKey: ["verification_regs_v2"] });
    qc.invalidateQueries({ queryKey: ["results_accepted_regs"] });
    qc.invalidateQueries({ queryKey: ["patient_results_existing"] });
    qc.invalidateQueries({ queryKey: ["dispatch_regs"] });
    qc.invalidateQueries({ queryKey: ["dispatch_results"] });
    qc.invalidateQueries({ queryKey: ["dispatch_snips"] });
  };

  // Approve test
  const approveTest = async (entry: PatientEntry, testId: string, testName: string) => {
    const reg = entry.registration;
    // Resolve approver BEFORE setting action key (so cancellation doesn't leave loading state)
    const approver = await resolveApprover();
    if (!approver) return;
    setActionKey(`${reg.id}||${testId}||approve`);
    try {
      const testParams = entry.parameters.filter(p => p.testId === testId);
      const upserts: any[] = [];
      for (const p of testParams) {
        const k = `${reg.id}||${p.parameterId}`;
        const value = editedValues[k] !== undefined ? editedValues[k] : p.resultValue;
        const autoFlag = calculateFlag(value, p.normalRangeLow, p.normalRangeHigh, p.rangeType, p.expectedValue, p.descriptiveOptions);
        const flag = p.isOutsourced && editedFlags[k] !== undefined ? editedFlags[k] : autoFlag;
        const unit = p.isOutsourced && editedUnits[k] !== undefined ? editedUnits[k] : p.unit;
        const refRange = p.isOutsourced && editedRefRanges[k] !== undefined ? editedRefRanges[k] : p.referenceRange;
         const noteVal = editedNotes[k] !== undefined ? editedNotes[k] : p.note;
         const testNoteVal = editedTestNotes[`${reg.id}||${testId}`] !== undefined ? editedTestNotes[`${reg.id}||${testId}`] : (loadedTestNotes[`${reg.id}||${testId}`] || "");
         upserts.push({ registration_id: reg.id, test_id: p.testId, parameter_id: p.parameterId, param_code: p.paramCode, parameter_name: p.parameterName, result_value: value || null, unit, reference_range: refRange, normal_range_low: p.normalRangeLow, normal_range_high: p.normalRangeHigh, flag: flag || null, status: "approved", is_calculated: p.isCalculated, is_from_interface: p.isFromInterface, approved_at: new Date().toISOString(), entered_at: p.enteredAt || null, entered_by: p.enteredBy || null, verified_at: p.verifiedAt || null, verified_by: p.verifiedBy || null, approved_by: approver.pathologistName, note: noteVal || null, test_note: testNoteVal || null });
      }
      if (upserts.length > 0) {
        await supabase.from("patient_results").delete().eq("registration_id", reg.id).eq("test_id", testId).eq("status", "verified");
        await supabase.from("patient_results").insert(upserts as any);
      }
      await supabase.from("outsourced_test_snips").update({ outsource_status: "approved" } as any).eq("registration_id", reg.id).eq("test_id", testId).eq("outsource_status", "verified");

      // Archive snapshot — merge with existing approved_reports data
      const snipKey = `${reg.id}||${testId}`;
      const snipDetail = outsourcedSnipDetails[snipKey];
      const snipUrls = snipDetail?.snipImageUrls || [];
      const testResultsSnapshot = upserts.map((u: any) => ({
        test_id: u.test_id, test_name: testName,
        parameter_id: u.parameter_id, param_code: u.param_code, parameter_name: u.parameter_name,
        result_value: u.result_value, unit: u.unit, reference_range: u.reference_range,
        normal_range_low: u.normal_range_low, normal_range_high: u.normal_range_high,
        flag: u.flag, is_calculated: u.is_calculated, is_outsourced: testParams[0]?.isOutsourced || false,
        outsource_lab_name: snipDetail?.labName || null,
        approved_by: approver.pathologistName,
        approved_by_qualification: approver.qualification,
        approved_by_designation: approver.designation,
        approved_by_signature_url: approver.signatureUrl,
        note: u.note || null,
        test_note: u.test_note || null,
      }));
      // Fetch existing approved_reports to merge
      const { data: existingReport } = await supabase.from("approved_reports").select("test_results, outsourced_snip_urls").eq("registration_id", reg.id).maybeSingle();
      const existingResults = Array.isArray((existingReport as any)?.test_results) ? (existingReport as any).test_results : [];
      const existingSnipUrls = Array.isArray((existingReport as any)?.outsourced_snip_urls) ? (existingReport as any).outsourced_snip_urls : [];
      // Remove old entries for this test, then add new ones
      const mergedResults = existingResults.filter((r: any) => r.test_id !== testId).concat(testResultsSnapshot);
      const mergedSnipUrls = [...new Set([...existingSnipUrls.filter((u: string) => !u.includes(testId)), ...snipUrls])];
      // First barcode print timestamp = MIN(sample_tubes.collected_at) — reprint-safe
      const { data: tubesForCol } = await supabase.from("sample_tubes").select("collected_at").eq("registration_id", reg.id).not("collected_at", "is", null);
      const firstCollectedAt = tubesForCol?.length ? (tubesForCol.map((t: any) => t.collected_at).sort()[0] as string) : null;
      await supabase.from("approved_reports").upsert({
        registration_id: reg.id, invoice_number: reg.invoice_number, umr_number: reg.umr_number,
        patient_name: reg.patient_name, title: reg.title, gender: reg.gender, dob: reg.dob,
        mobile_number: reg.mobile_number, email: reg.email, address: reg.address,
        doctor_name: reg.doctor_name, visit_type: reg.visit_type, is_stat: reg.is_stat,
        report_language: reg.report_language, approved_by: approver.pathologistName,
        registration_date: reg.created_at, approval_date: new Date().toISOString(),
        sample_collection_date: firstCollectedAt,
        test_results: mergedResults, outsourced_snip_urls: mergedSnipUrls,
      } as any, { onConflict: "registration_id" as any, ignoreDuplicates: false });

      // Check if all results for this registration are now approved
      const { data: allRes } = await supabase.from("patient_results").select("status").eq("registration_id", reg.id);
      if (allRes && allRes.length > 0 && allRes.every((r: any) => r.status === "approved")) {
        await supabase.from("patient_registrations").update({ status: "approved" } as any).eq("id", reg.id);
      }

      toast.success(`${testName} approved`);
      recalculateRegistrationStatus(reg.id).catch(console.error);
      setEditedValues(prev => { const next = { ...prev }; testParams.forEach(p => delete next[`${reg.id}||${p.parameterId}`]); return next; });
      invalidateAll();
    } catch (err: any) { toast.error(err.message || "Approval failed"); }
    finally { setActionKey(null); }
  };

  const approveAllForPatient = async (entry: PatientEntry) => {
    const reg = entry.registration;
    const approver = await resolveApprover();
    if (!approver) return;
    setActionKey(`${reg.id}||all||approve`);
    try {
      const testIds = [...new Set(entry.parameters.map(p => p.testId))];
      const allTestResults: any[] = [];
      const allSnipUrls: string[] = [];
      for (const testId of testIds) {
        const testParams = entry.parameters.filter(p => p.testId === testId);
        const testName = testParams[0]?.testName || testId;
        const upserts: any[] = [];
        for (const p of testParams) {
          const k = `${reg.id}||${p.parameterId}`;
          const value = editedValues[k] !== undefined ? editedValues[k] : p.resultValue;
          const autoFlag = calculateFlag(value, p.normalRangeLow, p.normalRangeHigh, p.rangeType, p.expectedValue, p.descriptiveOptions);
          const flag = p.isOutsourced && editedFlags[k] !== undefined ? editedFlags[k] : autoFlag;
          const noteVal = editedNotes[k] !== undefined ? editedNotes[k] : p.note;
          const testNoteVal = editedTestNotes[`${reg.id}||${testId}`] !== undefined ? editedTestNotes[`${reg.id}||${testId}`] : (loadedTestNotes[`${reg.id}||${testId}`] || "");
          upserts.push({ registration_id: reg.id, test_id: p.testId, parameter_id: p.parameterId, param_code: p.paramCode, parameter_name: p.parameterName, result_value: value || null, unit: p.unit, reference_range: p.referenceRange, normal_range_low: p.normalRangeLow, normal_range_high: p.normalRangeHigh, flag: flag || null, status: "approved", is_calculated: p.isCalculated, is_from_interface: p.isFromInterface, approved_at: new Date().toISOString(), entered_at: p.enteredAt || null, entered_by: p.enteredBy || null, verified_at: p.verifiedAt || null, verified_by: p.verifiedBy || null, approved_by: approver.pathologistName, note: noteVal || null, test_note: testNoteVal || null });
        }
        if (upserts.length > 0) {
          await supabase.from("patient_results").delete().eq("registration_id", reg.id).eq("test_id", testId).eq("status", "verified");
          await supabase.from("patient_results").insert(upserts as any);
        }
        await supabase.from("outsourced_test_snips").update({ outsource_status: "approved" } as any).eq("registration_id", reg.id).eq("test_id", testId).eq("outsource_status", "verified");

        const snipKey = `${reg.id}||${testId}`;
        const snipDetail = outsourcedSnipDetails[snipKey];
        const snipUrls = snipDetail?.snipImageUrls || [];
        allSnipUrls.push(...snipUrls);
        upserts.forEach((u: any) => allTestResults.push({
          test_id: u.test_id, test_name: testName,
          parameter_id: u.parameter_id, param_code: u.param_code, parameter_name: u.parameter_name,
          result_value: u.result_value, unit: u.unit, reference_range: u.reference_range,
          normal_range_low: u.normal_range_low, normal_range_high: u.normal_range_high,
          flag: u.flag, is_calculated: u.is_calculated, is_outsourced: testParams[0]?.isOutsourced || false,
          outsource_lab_name: snipDetail?.labName || null,
          approved_by: approver.pathologistName,
          approved_by_qualification: approver.qualification,
          approved_by_designation: approver.designation,
          approved_by_signature_url: approver.signatureUrl,
          note: u.note || null,
          test_note: u.test_note || null,
        }));
      }
      // Archive combined snapshot — merge with existing approved_reports data
      const { data: existingReportAll } = await supabase.from("approved_reports").select("test_results, outsourced_snip_urls").eq("registration_id", reg.id).maybeSingle();
      const existingResultsAll = Array.isArray((existingReportAll as any)?.test_results) ? (existingReportAll as any).test_results : [];
      const existingSnipUrlsAll = Array.isArray((existingReportAll as any)?.outsourced_snip_urls) ? (existingReportAll as any).outsourced_snip_urls : [];
      const approvedTestIds = new Set(testIds);
      const mergedResultsAll = existingResultsAll.filter((r: any) => !approvedTestIds.has(r.test_id)).concat(allTestResults);
      const mergedSnipUrlsAll = [...new Set([...existingSnipUrlsAll, ...allSnipUrls])];
      // First barcode print timestamp = MIN(sample_tubes.collected_at) — reprint-safe
      const { data: tubesForColAll } = await supabase.from("sample_tubes").select("collected_at").eq("registration_id", reg.id).not("collected_at", "is", null);
      const firstCollectedAtAll = tubesForColAll?.length ? (tubesForColAll.map((t: any) => t.collected_at).sort()[0] as string) : null;
      await supabase.from("approved_reports").upsert({
        registration_id: reg.id, invoice_number: reg.invoice_number, umr_number: reg.umr_number,
        patient_name: reg.patient_name, title: reg.title, gender: reg.gender, dob: reg.dob,
        mobile_number: reg.mobile_number, email: reg.email, address: reg.address,
        doctor_name: reg.doctor_name, visit_type: reg.visit_type, is_stat: reg.is_stat,
        report_language: reg.report_language, approved_by: approver.pathologistName,
        registration_date: reg.created_at, approval_date: new Date().toISOString(),
        sample_collection_date: firstCollectedAtAll,
        test_results: mergedResultsAll, outsourced_snip_urls: mergedSnipUrlsAll,
      } as any, { onConflict: "registration_id" as any, ignoreDuplicates: false });
      // Update registration status to approved since all tests were just approved
      await supabase.from("patient_registrations").update({ status: "approved" } as any).eq("id", reg.id);

      toast.success(`All tests approved for ${reg.patient_name}`);
      recalculateRegistrationStatus(reg.id).catch(console.error);
      invalidateAll();
    } catch (err: any) { toast.error(err.message || "Approval failed"); }
    finally { setActionKey(null); }
  };

  // Send back for verification — persist doctor's edits FIRST, then flip status to entered
  const sendBackForVerification = async (regId: string, testId: string, testName: string) => {
    setActionKey(`${regId}||${testId}||back`);
    try {
      // Find the patient entry + parameters for this (regId, testId)
      const entry = patientEntries.find(e => e.registration.id === regId);
      const testParams = entry ? entry.parameters.filter(p => p.testId === testId) : [];

      // Build upserts that include doctor's edits, with status = "entered"
      const upserts: any[] = [];
      for (const p of testParams) {
        const k = `${regId}||${p.parameterId}`;
        const value = editedValues[k] !== undefined ? editedValues[k] : p.resultValue;
        const autoFlag = calculateFlag(value, p.normalRangeLow, p.normalRangeHigh, p.rangeType, p.expectedValue, p.descriptiveOptions);
        const flag = p.isOutsourced && editedFlags[k] !== undefined ? editedFlags[k] : autoFlag;
        const unit = p.isOutsourced && editedUnits[k] !== undefined ? editedUnits[k] : p.unit;
        const refRange = p.isOutsourced && editedRefRanges[k] !== undefined ? editedRefRanges[k] : p.referenceRange;
        upserts.push({
          registration_id: regId, test_id: p.testId, parameter_id: p.parameterId,
          param_code: p.paramCode, parameter_name: p.parameterName,
          result_value: value || null, unit, reference_range: refRange,
          normal_range_low: p.normalRangeLow, normal_range_high: p.normalRangeHigh,
          flag: flag || null, status: "entered",
          is_calculated: p.isCalculated, is_from_interface: p.isFromInterface,
          entered_at: p.enteredAt || new Date().toISOString(), entered_by: p.enteredBy || null,
          verified_at: null, verified_by: null,
          note: editedNotes[k] !== undefined ? (editedNotes[k] || null) : (p.note || null),
          test_note: editedTestNotes[`${regId}||${testId}`] !== undefined ? (editedTestNotes[`${regId}||${testId}`] || null) : (loadedTestNotes[`${regId}||${testId}`] || null),
        });
      }

      if (upserts.length > 0) {
        await supabase.from("patient_results").delete().eq("registration_id", regId).eq("test_id", testId).in("status", ["verified", "entered"]);
        await supabase.from("patient_results").insert(upserts as any);
      } else {
        // Fallback for snip-only tests
        await supabase.from("patient_results").update({ status: "entered" } as any).eq("registration_id", regId).eq("test_id", testId).eq("status", "verified");
      }

      await supabase.from("outsourced_test_snips").update({ outsource_status: "results_entered" } as any).eq("registration_id", regId).eq("test_id", testId).eq("outsource_status", "verified");

      // Recompute parent registration status so Verification sees this test as entered again
      await recalculateRegistrationStatus(regId);

      // Clear local edits for parameters belonging to this test
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

      toast.success(`${testName} sent back for verification`);
      invalidateAll();
    } catch (err: any) { toast.error(err.message || "Failed"); }
    finally { setActionKey(null); }
  };

  // Request repeat collection
  const requestRepeatCollection = async (regId: string, testId: string, testName: string) => {
    setActionKey(`${regId}||${testId}||repeat`);
    try {
      await supabase.from("patient_results").delete().eq("registration_id", regId).eq("test_id", testId);
      await supabase.from("outsourced_test_snips").delete().eq("registration_id", regId).eq("test_id", testId);
      // Update registration status back to sample_collected for re-collection
      await supabase.from("patient_registrations").update({ status: "repeat_collection" } as any).eq("id", regId);
      toast.success(`Repeat sample collection requested for ${testName}`);
      invalidateAll();
      qc.invalidateQueries({ queryKey: ["sample_collection"] });
    } catch (err: any) { toast.error(err.message || "Failed"); }
    finally { setActionKey(null); }
  };

  const renderHistoryCell = (parameterId: string, index: number) => {
    const hist = historyMap[parameterId]?.[index];
    if (!hist || !hist.resultValue) return <TableCell className="py-1.5 text-center text-xs text-muted-foreground">—</TableCell>;
    if (hist.snipImageUrls && hist.snipImageUrls.length > 0) {
      return (<TableCell className="py-1.5 text-xs"><div className="leading-tight"><Button size="sm" variant="ghost" className="h-5 px-1 text-xs text-blue-600 gap-0.5" onClick={() => setViewSnipImages(hist.snipImageUrls)}><Eye className="h-3 w-3" /> View Snip</Button><div className="text-muted-foreground text-[10px]">{hist.createdAt ? formatDateDDMMYYYY(hist.createdAt) : ""}</div></div></TableCell>);
    }
    return (<TableCell className="py-1.5 text-xs"><div className="leading-tight"><div className="font-bold">{hist.resultValue}</div><div className="text-muted-foreground">{hist.referenceRange || "—"}</div><div className="text-muted-foreground text-[10px]">{hist.createdAt ? formatDateDDMMYYYY(hist.createdAt) : ""}</div></div></TableCell>);
  };

  const renderParamRow = (entry: PatientEntry, p: ParameterResult) => {
    const regId = entry.registration.id;
    const key = `${regId}||${p.parameterId}`;
    const currentValue = editedValues[key] !== undefined ? editedValues[key] : p.resultValue;
    const autoFlag = calculateFlag(currentValue, p.normalRangeLow, p.normalRangeHigh, p.rangeType, p.expectedValue, p.descriptiveOptions);
    const flag = p.isOutsourced && editedFlags[key] !== undefined ? editedFlags[key] : autoFlag;
    const rowBg = (flag === "H" || flag === "L" || flag === "A" || flag === "X") ? "bg-destructive/5" : "";
    return (
      <TableRow key={key} className={rowBg}>
        <TableCell className="py-1.5 text-xs font-mono text-muted-foreground">{p.paramCode}</TableCell>
        <TableCell className="py-1.5 text-sm font-medium">
          <div className="flex items-center gap-1">
            {p.parameterName}{p.isCalculated && <Calculator className="inline h-3 w-3 ml-1 text-primary" />}
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
        {renderHistoryCell(p.parameterId, 0)}{renderHistoryCell(p.parameterId, 1)}
        <TableCell className="py-1.5 w-[180px]">
          {p.isCalculated ? (<div className="flex items-center gap-1"><Input value={currentValue} onChange={(e) => handleValueChange(regId, p.parameterId, e.target.value, entry)} className="h-7 text-sm w-[120px] font-mono" placeholder="Auto" /><Button type="button" variant="ghost" size="icon" className="h-7 w-7" title="Recalculate" onClick={() => { if (!p.calculationFormula) return; const paramValues: Record<string, string> = {}; entry.parameters.forEach((ep) => { paramValues[ep.parameterId] = editedValues[`${regId}||${ep.parameterId}`] ?? ep.resultValue ?? ""; }); const result = evaluateFormula(p.calculationFormula, paramValues); if (result) handleValueChange(regId, p.parameterId, result, entry); }}><Calculator className="h-3 w-3 text-primary" /></Button></div>) :
           p.rangeType === "qualitative" && getQualitativeOptions(p.expectedValue).length > 0 ? (
            <Select value={currentValue || undefined} onValueChange={(v) => handleValueChange(regId, p.parameterId, v, entry)}>
              <SelectTrigger className="h-7 text-sm !w-[180px]"><SelectValue placeholder="Select..." /></SelectTrigger>
              <SelectContent>{getQualitativeOptions(p.expectedValue).map((opt: string) => (<SelectItem key={opt} value={opt}>{opt}</SelectItem>))}</SelectContent>
            </Select>
          ) :
           p.rangeType === "descriptive" && p.descriptiveOptions.length > 0 ? (
            <DescriptiveCombobox
              value={currentValue}
              options={p.descriptiveOptions}
              onChange={(v) => handleValueChange(regId, p.parameterId, v, entry)}
              className="!w-[180px]"
            />
          ) : (<Input value={currentValue} onChange={e => handleValueChange(regId, p.parameterId, e.target.value, entry)} className={`h-7 text-sm w-[180px] ${flag === "H" || flag === "L" || flag === "A" || flag === "X" ? "border-destructive text-destructive font-bold" : ""}`} placeholder="Enter result" />)}
        </TableCell>
        <TableCell className="py-1.5 text-xs text-muted-foreground">
          {p.isOutsourced && !p.isSnipMode ? (<Input value={editedUnits[key] !== undefined ? editedUnits[key] : (p.unit || "")} onChange={e => setEditedUnits(prev => ({ ...prev, [key]: e.target.value }))} className="h-6 text-xs w-[70px]" />) : p.unit}
        </TableCell>
        <TableCell className="py-1.5 text-xs text-muted-foreground">
          {p.isOutsourced && !p.isSnipMode ? (<Input value={editedRefRanges[key] !== undefined ? editedRefRanges[key] : (p.referenceRange || "")} onChange={e => setEditedRefRanges(prev => ({ ...prev, [key]: e.target.value }))} className="h-6 text-xs w-[100px]" />) : p.referenceRange}
        </TableCell>
        <TableCell className="py-1.5 text-center">
          {p.isOutsourced && !p.isSnipMode ? (
            <Select value={flag || "none"} onValueChange={(v) => setEditedFlags(prev => ({ ...prev, [key]: v === "none" ? "" : v }))}><SelectTrigger className="h-6 text-xs w-[80px]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">—</SelectItem><SelectItem value="N">Normal</SelectItem><SelectItem value="H">HIGH</SelectItem><SelectItem value="L">LOW</SelectItem></SelectContent></Select>
          ) : (<>{flag === "H" && <Badge variant="destructive" className="text-xs">HIGH</Badge>}{flag === "L" && <Badge variant="destructive" className="text-xs">LOW</Badge>}{flag === "N" && <Badge variant="secondary" className="text-xs text-green-700">Normal</Badge>}{!flag && currentValue && <Badge variant="outline" className="text-xs">—</Badge>}</>)}
        </TableCell>
        <TableCell className="py-1.5 text-center">
          {p.isOutsourced ? (p.outsourceLabName ? <Badge variant="outline" className="text-xs text-green-600 border-green-300 whitespace-nowrap">{p.outsourceLabName}</Badge> : <Badge variant="outline" className="text-xs text-purple-600 border-purple-300">Outsourced</Badge>) : <Badge className="text-xs bg-blue-600">Verified</Badge>}
        </TableCell>
        <TableCell className="py-1.5 text-center">
          {p.isOutsourced && (() => { const sd = outsourcedSnipDetails[`${regId}||${p.testId}`]; if (sd?.resultMode === "snip" && sd.snipImageUrls.length > 0) return (<Button size="sm" variant="ghost" className="h-5 px-1 text-xs text-blue-600 gap-0.5" onClick={() => setViewSnipImages(sd.snipImageUrls)}><Eye className="h-3 w-3" /> View</Button>); return null; })()}
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
          <span className="font-semibold">{reg.invoice_number}</span>
          {!["sample_accepted","entered","verified"].includes(reg.status) && Array.isArray(reg.accepted_samples) && reg.accepted_samples.length > 0 && (
            <Badge className="bg-amber-100 text-amber-700 text-[10px]">PARTIAL</Badge>
          )}
          {reg.is_stat && <span className="relative inline-flex h-2.5 w-2.5 ml-1.5 align-middle"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-destructive opacity-75" /><span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-destructive" /></span>}
          <span className="text-sm text-muted-foreground">{reg.patient_name}</span>
        </div>
        {/* Snip-only outsourced tests */}
        {entry.snipOnlyTests.length > 0 && entry.snipOnlyTests.map(st => {
          const testKey = `${reg.id}||${st.testId}`;
          const isApproving = actionKey === `${testKey}||approve`;
          const isSendingBack = actionKey === `${testKey}||back`;
          return (
            <div key={`snip-${st.testId}`} className="flex items-center justify-between px-3 py-2 bg-blue-50 border border-blue-200 rounded text-sm">
              <div className="flex items-center gap-2">
                <Stethoscope className="h-4 w-4 text-blue-600 shrink-0" />
                <span className="font-medium text-blue-800">{st.testName}</span>
                {st.labName && <Badge variant="outline" className="text-[10px] text-green-600 border-green-300">{st.labName}</Badge>}
                <Button size="sm" variant="ghost" className="h-5 px-1 text-xs text-blue-600 gap-0.5" onClick={() => setViewSnipImages(st.snipUrls)}>
                  <Eye className="h-3 w-3" /> View Snip
                </Button>
              </div>
              <div className="flex items-center gap-1">
                <Button size="sm" variant="ghost" className="h-6 text-[11px] gap-1 text-orange-600" disabled={isSendingBack} onClick={() => sendBackForVerification(reg.id, st.testId, st.testName)}>
                  {isSendingBack ? <Loader2 className="h-3 w-3 animate-spin" /> : <Undo2 className="h-3 w-3" />} Send Back
                </Button>
                <Button size="sm" variant="default" className="h-6 text-[11px] gap-1" disabled={isApproving} onClick={async () => {
                  const snipApproverChoice = await resolveApprover();
                  if (!snipApproverChoice) return;
                  setActionKey(`${testKey}||approve`);
                  try {
                    await supabase.from("outsourced_test_snips").update({ outsource_status: "approved" } as any).eq("registration_id", reg.id).eq("test_id", st.testId).eq("outsource_status", "verified");
                    // Merge with existing approved_reports data
                    const { data: existSnipReport } = await supabase.from("approved_reports").select("test_results, outsourced_snip_urls").eq("registration_id", reg.id).maybeSingle();
                    const prevResults = Array.isArray((existSnipReport as any)?.test_results) ? (existSnipReport as any).test_results : [];
                    const prevSnipUrls = Array.isArray((existSnipReport as any)?.outsourced_snip_urls) ? (existSnipReport as any).outsourced_snip_urls : [];
                    const newResults = prevResults.filter((r: any) => r.test_id !== st.testId).concat([{ test_id: st.testId, test_name: st.testName, is_outsourced: true, outsource_lab_name: st.labName, approved_by: snipApproverChoice.pathologistName, approved_by_qualification: snipApproverChoice.qualification, approved_by_designation: snipApproverChoice.designation, approved_by_signature_url: snipApproverChoice.signatureUrl }]);
                    const newSnipUrls = [...new Set([...prevSnipUrls.filter((u: string) => !u.includes(st.testId)), ...st.snipUrls])];
                    const { data: tubesForColSnip } = await supabase.from("sample_tubes").select("collected_at").eq("registration_id", reg.id).not("collected_at", "is", null);
                    const firstCollectedAtSnip = tubesForColSnip?.length ? (tubesForColSnip.map((t: any) => t.collected_at).sort()[0] as string) : null;
                    await supabase.from("approved_reports").upsert({ registration_id: reg.id, invoice_number: reg.invoice_number, umr_number: reg.umr_number, patient_name: reg.patient_name, title: reg.title, gender: reg.gender, dob: reg.dob, mobile_number: reg.mobile_number, email: reg.email, address: reg.address, doctor_name: reg.doctor_name, visit_type: reg.visit_type, is_stat: reg.is_stat, report_language: reg.report_language, approved_by: snipApproverChoice.pathologistName, registration_date: reg.created_at, approval_date: new Date().toISOString(), sample_collection_date: firstCollectedAtSnip, test_results: newResults, outsourced_snip_urls: newSnipUrls } as any, { onConflict: "registration_id" as any, ignoreDuplicates: false });
                    toast.success(`${st.testName} approved`);
                    invalidateAll();
                  } catch (err: any) { toast.error(err.message || "Approval failed"); }
                  finally { setActionKey(null); }
                }}>
                  {isApproving ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />} Approve
                </Button>
              </div>
            </div>
          );
        })}
        {machineGroups.map((mg) => (
          <div key={mg.machineName} className="space-y-1">
            <div className="text-xs font-semibold text-primary uppercase tracking-wider px-1 pt-2 border-b border-primary/20 pb-1 flex items-center gap-1.5"><Monitor className="h-3.5 w-3.5" /> {mg.machineName}</div>
            {groupByTest(mg.params).map((tg) => {
              const testKey = `${reg.id}||${tg.testId}`;
              const isApproving = actionKey === `${testKey}||approve`;
              const isSendingBack = actionKey === `${testKey}||back`;
              const isRepeat = actionKey === `${testKey}||repeat`;
              return (
                <div key={tg.testId} className="ml-1">
                  <div className="flex items-center justify-between px-1 py-0.5 bg-muted/40 rounded-t">
                    <div className="flex items-center gap-2">
                      <span className="text-base font-bold text-foreground">{tg.testName}</span>
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
                      <Button size="sm" variant="ghost" className="h-6 text-[11px] gap-1 text-orange-600" disabled={isSendingBack} onClick={() => sendBackForVerification(reg.id, tg.testId, tg.testName)}>
                        {isSendingBack ? <Loader2 className="h-3 w-3 animate-spin" /> : <Undo2 className="h-3 w-3" />} Send Back
                      </Button>
                      <Button size="sm" variant="ghost" className="h-6 text-[11px] gap-1 text-destructive" disabled={isRepeat} onClick={() => requestRepeatCollection(reg.id, tg.testId, tg.testName)}>
                        {isRepeat ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />} Repeat Sample
                      </Button>
                      <Button size="sm" variant="default" className="h-6 text-[11px] gap-1" disabled={isApproving} onClick={() => approveTest(entry, tg.testId, tg.testName)}>
                        {isApproving ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />} Approve
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
                    <TableHeader><TableRow>
                      <TableHead className="py-1 text-xs w-[80px]">Code</TableHead><TableHead className="py-1 text-xs">Parameter</TableHead>
                      <TableHead className="py-1 text-xs w-[100px]">Prev 1</TableHead><TableHead className="py-1 text-xs w-[100px]">Prev 2</TableHead>
                      <TableHead className="py-1 text-xs w-[200px]">Result</TableHead><TableHead className="py-1 text-xs w-[60px]">Unit</TableHead>
                      <TableHead className="py-1 text-xs w-[120px]">Ref. Range</TableHead><TableHead className="py-1 text-xs w-[70px] text-center">Flag</TableHead>
                      <TableHead className="py-1 text-xs w-[70px] text-center">Status</TableHead><TableHead className="py-1 text-xs w-[40px] text-center"></TableHead>
                    </TableRow></TableHeader>
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
      <Tabs value={activeSection} onValueChange={v => setActiveSection(v as any)} className="w-auto">
        <TabsList className="h-9">
          <TabsTrigger value="approval" className="text-xs gap-1 h-7"><Stethoscope className="h-3.5 w-3.5" /> Doctor Approval</TabsTrigger>
          <TabsTrigger value="modified" className="text-xs gap-1 h-7"><FileCheck className="h-3.5 w-3.5" /> Modified Approval</TabsTrigger>
        </TabsList>
      </Tabs>

      {activeSection === "modified" ? (
        <ModifiedApproval />
      ) : (
      <>
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
              {(() => { const machines = new Set<string>(); masterMachines.forEach((m: any) => machines.add(m.value)); patientEntries.forEach(e => e.parameters.forEach(p => { if (p.machineName) machines.add(p.machineName); })); machines.add("Others"); return Array.from(machines).sort((a, b) => a === "Others" ? 1 : b === "Others" ? -1 : a.localeCompare(b)); })().map(m => (<SelectItem key={m} value={m === "Others" ? "others" : m}>{m}</SelectItem>))}
            </SelectContent>
          </Select>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Card className="p-3"><div className="text-xs text-muted-foreground">Patients for Approval</div><div className="text-xl font-bold">{stats.totalPatients}</div></Card>
        <Card className="p-3"><div className="text-xs text-muted-foreground">Parameters to Review</div><div className="text-xl font-bold">{stats.totalParams}</div></Card>
      </div>

      {loadingRegs ? (<Card><CardContent className="p-8 text-center text-muted-foreground">Loading…</CardContent></Card>) :
       filteredEntries.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Stethoscope className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p className="text-lg font-medium">No results pending doctor approval</p>
          <p className="text-sm">All verified results have been approved</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filteredEntries.map(entry => {
            const reg = entry.registration;
            const isExpanded = expandedPatient === reg.id;
            const isApproving = actionKey === `${reg.id}||all||approve`;
            return (
              <Card key={reg.id} className={isExpanded ? "ring-1 ring-primary/30" : ""}>
                <div className="flex items-center gap-3 p-3 cursor-pointer hover:bg-muted/30 transition-colors" onClick={() => setExpandedPatient(isExpanded ? null : reg.id)}>
                  {isExpanded ? <ChevronUp className="h-4 w-4 shrink-0" /> : <ChevronDown className="h-4 w-4 shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium font-mono">{reg.invoice_number}</span>
                      {!["sample_accepted","entered","verified"].includes(reg.status) && Array.isArray(reg.accepted_samples) && reg.accepted_samples.length > 0 && (
                        <Badge className="bg-amber-100 text-amber-700 text-[10px]">PARTIAL</Badge>
                      )}
                      {reg.is_stat && <span className="relative inline-flex h-2.5 w-2.5"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-destructive opacity-75" /><span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-destructive" /></span>}
                      <span className="text-sm text-muted-foreground">{reg.patient_name}</span>
                    </div>
                    <div className="text-xs text-muted-foreground">{reg.mobile_number} • {entry.parameters.length} parameters</div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button size="sm" variant="default" className="h-7 text-xs" disabled={isApproving} onClick={(e) => { e.stopPropagation(); approveAllForPatient(entry); }}>
                      {isApproving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <CheckCircle2 className="h-3.5 w-3.5 mr-1" />} Approve All
                    </Button>
                  </div>
                </div>
                {isExpanded && (<CardContent className="pt-0 pb-3 px-3">{renderPatientExpanded(entry)}</CardContent>)}
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={!!viewSnipImages} onOpenChange={open => { if (!open) setViewSnipImages(null); }}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Outsourced Result — Snipped Images</DialogTitle></DialogHeader>
          <div className="space-y-4">{viewSnipImages?.map((url, idx) => (<div key={idx} className="border rounded-lg overflow-hidden"><img src={url} alt={`Snip page ${idx + 1}`} className="w-full object-contain" /></div>))}</div>
        </DialogContent>
      </Dialog>
      {daTotalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <Button variant="outline" size="sm" disabled={daPage === 0} onClick={() => setDaPage(p => p - 1)}>Prev</Button>
          <span className="text-sm text-muted-foreground">Page {daPage + 1} of {daTotalPages} ({daCount} total)</span>
          <Button variant="outline" size="sm" disabled={daPage >= daTotalPages - 1} onClick={() => setDaPage(p => p + 1)}>Next</Button>
        </div>
      )}
      </>
      )}
      <SelectApproverDialog open={approverDialogOpen} onOpenChange={handleApproverDialogCancel} onConfirm={handleApproverDialogConfirm} />
    </div>
  );
};

export default DoctorApproval;
