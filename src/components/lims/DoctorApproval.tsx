import { mergeApprovedReportSnapshot, approvedReportHeaderFromReg } from "@/lib/approvedReportSnapshot";
import { getCachedSignatureDataUrl } from "@/lib/reportAssetCache";
import RefreshButton from "@/components/lims/RefreshButton";
import PageSizeSelect from "@/components/lims/PageSizeSelect";
import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { recalculateRegistrationStatus } from "@/lib/limsStatus";
import { formatAgeGender, patientAgeYears } from "@/lib/ageGender";
import { patientDisplayName } from "@/lib/patientDisplayName";
import PatientTestPipelineHover from "./PatientTestPipelineHover";
import { isSuspectNegativeResult, calculateResultFlag } from "@/lib/reportFlags";
import TimeResultInput from "./TimeResultInput";
import { parseTimeResultToSeconds, isCanonicalTimeValue, formatTimeResult } from "@/lib/timeRange";
import { getCurrentUser, getCurrentUserName } from "@/lib/auth";
import { useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { useLimsPipelineRealtime } from "@/hooks/useLimsPipelineRealtime";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  loadOutsourcedRefRange,
  loadOutsourcedUnit,
  resolveOutsourcedFlag,
  resolveOutsourcedRefRange,
  resolveOutsourcedUnit,
} from "@/lib/outsourcedResultOverrides";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Search, User, Monitor, Calculator, ChevronDown, ChevronUp, Loader2, CheckCircle2, Undo2, RotateCcw, Eye, Stethoscope, FileCheck, StickyNote, Trash2, AlertTriangle } from "lucide-react";
import { DescriptiveCombobox } from "./DescriptiveCombobox";
import { useMasterLookup } from "@/hooks/useMasterLookup";
import { checkDifferentialSum } from "@/lib/differentialCount";
import { isCbcCriticalOnlyParamCode, partitionCbcCriticalParams } from "@/lib/cbcSmear";
import { CbcOptionalParamsToggle } from "@/components/lims/CbcOptionalParamsToggle";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { formatDateDDMMYYYY } from "@/lib/utils";
import { expandRegistrationTests } from "@/lib/expandRegistrationTests";
import ModifiedApproval from "./ModifiedApproval";
import SelectApproverDialog, { ApproverChoice } from "./SelectApproverDialog";
import { useNewArrivalsBadge } from "@/hooks/useNewArrivalsBadge";
import { signalSync } from "@/lib/limsSyncSignal";
import { propagateRegistrationChange } from "@/lib/limsPropagation";
import { fetchDoctorApprovalCandidateIds, fetchFilteredSortedIds } from "@/lib/limsPendingCandidates";
import { fetchAllByIds } from "@/lib/fetchAllRows";
import { PATIENT_RESULTS_SELECT_DOCTOR } from "@/lib/patientResultsSelect";
import { shortIdsKey } from "@/lib/queryKeys";
import { readLimsPageSize, type LimsPageSize } from "@/lib/limsListPrefs";
import SyncingOverlay from "./SyncingOverlay";

/** List headers — omit tests / cancelled_tests JSON (egress). */
const REG_LIST_SELECT =
  "id, invoice_number, patient_name, title, mobile_number, umr_number, status, is_stat, visit_type, gender, dob, age_text, email, address, created_at, updated_at, bill_cancelled, doctor_name, report_language";
const REG_DETAIL_SELECT = `${REG_LIST_SELECT}, tests, cancelled_tests`;
import NewBadge from "./NewBadge";
import { isSnipResultDetail } from "@/lib/outsourcedResultMode";

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
  displayOrder: number; rangeType: string; descriptiveOptions: string[]; expectedValue: string; normalFindings: string; normalRangeText: string;
  isOutsourced: boolean; outsourceLabName: string | null; outsourceStatus: string; isSnipMode: boolean;
  enteredAt: string | null; enteredBy: string | null; verifiedAt: string | null; verifiedBy: string | null;
  note: string;
}

interface SnipOnlyTest {
  testId: string;
  testName: string;
  labName: string | null;
  snipUrls: string[];
  composedPdfUrl?: string | null;
  outsourceStatus: string;
}

interface PatientEntry { registration: any; parameters: ParameterResult[]; snipOnlyTests: SnipOnlyTest[]; }

const DoctorApproval = () => {
  const qc = useQueryClient();
  useLimsPipelineRealtime("doctor_approval");
  const { data: masterMachines = [] } = useMasterLookup("machine_name");
  const [activeSection, setActiveSection] = useState<"approval" | "modified">("approval");
  const [mode, setMode] = useState<"patient" | "machine">("patient");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedMachine, setSelectedMachine] = useState<string>("all");
  const [pageSize, setPageSize] = useState<LimsPageSize>(() => readLimsPageSize());
  const [expandedPatient, setExpandedPatient] = useState<string | null>(null);
  /** Accordion: only one test's parameters open at a time. */
  const [expandedTestKey, setExpandedTestKey] = useState<string | null>(null);
  const [optionalCbcOpen, setOptionalCbcOpen] = useState<Record<string, boolean>>({});
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
  const [diffConfirm, setDiffConfirm] = useState<{ entry: PatientEntry; mode: "test" | "all"; testId: string; testName: string; issues: { testName: string; sum: number; diff: number }[] } | null>(null);

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
            signatureUrl =
              (await getCachedSignatureDataUrl(sigData.signature_image_path, u.publicUrl)) ||
              u.publicUrl;
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
  useEffect(() => { setExpandedTestKey(null); }, [expandedPatient]);

  const { data: pendingIds = [] as string[], isLoading: loadingIds, isPlaceholderData: idsPlaceholder } = useQuery({
    queryKey: ["doctor_approval_count", debouncedSearch],
    queryFn: async (): Promise<string[]> => {
      const candidates = await fetchDoctorApprovalCandidateIds();
      return await fetchFilteredSortedIds(candidates, debouncedSearch);
    },
    placeholderData: keepPreviousData,
    staleTime: 120_000,
  });
  const daCount = pendingIds.length;
  const pageIds: string[] = pendingIds.slice(daPage * pageSize, (daPage + 1) * pageSize);
  const pageKey = shortIdsKey(pageIds, "da-p");

  const { data: registrationsRaw = [], isLoading: loadingRegs } = useQuery({
    queryKey: ["doctor_approval_regs", pageKey],
    enabled: pageIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase.from("patient_registrations")
        .select(REG_LIST_SELECT)
        .in("id", pageIds);
      const order = new Map(pageIds.map((id, i) => [id, i] as const));
      return ((data || []) as any[]).sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
    },
    staleTime: 120_000,
  });

  // Disabled queries keep last rows; clear when the queue is freshly empty.
  // Do NOT hide partially_approved / partially_dispatched bills by registration
  // status — remaining verified tests must stay visible.
  const registrations = useMemo(() => {
    if (!idsPlaceholder && pendingIds.length === 0) return [];
    if (pageIds.length === 0) return [];
    const onPage = new Set(pageIds);
    return (registrationsRaw as any[]).filter((r) => onPage.has(r.id));
  }, [registrationsRaw, pageIds, pendingIds.length, idsPlaceholder]);

  const daTotalPages = Math.max(1, Math.ceil(daCount / pageSize));

  const regIds = registrations.map((r: any) => r.id);

  // Detail fetches ONLY for expanded patient
  const detailRegIds = expandedPatient ? [expandedPatient] : [];
  const detailKey = shortIdsKey(detailRegIds, "da");
  const detailEnabled = !!expandedPatient;

  const { data: existingResults = [], isFetched: resultsFetched } = useQuery({
    queryKey: ["doctor_approval_results", detailKey],
    enabled: detailEnabled,
    queryFn: async () => {
      return await fetchAllByIds<any>("patient_results", PATIENT_RESULTS_SELECT_DOCTOR, "registration_id", detailRegIds, { eq: { status: "verified" } });
    },
  });

  // Fetch sample tubes to expand PRL/HLT container rows into leaf tests
  const { data: regTubes = [], isFetched: tubesFetched } = useQuery({
    queryKey: ["doctor_approval_tubes", detailKey],
    enabled: detailEnabled,
    queryFn: async () => {
      return await fetchAllByIds<any>("sample_tubes", "id, registration_id, test_ids", "registration_id", detailRegIds);
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

  const { data: detailReg, isFetched: detailRegFetched } = useQuery({
    queryKey: ["doctor_approval_reg_detail", expandedPatient],
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

  const detailReady = !detailEnabled || (resultsFetched && tubesFetched && detailRegFetched && !!detailReg);
  const listLoading = loadingIds || loadingRegs;

  const { data: outsourcedSnips = [] } = useQuery({
    queryKey: ["doctor_approval_snips", detailKey],
    enabled: detailEnabled,
    queryFn: async () => {
      return await fetchAllByIds<any>(
        "outsourced_test_snips",
        "id, registration_id, test_id, outsourced_parameter_ids, outsource_status, outsourced_lab_name, result_mode, snip_image_urls, composed_pdf_url",
        "registration_id",
        detailRegIds,
        { eq: { outsource_status: "verified" } },
      );
    },
  });

  const { transferredTestKeys, outsourcedParamSets, outsourcedSnipDetails } = useMemo(() => {
    const testKeys = new Set<string>(); const paramSets: Record<string, Set<string>> = {};
    const details: Record<string, { status: string; labName: string | null; resultMode: string; snipImageUrls: string[]; composedPdfUrl?: string | null }> = {};
    outsourcedSnips.forEach((s: any) => {
      const key = `${s.registration_id}||${s.test_id}`;
      const urls = Array.isArray(s.snip_image_urls) ? s.snip_image_urls : [];
      details[key] = { status: s.outsource_status || "pending", labName: s.outsourced_lab_name || null, resultMode: s.result_mode || "manual", snipImageUrls: urls, composedPdfUrl: s.composed_pdf_url || null };
      const paramIds = Array.isArray(s.outsourced_parameter_ids) ? s.outsourced_parameter_ids : [];
      if (paramIds.length > 0) { if (!paramSets[key]) paramSets[key] = new Set(); paramIds.forEach((pid: string) => paramSets[key].add(pid)); }
      else testKeys.add(key);
    });
    return { transferredTestKeys: testKeys, outsourcedParamSets: paramSets, outsourcedSnipDetails: details };
  }, [outsourcedSnips]);

  const { data: testsMap = {} } = useQuery({
    queryKey: ["results_tests_map"],
    enabled: detailEnabled,
    staleTime: 600_000,
    queryFn: async () => {
      const { data } = await supabase.from("tests").select("id, test_name, department_id, instrument_name");
      const map: Record<string, any> = {};
      (data || []).forEach((t: any) => { map[t.id] = t; });
      return map;
    },
  });
  const { data: testParamsMap = {} } = useQuery({
    queryKey: ["results_test_params_full"],
    enabled: detailEnabled,
    staleTime: 600_000,
    queryFn: async () => {
      const { data } = await supabase.from("test_parameters").select("test_id, parameter_id, display_order, is_subheader, subheader_text, report_test_parameters(id, param_code, parameter_name, unit, normal_range_low, normal_range_high, normal_range_text, is_calculated, calculation_formula, send_for_interface)").order("display_order");
      const map: Record<string, any[]> = {};
      (data || []).forEach((tp: any) => { if (!tp.test_id) return; if (!map[tp.test_id]) map[tp.test_id] = []; map[tp.test_id].push(tp); });
      return map;
    },
  });
  const { data: normalRangesMap = {} } = useQuery({
    queryKey: ["results_normal_ranges"],
    enabled: detailEnabled,
    staleTime: 600_000,
    queryFn: async () => {
      const { data } = await supabase.from("parameter_normal_ranges").select("*").order("age_min");
      const map: Record<string, any[]> = {};
      (data || []).forEach((r: any) => { if (!map[r.parameter_id]) map[r.parameter_id] = []; map[r.parameter_id].push(r); });
      return map;
    },
  });

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
    if (!ranges || ranges.length === 0) return { text: "", low: null as number | null, high: null as number | null, rangeType: "numeric", descriptiveOptions: [] as string[], expectedValue: "", normalFindings: "" };
    let patientAge: number | null = patientAgeYears(reg?.dob, reg?.age_text);
    const pg = (reg.gender || "").toLowerCase().charAt(0);
    let candidates = ranges.filter((r: any) => { const g = (r.gender || "all").toLowerCase(); return g === "all" || (g === "male" && pg === "m") || (g === "female" && pg === "f"); });
    if (patientAge != null) { const am = candidates.filter((r: any) => { if (r.age_min == null && r.age_max == null) return true; if (r.age_min != null && patientAge! < r.age_min) return false; if (r.age_max != null && patientAge! > r.age_max) return false; return true; }); if (am.length > 0) candidates = am; }
    const best = candidates.find((r: any) => (r.gender || "all").toLowerCase() !== "all") || candidates[0];
    if (!best) return { text: "", low: null as number | null, high: null as number | null, rangeType: "numeric", descriptiveOptions: [] as string[], expectedValue: "", normalFindings: "" };
    const text = best.normal_range_text || (best.normal_range_low != null && best.normal_range_high != null ? `${best.normal_range_low} - ${best.normal_range_high}` : "");
    return { text, low: best.normal_range_low, high: best.normal_range_high, rangeType: best.range_type || "numeric", descriptiveOptions: Array.isArray(best.descriptive_options) ? best.descriptive_options : [], expectedValue: best.expected_value || "", normalFindings: best.normal_findings || "" };
  }, [normalRangesMap]);

  const patientEntries: PatientEntry[] = useMemo(() => {
    return registrations.map((reg: any) => {
      if (reg.id !== expandedPatient || !detailReady || !detailReg) {
        return { registration: reg, parameters: [], snipOnlyTests: [] };
      }
      const fullReg = { ...reg, ...detailReg };
      const tests = (fullReg.tests || []) as any[];
      const cancelledIds = new Set(((fullReg.cancelled_tests || []) as any[]).map((t: any) => t.test_id));
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
        const isSnipResult = isSnipResultDetail(snipDetail);
        const isParamLevel = !!(paramOutsourcedSet && paramOutsourcedSet.size > 0);

        if (isSnipResult && !isParamLevel && snipDetail.status === "verified") {
          snipOnlyTests.push({ testId: t.test_id, testName: t.test_name || testInfo.test_name || "", labName: snipDetail.labName, snipUrls: snipDetail.snipImageUrls, composedPdfUrl: snipDetail.composedPdfUrl || null, outsourceStatus: snipDetail.status });
          if (validParams.length === 0) continue;
        }

        if (validParams.length === 0) {
          if (snipDetail && (snipDetail.composedPdfUrl || snipDetail.snipImageUrls.length > 0) && snipDetail.status === "verified") {
            snipOnlyTests.push({ testId: t.test_id, testName: t.test_name || testInfo.test_name || "", labName: snipDetail.labName, snipUrls: snipDetail.snipImageUrls, composedPdfUrl: snipDetail.composedPdfUrl || null, outsourceStatus: snipDetail.status });
          }
          continue;
        }
        if (isSnipResult && isParamLevel && snipDetail.status === "verified") {
          snipOnlyTests.push({ testId: t.test_id, testName: t.test_name || testInfo.test_name || "", labName: snipDetail.labName, snipUrls: snipDetail.snipImageUrls, composedPdfUrl: snipDetail.composedPdfUrl || null, outsourceStatus: snipDetail.status });
        }

        const testVerifiedResults = existingResults.filter((r: any) => r.registration_id === reg.id && r.test_id === t.test_id);
        if (testVerifiedResults.length === 0 && !snipDetail) continue;
        // Fully approved/dispatched tests belong in Modified Approval / Dispatch only
        if (
          testVerifiedResults.length > 0 &&
          testVerifiedResults.every((r: any) => r.status === "approved" || r.status === "dispatched")
        ) {
          continue;
        }
        for (const tp of params) {
          if (tp.is_subheader) continue;
          const p = tp.report_test_parameters; if (!p) continue;
          const isParamOutsourced = isFullTestOutsourced || (paramOutsourcedSet && paramOutsourcedSet.has(p.id));
          const existing = testVerifiedResults.find((r: any) => r.parameter_id === p.id);
          if (!existing && !isParamOutsourced) continue;
          if (existing?.status === "approved" || existing?.status === "dispatched") continue;
          const resolved = resolveNormalRange(p.id, fullReg);
          const refText = resolved.text || p.normal_range_text || (p.normal_range_low != null && p.normal_range_high != null ? `${p.normal_range_low} - ${p.normal_range_high}` : "");
          const savedUnit = loadOutsourcedUnit(!!isParamOutsourced, existing, p.unit || "");
          const savedRefRange = loadOutsourcedRefRange(
            !!isParamOutsourced,
            existing,
            refText,
            resolved.rangeType,
            resolved.text || "",
          );
          parameters.push({
            parameterId: p.id, paramCode: p.param_code || "", parameterName: p.parameter_name,
            unit: savedUnit, referenceRange: savedRefRange, normalRangeLow: resolved.low ?? p.normal_range_low, normalRangeHigh: resolved.high ?? p.normal_range_high,
            resultValue: existing?.result_value || "", flag: existing?.flag || "", isCalculated: p.is_calculated || false,
            calculationFormula: p.calculation_formula || [], isFromInterface: existing?.is_from_interface || false,
            sendForInterface: p.send_for_interface || false, status: existing?.status || "pending", testId: t.test_id,
            testName: t.test_name || testInfo.test_name || "", departmentId: testInfo.department_id || "",
            machineName: testInfo.instrument_name || "", displayOrder: tp.display_order || 0,
            rangeType: resolved.rangeType, descriptiveOptions: resolved.descriptiveOptions, expectedValue: resolved.expectedValue, normalFindings: resolved.normalFindings, normalRangeText: resolved.text || "",
            isOutsourced: !!isParamOutsourced, outsourceLabName: isParamOutsourced ? (snipDetail?.labName || null) : null,
            outsourceStatus: isParamOutsourced ? (snipDetail?.status || "pending") : "",
            isSnipMode: false,
            enteredAt: existing?.entered_at || null, enteredBy: existing?.entered_by || null, verifiedAt: existing?.verified_at || null, verifiedBy: existing?.verified_by || null,
            note: existing?.note || "",
          });
        }
      }
      return { registration: fullReg, parameters, snipOnlyTests };
    });
  }, [registrations, expandedPatient, detailReady, detailReg, testsMap, testParamsMap, existingResults, resolveNormalRange, transferredTestKeys, outsourcedParamSets, outsourcedSnipDetails, leafIdsByReg]);

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

  const calculateFlag = (value: string, low: number | null, high: number | null, rangeType?: string, expectedValue?: string, descriptiveOptions?: string[], normalRangeText?: string, unit?: string | null, normalFindings?: string): string => {
    if (!value || !value.trim()) return "";
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

  const applyUnitSuffix = (value: string, unit: string | null | undefined, rangeType?: string): string => {
    if (!value || rangeType !== "undefined" || !unit) return value;
    const trimmed = value.trim();
    const u = unit.trim();
    if (!u) return trimmed;
    if (trimmed.toLowerCase().endsWith(u.toLowerCase())) return trimmed;
    return `${trimmed} ${u}`;
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
    setEditedFlags((prev) => {
      if (prev[key] === undefined) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
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

  const filteredEntries = useMemo(() => {
    if (mode === "patient") return patientEntries;
    if (selectedMachine === "all") return patientEntries;
    const fm = selectedMachine === "others" ? "" : selectedMachine;
    return patientEntries.map(e => {
      if (e.registration.id !== expandedPatient) return e;
      return { ...e, parameters: e.parameters.filter(p => (p.machineName || "") === fm) };
    });
  }, [patientEntries, mode, selectedMachine, expandedPatient]);

  const stats = useMemo(() => ({ totalPatients: filteredEntries.length, totalParams: filteredEntries.reduce((s, e) => s + e.parameters.length, 0) }), [filteredEntries]);

  // ─── NEW arrivals badge tracker ───
  const filteredRegIds = useMemo(() => filteredEntries.map(e => e.registration.id), [filteredEntries]);
  const { isNew: isNewArrival, markSeen: markArrivalSeen } = useNewArrivalsBadge("doctor_approval", filteredRegIds);

  const groupByMachine = (params: ParameterResult[]) => { const g: Record<string, { machineName: string; params: ParameterResult[] }> = {}; for (const p of params) { const m = p.machineName || "Others"; if (!g[m]) g[m] = { machineName: m, params: [] }; g[m].params.push(p); } return Object.values(g); };
  const groupByTest = (params: ParameterResult[]) => { const g: Record<string, { testId: string; testName: string; params: ParameterResult[] }> = {}; for (const p of params) { if (!g[p.testId]) g[p.testId] = { testId: p.testId, testName: p.testName, params: [] }; g[p.testId].params.push(p); } return Object.values(g); };

  // Legacy fallback — most callers should use propagateRegistrationChange instead.
  const invalidateAll = () => {
    [
      "doctor_approval_regs", "doctor_approval_count", "doctor_approval_results",
      "doctor_approval_snips", "doctor_approval_history", "doctor_approval_tubes",
      "verification_results_v2", "verification_outsourced_v2", "verification_regs_v2",
      "results_accepted_regs", "patient_results_existing",
      "dispatch_regs", "dispatch_all_results", "dispatch_all_snips",
    ].forEach((k) => qc.invalidateQueries({ queryKey: [k], refetchType: "active" }));
  };

  // Compute differential issue for a single test of an entry
  const computeDiffIssue = (entry: PatientEntry, testId: string) => {
    const reg = entry.registration;
    const testParams = entry.parameters.filter((p) => p.testId === testId);
    const list = testParams.map((p) => {
      const k = `${reg.id}||${p.parameterId}`;
      const val = editedValues[k] !== undefined ? editedValues[k] : p.resultValue;
      return { paramCode: p.paramCode, value: val };
    });
    const r = checkDifferentialSum(list);
    return r.hasDifferential && !r.isOk ? r : null;
  };

  // Approve test
  const approveTest = async (entry: PatientEntry, testId: string, testName: string, skipDiffCheck = false) => {
    const reg = entry.registration;
    if (!skipDiffCheck) {
      const issue = computeDiffIssue(entry, testId);
      if (issue) {
        setDiffConfirm({ entry, mode: "test", testId, testName, issues: [{ testName, sum: issue.sum, diff: issue.diff }] });
        return;
      }
    }
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
        const autoFlag = calculateFlag(value, p.normalRangeLow, p.normalRangeHigh, p.rangeType, p.expectedValue, p.descriptiveOptions, p.normalRangeText, p.unit, p.normalFindings);
        const flag = resolveOutsourcedFlag({
          isOutsourced: p.isOutsourced,
          editedFlag: editedFlags[k],
          savedFlag: p.flag,
          autoFlag,
          currentValue: value,
          savedValue: p.resultValue,
        });
        const unit = resolveOutsourcedUnit({
          isOutsourced: p.isOutsourced,
          editedUnit: editedUnits[k],
          savedUnit: p.unit,
          masterUnit: p.unit,
        });
        const refRange = resolveOutsourcedRefRange({
          isOutsourced: p.isOutsourced,
          editedRef: editedRefRanges[k],
          savedRef: p.referenceRange,
          masterRef: p.referenceRange,
          rangeType: p.rangeType,
          normalRangeText: p.normalRangeText,
        });
         const noteVal = editedNotes[k] !== undefined ? editedNotes[k] : p.note;
         const testNoteVal = editedTestNotes[`${reg.id}||${testId}`] !== undefined ? editedTestNotes[`${reg.id}||${testId}`] : (loadedTestNotes[`${reg.id}||${testId}`] || "");
         upserts.push({ registration_id: reg.id, test_id: p.testId, parameter_id: p.parameterId, param_code: p.paramCode, parameter_name: p.parameterName, result_value: applyUnitSuffix(value, unit, p.rangeType) || null, unit, reference_range: refRange, normal_range_low: p.normalRangeLow, normal_range_high: p.normalRangeHigh, flag: flag || null, status: "approved", is_calculated: p.isCalculated, is_from_interface: p.isFromInterface, approved_at: new Date().toISOString(), entered_at: p.enteredAt || null, entered_by: p.enteredBy || null, verified_at: p.verifiedAt || null, verified_by: p.verifiedBy || null, approved_by: approver.pathologistName, note: noteVal || null, test_note: testNoteVal || null });
      }
      if (upserts.length > 0) {
        const paramIds = [...new Set(upserts.map((u) => u.parameter_id).filter(Boolean))];
        await supabase
          .from("patient_results")
          .delete()
          .eq("registration_id", reg.id)
          .eq("test_id", testId)
          .in("parameter_id", paramIds)
          .eq("status", "verified");
        await supabase.from("patient_results").insert(upserts as any);
      }
      await supabase.from("outsourced_test_snips").update({ outsource_status: "approved", approved_at: new Date().toISOString(), approved_by: approver.pathologistName } as any).eq("registration_id", reg.id).eq("test_id", testId).eq("outsource_status", "verified");

      // Atomic DB merge (row lock) — prevents concurrent approvals from dropping tests.
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
      const { data: tubesForCol } = await supabase.from("sample_tubes").select("collected_at").eq("registration_id", reg.id).not("collected_at", "is", null);
      const firstCollectedAt = tubesForCol?.length ? (tubesForCol.map((t: any) => t.collected_at).sort()[0] as string) : null;
      const approvalAt = new Date().toISOString();
      await mergeApprovedReportSnapshot({
        registrationId: reg.id,
        incoming: testResultsSnapshot,
        snipUrls,
        header: approvedReportHeaderFromReg(reg, {
          approvedBy: approver.pathologistName,
          approvalAt,
          sampleCollectionDate: firstCollectedAt,
        }),
      });

      // Status is recalculated authoritatively by propagateRegistrationChange below
      // (which calls recalculateRegistrationStatus). Do NOT write status directly here:
      // a direct write bypasses the "untracked accepted-tube test" guard and can leave
      // a registration stranded with status='approved' while real work is still pending,
      // making it invisible to every queue except Dispatch.

      setEditedValues(prev => { const next = { ...prev }; testParams.forEach(p => delete next[`${reg.id}||${p.parameterId}`]); return next; });
      await propagateRegistrationChange(qc, reg.id, ["doctor_approval", "dispatch"]);
      toast.success(`${testName} approved`);
    } catch (err: any) { toast.error(err.message || "Approval failed"); }
    finally { setActionKey(null); }
  };

  const approveAllForPatient = async (entry: PatientEntry, skipDiffCheck = false) => {
    const reg = entry.registration;
    if (!skipDiffCheck) {
      const testIds = [...new Set(entry.parameters.map((p) => p.testId))];
      const issues: { testName: string; sum: number; diff: number }[] = [];
      for (const tid of testIds) {
        const issue = computeDiffIssue(entry, tid);
        if (issue) {
          const tName = entry.parameters.find((p) => p.testId === tid)?.testName || "Test";
          issues.push({ testName: tName, sum: issue.sum, diff: issue.diff });
        }
      }
      if (issues.length > 0) {
        setDiffConfirm({ entry, mode: "all", testId: "__all__", testName: "All Tests", issues });
        return;
      }
    }
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
          const autoFlag = calculateFlag(value, p.normalRangeLow, p.normalRangeHigh, p.rangeType, p.expectedValue, p.descriptiveOptions, p.normalRangeText, p.unit, p.normalFindings);
          const flag = resolveOutsourcedFlag({
            isOutsourced: p.isOutsourced,
            editedFlag: editedFlags[k],
            savedFlag: p.flag,
            autoFlag,
            currentValue: value,
            savedValue: p.resultValue,
          });
          const unit = resolveOutsourcedUnit({
            isOutsourced: p.isOutsourced,
            editedUnit: editedUnits[k],
            savedUnit: p.unit,
            masterUnit: p.unit,
          });
          const refRange = resolveOutsourcedRefRange({
            isOutsourced: p.isOutsourced,
            editedRef: editedRefRanges[k],
            savedRef: p.referenceRange,
            masterRef: p.referenceRange,
            rangeType: p.rangeType,
            normalRangeText: p.normalRangeText,
          });
          const noteVal = editedNotes[k] !== undefined ? editedNotes[k] : p.note;
          const testNoteVal = editedTestNotes[`${reg.id}||${testId}`] !== undefined ? editedTestNotes[`${reg.id}||${testId}`] : (loadedTestNotes[`${reg.id}||${testId}`] || "");
          upserts.push({ registration_id: reg.id, test_id: p.testId, parameter_id: p.parameterId, param_code: p.paramCode, parameter_name: p.parameterName, result_value: applyUnitSuffix(value, unit, p.rangeType) || null, unit, reference_range: refRange, normal_range_low: p.normalRangeLow, normal_range_high: p.normalRangeHigh, flag: flag || null, status: "approved", is_calculated: p.isCalculated, is_from_interface: p.isFromInterface, approved_at: new Date().toISOString(), entered_at: p.enteredAt || null, entered_by: p.enteredBy || null, verified_at: p.verifiedAt || null, verified_by: p.verifiedBy || null, approved_by: approver.pathologistName, note: noteVal || null, test_note: testNoteVal || null });
        }
        if (upserts.length > 0) {
          const paramIds = [...new Set(upserts.map((u) => u.parameter_id).filter(Boolean))];
          await supabase
            .from("patient_results")
            .delete()
            .eq("registration_id", reg.id)
            .eq("test_id", testId)
            .in("parameter_id", paramIds)
            .eq("status", "verified");
          await supabase.from("patient_results").insert(upserts as any);
        }
        await supabase.from("outsourced_test_snips").update({ outsource_status: "approved", approved_at: new Date().toISOString(), approved_by: approver.pathologistName } as any).eq("registration_id", reg.id).eq("test_id", testId).eq("outsource_status", "verified");

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
      const snipOnlyIds = new Set(entry.snipOnlyTests.map((s) => s.testId));
      for (const st of entry.snipOnlyTests) {
        await supabase.from("outsourced_test_snips").update({
          outsource_status: "approved",
          approved_at: new Date().toISOString(),
          approved_by: approver.pathologistName,
        } as any).eq("registration_id", reg.id).eq("test_id", st.testId).eq("outsource_status", "verified");
        allSnipUrls.push(...(st.snipUrls || []));
        allTestResults.push({
          test_id: st.testId, test_name: st.testName, is_outsourced: true,
          outsource_lab_name: st.labName,
          approved_by: approver.pathologistName,
          approved_by_qualification: approver.qualification,
          approved_by_designation: approver.designation,
          approved_by_signature_url: approver.signatureUrl,
        });
      }
      // Atomic DB merge — also removes prior snip-only markers for these tests.
      const { data: tubesForColAll } = await supabase.from("sample_tubes").select("collected_at").eq("registration_id", reg.id).not("collected_at", "is", null);
      const firstCollectedAtAll = tubesForColAll?.length ? (tubesForColAll.map((t: any) => t.collected_at).sort()[0] as string) : null;
      const approvalAtAll = new Date().toISOString();
      await mergeApprovedReportSnapshot({
        registrationId: reg.id,
        incoming: allTestResults,
        snipUrls: allSnipUrls,
        removeTestIds: [...snipOnlyIds],
        header: approvedReportHeaderFromReg(reg, {
          approvedBy: approver.pathologistName,
          approvalAt: approvalAtAll,
          sampleCollectionDate: firstCollectedAtAll,
        }),
      });
      // Status is recalculated authoritatively by propagateRegistrationChange below.
      // Do NOT write status='approved' directly: that bypasses the guard for accepted
      // tube tests that have no patient_results / no terminal outsourced snip and can
      // strand the registration in a state where only Dispatch can see it.

      await propagateRegistrationChange(qc, reg.id, ["doctor_approval", "dispatch"]);
      toast.success(`All tests approved for ${patientDisplayName(reg)}`);
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
        const autoFlag = calculateFlag(value, p.normalRangeLow, p.normalRangeHigh, p.rangeType, p.expectedValue, p.descriptiveOptions, p.normalRangeText, p.unit, p.normalFindings);
        const flag = resolveOutsourcedFlag({
          isOutsourced: p.isOutsourced,
          editedFlag: editedFlags[k],
          savedFlag: p.flag,
          autoFlag,
          currentValue: value,
          savedValue: p.resultValue,
        });
        const unit = resolveOutsourcedUnit({
          isOutsourced: p.isOutsourced,
          editedUnit: editedUnits[k],
          savedUnit: p.unit,
          masterUnit: p.unit,
        });
        const refRange = resolveOutsourcedRefRange({
          isOutsourced: p.isOutsourced,
          editedRef: editedRefRanges[k],
          savedRef: p.referenceRange,
          masterRef: p.referenceRange,
          rangeType: p.rangeType,
          normalRangeText: p.normalRangeText,
        });
        upserts.push({
          registration_id: regId, test_id: p.testId, parameter_id: p.parameterId,
          param_code: p.paramCode, parameter_name: p.parameterName,
          result_value: applyUnitSuffix(value, unit, p.rangeType) || null, unit, reference_range: refRange,
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
        const paramIds = [...new Set(upserts.map((u) => u.parameter_id).filter(Boolean))];
        await supabase
          .from("patient_results")
          .delete()
          .eq("registration_id", regId)
          .eq("test_id", testId)
          .in("parameter_id", paramIds)
          .in("status", ["verified", "entered"]);
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

      await propagateRegistrationChange(qc, regId, ["doctor_approval", "verification"]);
      toast.success(`${testName} sent back for verification`);
    } catch (err: any) { toast.error(err.message || "Failed"); }
    finally { setActionKey(null); }
  };

  // Request repeat collection — only the selected test (shared tubes are split)
  const requestRepeatCollection = async (regId: string, testId: string, testName: string) => {
    setActionKey(`${regId}||${testId}||repeat`);
    try {
      const { applyRepeatCollectionForTests } = await import("@/lib/repeatCollection");
      await applyRepeatCollectionForTests(regId, [{ test_id: testId, test_name: testName }]);
      toast.success(`Repeat sample collection requested for ${testName}`);
      invalidateAll();
      qc.invalidateQueries({ queryKey: ["sample_collection"] });
      qc.invalidateQueries({ queryKey: ["sample_tubes_collection"] });
    } catch (err: any) { toast.error(err.message || "Failed"); }
    finally { setActionKey(null); }
  };

  const renderHistoryCell = (parameterId: string, index: number) => {
    const hist = historyMap[parameterId]?.[index];
    if (!hist || !hist.resultValue) return <TableCell className="py-1.5 text-center text-xs text-muted-foreground">—</TableCell>;
    if (hist.snipImageUrls && hist.snipImageUrls.length > 0) {
      return (<TableCell className="py-1.5 text-xs"><div className="leading-tight"><Button size="sm" variant="ghost" className="h-5 px-1 text-xs text-blue-600 gap-0.5" onClick={() => setViewSnipImages(hist.snipImageUrls)}><Eye className="h-3 w-3" /> View Snip</Button><div className="text-muted-foreground text-[10px]">{hist.createdAt ? formatDateDDMMYYYY(hist.createdAt) : ""}</div></div></TableCell>);
    }
    return (<TableCell className="py-1.5 text-xs"><div className="leading-tight"><div className="font-bold">{isCanonicalTimeValue(hist.resultValue) ? formatTimeResult(hist.resultValue) : hist.resultValue}</div><div className="text-muted-foreground">{hist.referenceRange || "—"}</div><div className="text-muted-foreground text-[10px]">{hist.createdAt ? formatDateDDMMYYYY(hist.createdAt) : ""}</div></div></TableCell>);
  };

  const renderParamRow = (entry: PatientEntry, p: ParameterResult) => {
    const regId = entry.registration.id;
    const key = `${regId}||${p.parameterId}`;
    const currentValue = editedValues[key] !== undefined ? editedValues[key] : p.resultValue;
    const autoFlag = calculateFlag(currentValue, p.normalRangeLow, p.normalRangeHigh, p.rangeType, p.expectedValue, p.descriptiveOptions, p.normalRangeText, p.unit, p.normalFindings);
    const flag = resolveOutsourcedFlag({
      isOutsourced: p.isOutsourced,
      editedFlag: editedFlags[key],
      savedFlag: p.flag,
      autoFlag,
      currentValue,
      savedValue: p.resultValue,
    });
    const isNegative = isSuspectNegativeResult(currentValue);
    const rowBg = isNegative ? "bg-red-50" : ((flag === "H" || flag === "L" || flag === "A" || flag === "X") ? "bg-destructive/5" : "");
    const negCls = isNegative ? "border-red-500 ring-1 ring-red-300 text-red-700 font-semibold" : "";
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
          {p.isCalculated ? (<div className="flex items-center gap-1"><Input value={currentValue} onChange={(e) => handleValueChange(regId, p.parameterId, e.target.value, entry)} className={`h-7 text-sm w-[120px] font-mono ${negCls}`} placeholder="Auto" /><Button type="button" variant="ghost" size="icon" className="h-7 w-7" title="Recalculate" onClick={() => { if (!p.calculationFormula) return; const paramValues: Record<string, string> = {}; entry.parameters.forEach((ep) => { paramValues[ep.parameterId] = editedValues[`${regId}||${ep.parameterId}`] ?? ep.resultValue ?? ""; }); const result = evaluateFormula(p.calculationFormula, paramValues); if (result) handleValueChange(regId, p.parameterId, result, entry); }}><Calculator className="h-3 w-3 text-primary" /></Button></div>) :
           p.rangeType === "time" ? (
            <TimeResultInput value={currentValue} onChange={(v) => handleValueChange(regId, p.parameterId, v, entry)} abnormal={flag === "H" || flag === "L" || flag === "A" || flag === "X"} />
          ) :
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
          ) :
           p.rangeType === "undefined" && p.descriptiveOptions.length > 0 ? (
            <DescriptiveCombobox
              value={currentValue}
              options={p.descriptiveOptions}
              onChange={(v) => handleValueChange(regId, p.parameterId, v, entry)}
              className="!w-[180px]"
            />
          ) :
           p.rangeType === "undefined" ? (
            <Input value={currentValue} onChange={e => handleValueChange(regId, p.parameterId, e.target.value, entry)} className={`h-7 text-sm w-[180px] ${negCls}`} placeholder="Enter result" />
          ) : (<Input value={currentValue} onChange={e => handleValueChange(regId, p.parameterId, e.target.value, entry)} className={`h-7 text-sm w-[180px] ${isNegative ? "border-red-500 ring-1 ring-red-300 text-red-700 font-semibold" : (flag === "H" || flag === "L" || flag === "A" || flag === "X" ? "border-destructive text-destructive font-bold" : "")}`} placeholder="Enter result" />)}
        </TableCell>
        <TableCell className="py-1.5 text-xs text-muted-foreground">
          {p.isOutsourced && !p.isSnipMode ? (<Input value={editedUnits[key] !== undefined ? editedUnits[key] : (p.unit || "")} onChange={e => setEditedUnits(prev => ({ ...prev, [key]: e.target.value }))} className="h-6 text-xs w-[70px]" />) : p.unit}
        </TableCell>
        <TableCell className="py-1.5 text-xs text-muted-foreground">
          {p.isOutsourced && !p.isSnipMode ? (
            <Textarea
              value={editedRefRanges[key] !== undefined ? editedRefRanges[key] : (p.referenceRange || "")}
              onChange={e => setEditedRefRanges(prev => ({ ...prev, [key]: e.target.value }))}
              className="min-h-[4.5rem] text-xs w-[220px] max-w-[280px] whitespace-pre-wrap resize-y"
              placeholder="Normal / advisory range (paste as-is)"
            />
          ) : (
            <span className="whitespace-pre-wrap">{p.referenceRange}</span>
          )}
        </TableCell>
        <TableCell className="py-1.5 text-center">
          {p.isOutsourced && !p.isSnipMode ? (
            <Select value={flag || "none"} onValueChange={(v) => setEditedFlags(prev => ({ ...prev, [key]: v === "none" ? "" : v }))}><SelectTrigger className="h-6 text-xs w-[80px]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">—</SelectItem><SelectItem value="N">Normal</SelectItem><SelectItem value="H">HIGH</SelectItem><SelectItem value="L">LOW</SelectItem></SelectContent></Select>
          ) : (<>{flag === "H" && <Badge variant="destructive" className="text-xs">HIGH</Badge>}{flag === "L" && <Badge variant="destructive" className="text-xs">LOW</Badge>}{flag === "N" && <Badge variant="secondary" className="text-xs text-green-700">Normal</Badge>}{!flag && currentValue && p.rangeType !== "undefined" && <Badge variant="outline" className="text-xs">—</Badge>}</>)}
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
            <PatientTestPipelineHover registrationId={reg.id} invoiceNumber={reg.invoice_number} />
          {!["sample_accepted","entered","verified"].includes(reg.status) && Array.isArray(reg.accepted_samples) && reg.accepted_samples.length > 0 && (
            <Badge className="bg-amber-100 text-amber-700 text-[10px]">PARTIAL</Badge>
          )}
          {reg.is_stat && <span className="relative inline-flex h-2.5 w-2.5 ml-1.5 align-middle"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-destructive opacity-75" /><span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-destructive" /></span>}
          <span className="text-sm text-muted-foreground">{patientDisplayName(reg)}</span>
          <Badge variant="outline" className="text-[10px] font-mono">{formatAgeGender(reg.dob, reg.gender, reg.age_text)}</Badge>
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
                {st.snipUrls?.length ? (
                  <Button size="sm" variant="ghost" className="h-5 px-1 text-xs text-blue-600 gap-0.5" onClick={() => setViewSnipImages(st.snipUrls)}>
                    <Eye className="h-3 w-3" /> View Crop
                  </Button>
                ) : st.composedPdfUrl ? (
                  <Button size="sm" variant="ghost" className="h-5 px-1 text-xs text-blue-600 gap-0.5" onClick={() => window.open(st.composedPdfUrl!, "_blank")}>
                    <Eye className="h-3 w-3" /> View PDF
                  </Button>
                ) : null}
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
                    await supabase.from("outsourced_test_snips").update({ outsource_status: "approved", approved_at: new Date().toISOString(), approved_by: snipApproverChoice.pathologistName } as any).eq("registration_id", reg.id).eq("test_id", st.testId).eq("outsource_status", "verified");
                    // Promote any typed results for this test into approved + snapshot (params then crop).
                    const { data: liveTyped } = await supabase
                      .from("patient_results")
                      .select("test_id, parameter_id, param_code, parameter_name, result_value, unit, reference_range, normal_range_low, normal_range_high, flag, is_calculated, note, test_note, status")
                      .eq("registration_id", reg.id)
                      .eq("test_id", st.testId)
                      .in("status", ["verified", "entered", "results_entered", "approved"]);
                    const typedWithValues = (liveTyped || []).filter((r: any) => r.result_value && String(r.result_value).trim());
                    if (typedWithValues.length > 0) {
                      await supabase.from("patient_results").update({
                        status: "approved",
                        approved_at: new Date().toISOString(),
                        approved_by: snipApproverChoice.pathologistName,
                      } as any).eq("registration_id", reg.id).eq("test_id", st.testId).in("status", ["verified", "entered", "results_entered"]);
                    }
                    const { data: tubesForColSnip } = await supabase.from("sample_tubes").select("collected_at").eq("registration_id", reg.id).not("collected_at", "is", null);
                    const firstCollectedAtSnip = tubesForColSnip?.length ? (tubesForColSnip.map((t: any) => t.collected_at).sort()[0] as string) : null;
                    const approvalAtSnip = new Date().toISOString();
                    const incoming = typedWithValues.length > 0
                      ? typedWithValues.map((u: any) => ({
                          test_id: u.test_id,
                          test_name: st.testName,
                          parameter_id: u.parameter_id,
                          param_code: u.param_code,
                          parameter_name: u.parameter_name,
                          result_value: u.result_value,
                          unit: u.unit,
                          reference_range: u.reference_range,
                          normal_range_low: u.normal_range_low,
                          normal_range_high: u.normal_range_high,
                          flag: u.flag,
                          is_calculated: u.is_calculated,
                          is_outsourced: true,
                          outsource_lab_name: st.labName,
                          approved_by: snipApproverChoice.pathologistName,
                          approved_by_qualification: snipApproverChoice.qualification,
                          approved_by_designation: snipApproverChoice.designation,
                          approved_by_signature_url: snipApproverChoice.signatureUrl,
                          note: u.note || null,
                          test_note: u.test_note || null,
                        }))
                      : [{
                          test_id: st.testId,
                          test_name: st.testName,
                          is_outsourced: true,
                          outsource_lab_name: st.labName,
                          approved_by: snipApproverChoice.pathologistName,
                          approved_by_qualification: snipApproverChoice.qualification,
                          approved_by_designation: snipApproverChoice.designation,
                          approved_by_signature_url: snipApproverChoice.signatureUrl,
                        }];
                    await mergeApprovedReportSnapshot({
                      registrationId: reg.id,
                      removeTestIds: [st.testId],
                      snipUrls: st.snipUrls || [],
                      incoming,
                      header: approvedReportHeaderFromReg(reg, {
                        approvedBy: snipApproverChoice.pathologistName,
                        approvalAt: approvalAtSnip,
                        sampleCollectionDate: firstCollectedAtSnip,
                      }),
                    });
                    await propagateRegistrationChange(qc, reg.id, ["doctor_approval", "dispatch"]);
                    toast.success(`${st.testName} approved`);
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
              const isTestExpanded = expandedTestKey === testKey;
              const filledCount = tg.params.filter((p) => {
                const k = `${reg.id}||${p.parameterId}`;
                const v = editedValues[k] !== undefined ? editedValues[k] : p.resultValue;
                return v && v.trim() !== "";
              }).length;
              const expectedParamCount = tg.params.filter((p) => {
                if (!isCbcCriticalOnlyParamCode(p.paramCode)) return true;
                const k = `${reg.id}||${p.parameterId}`;
                const v = editedValues[k] !== undefined ? editedValues[k] : p.resultValue;
                return !!(v && v.trim());
              }).length;
              return (
                <div key={tg.testId} className="ml-1">
                  <div
                    className="flex items-center justify-between px-2 py-1.5 bg-muted/40 rounded cursor-pointer hover:bg-muted/60 transition-colors"
                    onClick={() => setExpandedTestKey((prev) => (prev === testKey ? null : testKey))}
                  >
                    <div className="flex items-center gap-2">
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
                      <Badge variant="outline" className="text-[10px]">{filledCount}/{expectedParamCount}</Badge>
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
                    <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
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
                  {isTestExpanded && (
                    <>
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
                      <TableHead className="py-1 text-xs w-[240px]">Ref. Range</TableHead><TableHead className="py-1 text-xs w-[70px] text-center">Flag</TableHead>
                      <TableHead className="py-1 text-xs w-[70px] text-center">Status</TableHead><TableHead className="py-1 text-xs w-[40px] text-center"></TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {(() => {
                        const getVal = (p: ParameterResult) => {
                          const k = `${reg.id}||${p.parameterId}`;
                          return editedValues[k] !== undefined ? editedValues[k] : p.resultValue;
                        };
                        const { mainParams, optionalVisible, optionalHidden } = partitionCbcCriticalParams(
                          tg.params,
                          getVal,
                        );
                        const optOpen = !!optionalCbcOpen[testKey];
                        return (
                          <>
                            {[...mainParams, ...optionalVisible].map((p) => renderParamRow(entry, p))}
                            <CbcOptionalParamsToggle
                              hiddenCount={optionalHidden.length}
                              open={optOpen}
                              colSpan={10}
                              onOpenChange={(open) =>
                                setOptionalCbcOpen((prev) => ({ ...prev, [testKey]: open }))
                              }
                            />
                            {optOpen && optionalHidden.map((p) => renderParamRow(entry, p))}
                          </>
                        );
                      })()}
                    </TableBody>
                  </Table>
                    </>
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
      <SyncingOverlay target="doctor_approval" visibleIds={regIds} />
      <div className="flex items-center gap-3 flex-wrap">
        <Tabs value={activeSection} onValueChange={v => setActiveSection(v as any)} className="w-auto">
          <TabsList className="h-9">
            <TabsTrigger value="approval" className="text-xs gap-1 h-7"><Stethoscope className="h-3.5 w-3.5" /> Doctor Approval</TabsTrigger>
            <TabsTrigger value="modified" className="text-xs gap-1 h-7"><FileCheck className="h-3.5 w-3.5" /> Modified Approval</TabsTrigger>
          </TabsList>
        </Tabs>
        <RefreshButton
          queryKeys={[
            "doctor_approval_count",
            "doctor_approval_regs",
            ...(expandedPatient
              ? ["doctor_approval_results", "doctor_approval_tubes", "doctor_approval_snips"]
              : []),
          ]}
          className="ml-auto"
        />
        <PageSizeSelect
          value={pageSize}
          onChange={(n) => { setPageSize(n); setDaPage(0); }}
        />
      </div>

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

      {listLoading ? (<Card><CardContent className="p-8 text-center text-muted-foreground">Loading…</CardContent></Card>) :
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
            const detailLoading = isExpanded && !detailReady;
            const canApprove = isExpanded && detailReady && (entry.parameters.length > 0 || entry.snipOnlyTests.length > 0);
            const isApproving = actionKey === `${reg.id}||all||approve`;
            return (
              <Card key={reg.id} className={isExpanded ? "ring-1 ring-primary/30" : ""}>
                <div className="flex items-center gap-3 p-3 cursor-pointer hover:bg-muted/30 transition-colors" onClick={() => { markArrivalSeen(reg.id); setExpandedPatient(isExpanded ? null : reg.id); if (isExpanded) setExpandedTestKey(null); }}>
                  {isExpanded ? <ChevronUp className="h-4 w-4 shrink-0" /> : <ChevronDown className="h-4 w-4 shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium font-mono">{reg.invoice_number}</span>
                      <PatientTestPipelineHover registrationId={reg.id} invoiceNumber={reg.invoice_number} />
                      <NewBadge show={isNewArrival(reg.id)} />
                      {!["sample_accepted","entered","verified"].includes(reg.status) && Array.isArray(reg.accepted_samples) && reg.accepted_samples.length > 0 && (
                        <Badge className="bg-amber-100 text-amber-700 text-[10px]">PARTIAL</Badge>
                      )}
                      {reg.is_stat && <span className="relative inline-flex h-2.5 w-2.5"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-destructive opacity-75" /><span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-destructive" /></span>}
                      <span className="text-sm text-muted-foreground">{patientDisplayName(reg)}</span>
                      <Badge variant="outline" className="text-[10px] font-mono">{formatAgeGender(reg.dob, reg.gender, reg.age_text)}</Badge>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {reg.mobile_number}
                      {isExpanded && detailReady ? ` • ${entry.parameters.length} parameters` : ""}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      size="sm"
                      variant="default"
                      className="h-7 text-xs"
                      disabled={isApproving || !canApprove}
                      title={!canApprove ? "Expand patient to load results first" : undefined}
                      onClick={(e) => { e.stopPropagation(); approveAllForPatient(entry); }}
                    >
                      {isApproving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <CheckCircle2 className="h-3.5 w-3.5 mr-1" />} Approve All
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
                if (mode === "all") approveAllForPatient(entry, true);
                else approveTest(entry, testId, testName, true);
              }
            }}>Continue Anyway</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default DoctorApproval;
