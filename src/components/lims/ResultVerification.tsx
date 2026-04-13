import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { recalculateRegistrationStatus } from "@/lib/limsStatus";
import { getCurrentUser } from "@/lib/auth";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Search, User, Monitor, Calculator, Wifi, ChevronDown, ChevronUp, Loader2, FlaskConical, CheckCircle2, SendHorizonal, Eye, Undo2, ClipboardCheck, StickyNote, Trash2 } from "lucide-react";
import { useMasterLookup } from "@/hooks/useMasterLookup";
import { toast } from "sonner";
import { formatDateDDMMYYYY } from "@/lib/utils";

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
  const [blankConfirmTestParams, setBlankConfirmTestParams] = useState<{ entry: PatientEntry; testId: string; testName: string } | null>(null);
  const [blankParamCount, setBlankParamCount] = useState(0);
  const [blankParamIds, setBlankParamIds] = useState<Set<string>>(new Set());
  const [highlightBlanksForRegs, setHighlightBlanksForRegs] = useState<Set<string>>(new Set());
  const [rvPage, setRvPage] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => { setDebouncedSearch(search); setRvPage(0); }, 400);
    return () => clearTimeout(t);
  }, [search]);

  const { data: rvCount = 0 } = useQuery({
    queryKey: ["verification_regs_count", debouncedSearch],
    queryFn: async () => {
      let query = supabase.from("patient_registrations").select("id", { count: "exact", head: true })
        .in("status", ["processing", "partial_processing", "processed", "partial_verified", "verified", "partially_approved", "approved", "partially_dispatched", "dispatched"])
        .eq("bill_cancelled", false);
      if (debouncedSearch) query = query.or(`patient_name.ilike.%${debouncedSearch}%,mobile_number.ilike.%${debouncedSearch}%,invoice_number.ilike.%${debouncedSearch}%,umr_number.ilike.%${debouncedSearch}%`);
      const { count } = await query;
      return count || 0;
    },
  });

  // Fetch registrations with entered results
  const { data: registrations = [], isLoading: loadingRegs } = useQuery({
    queryKey: ["verification_regs_v2", debouncedSearch, rvPage],
    queryFn: async () => {
      let query = supabase
        .from("patient_registrations")
        .select("id, invoice_number, patient_name, mobile_number, umr_number, status, is_stat, tests, cancelled_tests, visit_type, gender, dob, created_at, updated_at, bill_cancelled, doctor_name")
        .in("status", ["processing", "partial_processing", "processed", "partial_verified", "verified", "partially_approved", "approved", "partially_dispatched", "dispatched"])
        .eq("bill_cancelled", false)
        .order("is_stat", { ascending: false })
        .order("updated_at", { ascending: false })
        .range(rvPage * RV_PAGE_SIZE, rvPage * RV_PAGE_SIZE + RV_PAGE_SIZE - 1);
      if (debouncedSearch) {
        query = query.or(
          `patient_name.ilike.%${debouncedSearch}%,mobile_number.ilike.%${debouncedSearch}%,invoice_number.ilike.%${debouncedSearch}%,umr_number.ilike.%${debouncedSearch}%`
        );
      }
      const { data } = await query;
      return (data || []) as any[];
    },
  });

  const rvTotalPages = Math.ceil(rvCount / RV_PAGE_SIZE);

  const regIds = registrations.map((r: any) => r.id);

  // Fetch entered results
  const { data: existingResults = [] } = useQuery({
    queryKey: ["verification_results_v2", regIds.join(",")],
    enabled: regIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase
        .from("patient_results")
        .select("*")
        .in("registration_id", regIds)
        .eq("status", "entered");
      return (data || []) as any[];
    },
  });

  // Fetch outsourced snips with results_entered status
  const { data: outsourcedSnips = [] } = useQuery({
    queryKey: ["verification_outsourced_v2", regIds.join(",")],
    enabled: regIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase
        .from("outsourced_test_snips")
        .select("registration_id, test_id, outsourced_parameter_ids, outsource_status, outsourced_lab_name, sent_at, result_mode, snip_image_urls")
        .in("registration_id", regIds)
        .in("outsource_status", ["results_entered", "entered"]);
      return (data || []) as any[];
    },
  });

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
    if (!ranges || ranges.length === 0) return { text: "", low: null as number | null, high: null as number | null, rangeType: "numeric", descriptiveOptions: [] as string[], expectedValue: "" };
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
    if (!best) return { text: "", low: null as number | null, high: null as number | null, rangeType: "numeric", descriptiveOptions: [] as string[], expectedValue: "" };
    const text = best.normal_range_text || (best.normal_range_low != null && best.normal_range_high != null ? `${best.normal_range_low} - ${best.normal_range_high}` : "");
    return { text, low: best.normal_range_low as number | null, high: best.normal_range_high as number | null, rangeType: best.range_type || "numeric", descriptiveOptions: Array.isArray(best.descriptive_options) ? best.descriptive_options : [], expectedValue: best.expected_value || "" };
  }, [normalRangesMap]);

  // Build patient entries
  const patientEntries: PatientEntry[] = useMemo(() => {
    return registrations.map((reg: any) => {
      const tests = (reg.tests || []) as any[];
      const cancelledIds = new Set(((reg.cancelled_tests || []) as any[]).map((t: any) => t.test_id));
      const activeTests = tests.filter((t: any) => !cancelledIds.has(t.test_id));
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
          const savedRefRange = isParamOutsourced && existing?.reference_range ? existing.reference_range : refText;
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
            rangeType: resolved.rangeType, descriptiveOptions: resolved.descriptiveOptions, expectedValue: resolved.expectedValue,
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
  }, [registrations, testsMap, testParamsMap, existingResults, resolveNormalRange, transferredTestKeys, outsourcedParamSets, outsourcedSnipDetails]);

  // Calculate flag
  const calculateFlag = (value: string, low: number | null, high: number | null, rangeType?: string, expectedValue?: string): string => {
    if (!value || value.trim() === "") return "";
    if (rangeType === "qualitative") {
      if (!expectedValue) return "";
      return value.trim().toLowerCase() === expectedValue.trim().toLowerCase() ? "N" : "A";
    }
    if (rangeType === "descriptive") return "";
    const num = parseFloat(value);
    if (isNaN(num)) return "";
    if (low != null && num < low) return "L";
    if (high != null && num > high) return "H";
    return "N";
  };

  // Evaluate formula
  const evaluateFormula = (formula: any[], paramValues: Record<string, string>): string => {
    if (!formula || formula.length === 0) return "";
    try {
      let expr = "";
      for (const token of formula) {
        if (token.type === "parameter") {
          const val = paramValues[token.parameter_id];
          if (!val || isNaN(parseFloat(val))) return "";
          expr += parseFloat(val);
        } else if (token.type === "fixed_value") { expr += token.fixed_value; }
        else if (token.type === "bracket_open") { expr += "("; }
        else if (token.type === "bracket_close") { expr += ")"; }
        if (token.operator && token.type !== "bracket_close") {
          const op = token.operator;
          if (["+", "-", "*", "/"].includes(op)) expr += ` ${op} `;
        }
      }
      expr = expr.replace(/\s+/g, " ").trim();
      if (expr.endsWith("+") || expr.endsWith("-") || expr.endsWith("*") || expr.endsWith("/")) expr = expr.slice(0, -1).trim();
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
      verifyAllForPatient(entry);
    }
  };

  // Verify test (update status to verified)
  const [verifyingKey, setVerifyingKey] = useState<string | null>(null);

  const verifyTest = async (entry: PatientEntry, testId: string, testName: string) => {
    const reg = entry.registration;
    const key = `${reg.id}||${testId}`;
    setVerifyingKey(key);
    try {
      const testParams = entry.parameters.filter(p => p.testId === testId);
      // Save any edited values first
      const upserts: any[] = [];
      for (const p of testParams) {
        const k = `${reg.id}||${p.parameterId}`;
        const value = editedValues[k] !== undefined ? editedValues[k] : p.resultValue;
        const autoFlag = calculateFlag(value, p.normalRangeLow, p.normalRangeHigh, p.rangeType, p.expectedValue);
        const flag = p.isOutsourced && editedFlags[k] !== undefined ? editedFlags[k] : autoFlag;
        const unit = p.isOutsourced && editedUnits[k] !== undefined ? editedUnits[k] : p.unit;
        const refRange = p.isOutsourced && editedRefRanges[k] !== undefined ? editedRefRanges[k] : p.referenceRange;
        upserts.push({
          registration_id: reg.id, test_id: p.testId, parameter_id: p.parameterId,
          param_code: p.paramCode, parameter_name: p.parameterName,
          result_value: value || null, unit, reference_range: refRange,
          normal_range_low: p.normalRangeLow, normal_range_high: p.normalRangeHigh,
           flag: flag || null, status: "verified", is_calculated: p.isCalculated, is_from_interface: p.isFromInterface, verified_at: new Date().toISOString(), entered_at: p.enteredAt || new Date().toISOString(), entered_by: p.enteredBy || null, verified_by: getCurrentUser()?.display_name || null, note: editedNotes[k] !== undefined ? (editedNotes[k] || null) : (p.note || null),
        });
      }
      if (upserts.length > 0) {
        await supabase.from("patient_results").delete().eq("registration_id", reg.id).eq("test_id", testId).eq("status", "entered");
        await supabase.from("patient_results").insert(upserts as any);
      }
      // Also verify outsourced snips (works for both param-based and snip-only)
      await supabase.from("outsourced_test_snips").update({ outsource_status: "verified" } as any).eq("registration_id", reg.id).eq("test_id", testId).in("outsource_status", ["results_entered", "entered", "sent", "results_saved"]);
      
      toast.success(`${testName} verified & sent to Doctor Approval`);
      recalculateRegistrationStatus(reg.id).catch(console.error);
      setEditedValues(prev => {
        const next = { ...prev };
        testParams.forEach(p => { delete next[`${reg.id}||${p.parameterId}`]; });
        return next;
      });
      qc.invalidateQueries({ queryKey: ["verification_results_v2"] });
      qc.invalidateQueries({ queryKey: ["verification_outsourced_v2"] });
      qc.invalidateQueries({ queryKey: ["doctor_approval"] });
      qc.invalidateQueries({ queryKey: ["patient_results_existing"] });
    } catch (err: any) {
      toast.error(err.message || "Verification failed");
    } finally {
      setVerifyingKey(null);
    }
  };

  // Verify all tests for patient
  const verifyAllForPatient = async (entry: PatientEntry) => {
    const reg = entry.registration;
    setVerifyingKey(reg.id);
    try {
      const testIds = [...new Set(entry.parameters.map(p => p.testId))];
      for (const testId of testIds) {
        const testParams = entry.parameters.filter(p => p.testId === testId);
        const upserts: any[] = [];
        for (const p of testParams) {
          const k = `${reg.id}||${p.parameterId}`;
          const value = editedValues[k] !== undefined ? editedValues[k] : p.resultValue;
          const autoFlag = calculateFlag(value, p.normalRangeLow, p.normalRangeHigh, p.rangeType, p.expectedValue);
          const flag = p.isOutsourced && editedFlags[k] !== undefined ? editedFlags[k] : autoFlag;
          const unit = p.isOutsourced && editedUnits[k] !== undefined ? editedUnits[k] : p.unit;
          const refRange = p.isOutsourced && editedRefRanges[k] !== undefined ? editedRefRanges[k] : p.referenceRange;
          upserts.push({
            registration_id: reg.id, test_id: p.testId, parameter_id: p.parameterId,
            param_code: p.paramCode, parameter_name: p.parameterName,
            result_value: value || null, unit, reference_range: refRange,
            normal_range_low: p.normalRangeLow, normal_range_high: p.normalRangeHigh,
            flag: flag || null, status: "verified", is_calculated: p.isCalculated, is_from_interface: p.isFromInterface, verified_at: new Date().toISOString(), entered_at: p.enteredAt || new Date().toISOString(), entered_by: p.enteredBy || null, verified_by: getCurrentUser()?.display_name || null, note: editedNotes[k] !== undefined ? (editedNotes[k] || null) : (p.note || null),
          });
        }
        if (upserts.length > 0) {
          await supabase.from("patient_results").delete().eq("registration_id", reg.id).eq("test_id", testId).eq("status", "entered");
          await supabase.from("patient_results").insert(upserts as any);
        }
        await supabase.from("outsourced_test_snips").update({ outsource_status: "verified" } as any).eq("registration_id", reg.id).eq("test_id", testId).in("outsource_status", ["results_entered", "sent", "results_saved"]);
      }
      toast.success(`All tests verified for ${reg.patient_name}`);
      recalculateRegistrationStatus(reg.id).catch(console.error);
      qc.invalidateQueries({ queryKey: ["verification_results_v2"] });
      qc.invalidateQueries({ queryKey: ["verification_outsourced_v2"] });
      qc.invalidateQueries({ queryKey: ["doctor_approval"] });
      qc.invalidateQueries({ queryKey: ["patient_results_existing"] });
    } catch (err: any) {
      toast.error(err.message || "Verification failed");
    } finally {
      setVerifyingKey(null);
    }
  };

  // Send back to Results Entry
  const sendBackTest = async (regId: string, testId: string, testName: string) => {
    try {
      await supabase.from("patient_results").update({ status: "pending" } as any).eq("registration_id", regId).eq("test_id", testId).eq("status", "entered");
      await supabase.from("outsourced_test_snips").update({ outsource_status: "results_saved" } as any).eq("registration_id", regId).eq("test_id", testId).in("outsource_status", ["results_entered", "entered"]);
      toast.success(`${testName} sent back to Results Entry`);
      qc.invalidateQueries({ queryKey: ["verification_results_v2"] });
      qc.invalidateQueries({ queryKey: ["verification_outsourced_v2"] });
      qc.invalidateQueries({ queryKey: ["patient_results_existing"] });
      qc.invalidateQueries({ queryKey: ["outsourced_manual_results"] });
      qc.invalidateQueries({ queryKey: ["outsourced_snips"] });
      qc.invalidateQueries({ queryKey: ["results_outsourced_snips"] });
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
    const autoFlag = calculateFlag(currentValue, p.normalRangeLow, p.normalRangeHigh, p.rangeType, p.expectedValue);
    const flag = p.isOutsourced && editedFlags[key] !== undefined ? editedFlags[key] : autoFlag;
    const rowBg = (flag === "H" || flag === "L" || flag === "A") ? "bg-destructive/5" : "";

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
            <Input value={currentValue} readOnly className="h-7 text-sm bg-muted/50 w-[120px] font-mono" placeholder="Auto" />
          ) : p.rangeType === "qualitative" && getQualitativeOptions(p.expectedValue).length > 0 ? (
            <Select value={currentValue || undefined} onValueChange={(v) => handleValueChange(regId, p.parameterId, v, entry)}>
              <SelectTrigger className="h-7 text-sm !w-[180px] min-w-[180px] max-w-[180px]"><SelectValue placeholder="Select..." /></SelectTrigger>
              <SelectContent>{getQualitativeOptions(p.expectedValue).map((opt: string) => (<SelectItem key={opt} value={opt}>{opt}</SelectItem>))}</SelectContent>
            </Select>
          ) : p.rangeType === "descriptive" && p.descriptiveOptions.length > 0 ? (
            <Select value={currentValue || undefined} onValueChange={(v) => handleValueChange(regId, p.parameterId, v, entry)}>
              <SelectTrigger className="h-7 text-sm !w-[180px] min-w-[180px] max-w-[180px]"><SelectValue placeholder="Select..." /></SelectTrigger>
              <SelectContent className="max-w-[400px]">
                {p.descriptiveOptions.map((opt: string) => (<SelectItem key={opt} value={opt} className="whitespace-normal">{opt}</SelectItem>))}
              </SelectContent>
            </Select>
          ) : (
            <Input
              value={currentValue}
              onChange={e => handleValueChange(regId, p.parameterId, e.target.value, entry)}
              className={`h-7 text-sm w-[180px] ${flag === "H" || flag === "L" || flag === "A" ? "border-destructive text-destructive font-bold" : ""}`}
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
                <SelectItem value="A">Abnormal</SelectItem>
              </SelectContent>
            </Select>
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
            <span className="font-semibold">{reg.patient_name}</span>
            {reg.status !== "sample_accepted" && reg.status !== "entered" && Array.isArray(reg.accepted_samples) && reg.accepted_samples.length > 0 && (
              <Badge className="bg-amber-100 text-amber-700 text-[10px] ml-1">PARTIAL</Badge>
            )}
            {reg.is_stat && (
              <span className="relative inline-flex h-2.5 w-2.5 ml-1.5 align-middle">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-destructive opacity-75" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-destructive" />
              </span>
            )}
            <span className="text-sm text-muted-foreground ml-2">{reg.invoice_number}</span>
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
                    <span className="text-xs font-medium text-muted-foreground">{tg.testName}</span>
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

      {loadingRegs ? (
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
                <div className="flex items-center gap-3 p-3 cursor-pointer hover:bg-muted/30 transition-colors" onClick={() => setExpandedPatient(isExpanded ? null : reg.id)}>
                  {isExpanded ? <ChevronUp className="h-4 w-4 shrink-0" /> : <ChevronDown className="h-4 w-4 shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{reg.patient_name}</span>
                      {reg.status !== "sample_accepted" && reg.status !== "entered" && Array.isArray(reg.accepted_samples) && reg.accepted_samples.length > 0 && (
                        <Badge className="bg-amber-100 text-amber-700 text-[10px]">PARTIAL</Badge>
                      )}
                      {reg.is_stat && (
                        <span className="relative inline-flex h-2.5 w-2.5">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-destructive opacity-75" />
                          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-destructive" />
                        </span>
                      )}
                      <span className="text-sm text-muted-foreground font-mono">{reg.invoice_number}</span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {reg.mobile_number} • {entry.parameters.length} parameters to verify
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
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
                      const flag = calculateFlag(currentValue, p.normalRangeLow, p.normalRangeHigh, p.rangeType, p.expectedValue);
                      return (
                        <TableRow key={key} className="bg-yellow-50">
                          <TableCell className="py-2 text-xs font-mono text-muted-foreground">{p.paramCode}</TableCell>
                          <TableCell className="py-2 text-sm font-medium">{p.parameterName}</TableCell>
                          <TableCell className="py-2">
                            {p.rangeType === "qualitative" && getQualitativeOptions(p.expectedValue).length > 0 ? (
                              <Select value={currentValue || undefined} onValueChange={(v) => handleValueChange(reg.id, p.parameterId, v, entry)}>
                                <SelectTrigger className="h-7 text-sm w-full"><SelectValue placeholder="Select..." /></SelectTrigger>
                                <SelectContent>{getQualitativeOptions(p.expectedValue).map((opt: string) => (<SelectItem key={opt} value={opt}>{opt}</SelectItem>))}</SelectContent>
                              </Select>
                            ) : p.rangeType === "descriptive" && p.descriptiveOptions.length > 0 ? (
                              <Select value={currentValue || undefined} onValueChange={(v) => handleValueChange(reg.id, p.parameterId, v, entry)}>
                                <SelectTrigger className="h-7 text-sm w-full"><SelectValue placeholder="Select..." /></SelectTrigger>
                                <SelectContent className="max-w-[400px]">
                                  {p.descriptiveOptions.map((opt: string) => (
                                    <SelectItem key={opt} value={opt} className="whitespace-normal">{opt}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
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
                            {flag === "A" && <Badge variant="destructive" className="text-xs">Abnormal</Badge>}
                            {!flag && <Badge variant="outline" className="text-xs">—</Badge>}
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
                const { entry, testId } = blankConfirmTestParams;
                setBlankConfirmTestParams(null);
                setHighlightBlanksForRegs(prev => { const next = new Set(prev); next.delete(`${entry.registration.id}||${testId}`); return next; });
                if (testId === "__all__") {
                  verifyAllForPatient(entry);
                } else {
                  verifyTest(entry, testId, blankConfirmTestParams.testName);
                }
              }
            }}>
              <SendHorizonal className="h-4 w-4 mr-1" />
              Send to Doctor Approval
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
