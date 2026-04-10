import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { recalculateRegistrationStatus } from "@/lib/limsStatus";
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
import { Search, User, Monitor, Calculator, ChevronDown, ChevronUp, Loader2, CheckCircle2, Undo2, RotateCcw, Eye, Stethoscope, FileCheck } from "lucide-react";
import { useMasterLookup } from "@/hooks/useMasterLookup";
import { toast } from "sonner";
import { formatDateDDMMYYYY } from "@/lib/utils";
import ModifiedApproval from "./ModifiedApproval";
interface ParameterResult {
  parameterId: string; paramCode: string; parameterName: string; unit: string; referenceRange: string;
  normalRangeLow: number | null; normalRangeHigh: number | null; resultValue: string; flag: string;
  isCalculated: boolean; calculationFormula: any[]; isFromInterface: boolean; sendForInterface: boolean;
  status: string; testId: string; testName: string; departmentId: string; machineName: string;
  displayOrder: number; rangeType: string; descriptiveOptions: string[]; expectedValue: string;
  isOutsourced: boolean; outsourceLabName: string | null; outsourceStatus: string; isSnipMode: boolean;
}

interface SnipOnlyTest {
  testId: string;
  testName: string;
  labName: string | null;
  snipUrls: string[];
  outsourceStatus: string;
}

interface PatientEntry { registration: any; parameters: ParameterResult[]; snipOnlyTests: SnipOnlyTest[]; }

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

  useEffect(() => { const t = setTimeout(() => setDebouncedSearch(search), 400); return () => clearTimeout(t); }, [search]);

  const { data: registrations = [], isLoading: loadingRegs } = useQuery({
    queryKey: ["doctor_approval_regs", debouncedSearch],
    queryFn: async () => {
      let query = supabase.from("patient_registrations").select("*")
        .in("status", ["partial_verified", "verified", "partially_approved"])
        .eq("bill_cancelled", false).order("is_stat", { ascending: false }).order("updated_at", { ascending: false });
      if (debouncedSearch) query = query.or(`patient_name.ilike.%${debouncedSearch}%,mobile_number.ilike.%${debouncedSearch}%,invoice_number.ilike.%${debouncedSearch}%,umr_number.ilike.%${debouncedSearch}%`);
      const { data } = await query;
      return (data || []) as any[];
    },
  });

  const regIds = registrations.map((r: any) => r.id);

  const { data: existingResults = [] } = useQuery({
    queryKey: ["doctor_approval_results", regIds.join(",")],
    enabled: regIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase.from("patient_results").select("*").in("registration_id", regIds).eq("status", "verified");
      return (data || []) as any[];
    },
  });

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
          });
        }
      }
      return { registration: reg, parameters, snipOnlyTests };
    }).filter(e => e.parameters.length > 0 || e.snipOnlyTests.length > 0);
  }, [registrations, testsMap, testParamsMap, existingResults, resolveNormalRange, transferredTestKeys, outsourcedParamSets, outsourcedSnipDetails]);

  const calculateFlag = (value: string, low: number | null, high: number | null, rangeType?: string, expectedValue?: string): string => {
    if (!value || !value.trim()) return "";
    if (rangeType === "qualitative") { if (!expectedValue) return ""; return value.trim().toLowerCase() === expectedValue.trim().toLowerCase() ? "N" : "A"; }
    if (rangeType === "descriptive") return "";
    const num = parseFloat(value); if (isNaN(num)) return "";
    if (low != null && num < low) return "L"; if (high != null && num > high) return "H"; return "N";
  };

  const evaluateFormula = (formula: any[], paramValues: Record<string, string>): string => {
    if (!formula || formula.length === 0) return "";
    try { let expr = ""; for (const token of formula) { if (token.type === "parameter") { const val = paramValues[token.parameter_id]; if (!val || isNaN(parseFloat(val))) return ""; expr += parseFloat(val); } else if (token.type === "fixed_value") expr += token.fixed_value; else if (token.type === "bracket_open") expr += "("; else if (token.type === "bracket_close") expr += ")"; if (token.operator && token.type !== "bracket_close") { const op = token.operator; if (["+", "-", "*", "/"].includes(op)) expr += ` ${op} `; } } expr = expr.replace(/\s+/g, " ").trim(); if (expr.endsWith("+") || expr.endsWith("-") || expr.endsWith("*") || expr.endsWith("/")) expr = expr.slice(0, -1).trim(); const result = new Function(`return (${expr})`); const res = result(); if (typeof res === "number" && isFinite(res)) return parseFloat(res.toFixed(2)).toString(); return ""; } catch { return ""; }
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
    qc.invalidateQueries({ queryKey: ["patient_results_existing"] });
    qc.invalidateQueries({ queryKey: ["dispatch_regs"] });
    qc.invalidateQueries({ queryKey: ["dispatch_results"] });
    qc.invalidateQueries({ queryKey: ["dispatch_snips"] });
  };

  // Approve test
  const approveTest = async (entry: PatientEntry, testId: string, testName: string) => {
    const reg = entry.registration;
    setActionKey(`${reg.id}||${testId}||approve`);
    try {
      const testParams = entry.parameters.filter(p => p.testId === testId);
      const upserts: any[] = [];
      for (const p of testParams) {
        const k = `${reg.id}||${p.parameterId}`;
        const value = editedValues[k] !== undefined ? editedValues[k] : p.resultValue;
        const autoFlag = calculateFlag(value, p.normalRangeLow, p.normalRangeHigh, p.rangeType, p.expectedValue);
        const flag = p.isOutsourced && editedFlags[k] !== undefined ? editedFlags[k] : autoFlag;
        const unit = p.isOutsourced && editedUnits[k] !== undefined ? editedUnits[k] : p.unit;
        const refRange = p.isOutsourced && editedRefRanges[k] !== undefined ? editedRefRanges[k] : p.referenceRange;
        upserts.push({ registration_id: reg.id, test_id: p.testId, parameter_id: p.parameterId, param_code: p.paramCode, parameter_name: p.parameterName, result_value: value || null, unit, reference_range: refRange, normal_range_low: p.normalRangeLow, normal_range_high: p.normalRangeHigh, flag: flag || null, status: "approved", is_calculated: p.isCalculated, is_from_interface: p.isFromInterface });
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
      }));
      // Fetch existing approved_reports to merge
      const { data: existingReport } = await supabase.from("approved_reports").select("test_results, outsourced_snip_urls").eq("registration_id", reg.id).maybeSingle();
      const existingResults = Array.isArray((existingReport as any)?.test_results) ? (existingReport as any).test_results : [];
      const existingSnipUrls = Array.isArray((existingReport as any)?.outsourced_snip_urls) ? (existingReport as any).outsourced_snip_urls : [];
      // Remove old entries for this test, then add new ones
      const mergedResults = existingResults.filter((r: any) => r.test_id !== testId).concat(testResultsSnapshot);
      const mergedSnipUrls = [...new Set([...existingSnipUrls.filter((u: string) => !u.includes(testId)), ...snipUrls])];
      await supabase.from("approved_reports").upsert({
        registration_id: reg.id, invoice_number: reg.invoice_number, umr_number: reg.umr_number,
        patient_name: reg.patient_name, title: reg.title, gender: reg.gender, dob: reg.dob,
        mobile_number: reg.mobile_number, email: reg.email, address: reg.address,
        doctor_name: reg.doctor_name, visit_type: reg.visit_type, is_stat: reg.is_stat,
        report_language: reg.report_language, approved_by: "Doctor",
        registration_date: reg.created_at, approval_date: new Date().toISOString(),
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
          const autoFlag = calculateFlag(value, p.normalRangeLow, p.normalRangeHigh, p.rangeType, p.expectedValue);
          const flag = p.isOutsourced && editedFlags[k] !== undefined ? editedFlags[k] : autoFlag;
          upserts.push({ registration_id: reg.id, test_id: p.testId, parameter_id: p.parameterId, param_code: p.paramCode, parameter_name: p.parameterName, result_value: value || null, unit: p.unit, reference_range: p.referenceRange, normal_range_low: p.normalRangeLow, normal_range_high: p.normalRangeHigh, flag: flag || null, status: "approved", is_calculated: p.isCalculated, is_from_interface: p.isFromInterface });
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
        }));
      }
      // Archive combined snapshot
      await supabase.from("approved_reports").upsert({
        registration_id: reg.id, invoice_number: reg.invoice_number, umr_number: reg.umr_number,
        patient_name: reg.patient_name, title: reg.title, gender: reg.gender, dob: reg.dob,
        mobile_number: reg.mobile_number, email: reg.email, address: reg.address,
        doctor_name: reg.doctor_name, visit_type: reg.visit_type, is_stat: reg.is_stat,
        report_language: reg.report_language, approved_by: "Doctor",
        registration_date: reg.created_at, approval_date: new Date().toISOString(),
        test_results: allTestResults, outsourced_snip_urls: allSnipUrls,
      } as any, { onConflict: "registration_id" as any, ignoreDuplicates: false });
      // Update registration status to approved since all tests were just approved
      await supabase.from("patient_registrations").update({ status: "approved" } as any).eq("id", reg.id);

      toast.success(`All tests approved for ${reg.patient_name}`);
      recalculateRegistrationStatus(reg.id).catch(console.error);
      invalidateAll();
    } catch (err: any) { toast.error(err.message || "Approval failed"); }
    finally { setActionKey(null); }
  };

  // Send back for verification
  const sendBackForVerification = async (regId: string, testId: string, testName: string) => {
    setActionKey(`${regId}||${testId}||back`);
    try {
      await supabase.from("patient_results").update({ status: "entered" } as any).eq("registration_id", regId).eq("test_id", testId).eq("status", "verified");
      await supabase.from("outsourced_test_snips").update({ outsource_status: "results_entered" } as any).eq("registration_id", regId).eq("test_id", testId).eq("outsource_status", "verified");
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
    const autoFlag = calculateFlag(currentValue, p.normalRangeLow, p.normalRangeHigh, p.rangeType, p.expectedValue);
    const flag = p.isOutsourced && editedFlags[key] !== undefined ? editedFlags[key] : autoFlag;
    const rowBg = (flag === "H" || flag === "L" || flag === "A") ? "bg-destructive/5" : "";
    return (
      <TableRow key={key} className={rowBg}>
        <TableCell className="py-1.5 text-xs font-mono text-muted-foreground">{p.paramCode}</TableCell>
        <TableCell className="py-1.5 text-sm font-medium">{p.parameterName}{p.isCalculated && <Calculator className="inline h-3 w-3 ml-1 text-primary" />}</TableCell>
        {renderHistoryCell(p.parameterId, 0)}{renderHistoryCell(p.parameterId, 1)}
        <TableCell className="py-1.5 w-[180px]">
          {p.isCalculated ? (<Input value={currentValue} readOnly className="h-7 text-sm bg-muted/50 w-[120px] font-mono" />) :
           p.rangeType === "descriptive" && p.descriptiveOptions.length > 0 ? (
            <Select value={currentValue || undefined} onValueChange={(v) => handleValueChange(regId, p.parameterId, v, entry)}>
              <SelectTrigger className="h-7 text-sm !w-[180px]"><SelectValue placeholder="Select..." /></SelectTrigger>
              <SelectContent className="max-w-[400px]">{p.descriptiveOptions.map((opt: string) => (<SelectItem key={opt} value={opt} className="whitespace-normal">{opt}</SelectItem>))}</SelectContent>
            </Select>
          ) : (<Input value={currentValue} onChange={e => handleValueChange(regId, p.parameterId, e.target.value, entry)} className={`h-7 text-sm w-[180px] ${flag === "H" || flag === "L" || flag === "A" ? "border-destructive text-destructive font-bold" : ""}`} placeholder="Enter result" />)}
        </TableCell>
        <TableCell className="py-1.5 text-xs text-muted-foreground">
          {p.isOutsourced && !p.isSnipMode ? (<Input value={editedUnits[key] !== undefined ? editedUnits[key] : (p.unit || "")} onChange={e => setEditedUnits(prev => ({ ...prev, [key]: e.target.value }))} className="h-6 text-xs w-[70px]" />) : p.unit}
        </TableCell>
        <TableCell className="py-1.5 text-xs text-muted-foreground">
          {p.isOutsourced && !p.isSnipMode ? (<Input value={editedRefRanges[key] !== undefined ? editedRefRanges[key] : (p.referenceRange || "")} onChange={e => setEditedRefRanges(prev => ({ ...prev, [key]: e.target.value }))} className="h-6 text-xs w-[100px]" />) : p.referenceRange}
        </TableCell>
        <TableCell className="py-1.5 text-center">
          {p.isOutsourced && !p.isSnipMode ? (
            <Select value={flag || "none"} onValueChange={(v) => setEditedFlags(prev => ({ ...prev, [key]: v === "none" ? "" : v }))}><SelectTrigger className="h-6 text-xs w-[80px]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">—</SelectItem><SelectItem value="N">Normal</SelectItem><SelectItem value="H">HIGH</SelectItem><SelectItem value="L">LOW</SelectItem><SelectItem value="A">Abnormal</SelectItem></SelectContent></Select>
          ) : (<>{flag === "H" && <Badge variant="destructive" className="text-xs">HIGH</Badge>}{flag === "L" && <Badge variant="destructive" className="text-xs">LOW</Badge>}{flag === "A" && <Badge variant="destructive" className="text-xs">Abnormal</Badge>}{flag === "N" && <Badge variant="secondary" className="text-xs text-green-700">Normal</Badge>}{!flag && currentValue && <Badge variant="outline" className="text-xs">—</Badge>}</>)}
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
          <span className="font-semibold">{reg.patient_name}</span>
          {!["sample_accepted","entered","verified"].includes(reg.status) && Array.isArray(reg.accepted_samples) && reg.accepted_samples.length > 0 && (
            <Badge className="bg-amber-100 text-amber-700 text-[10px]">PARTIAL</Badge>
          )}
          {reg.is_stat && <span className="relative inline-flex h-2.5 w-2.5 ml-1.5 align-middle"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-destructive opacity-75" /><span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-destructive" /></span>}
          <span className="text-sm text-muted-foreground">{reg.invoice_number}</span>
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
                  setActionKey(`${testKey}||approve`);
                  try {
                    await supabase.from("outsourced_test_snips").update({ outsource_status: "approved" } as any).eq("registration_id", reg.id).eq("test_id", st.testId).eq("outsource_status", "verified");
                    // Merge with existing approved_reports data
                    const { data: existSnipReport } = await supabase.from("approved_reports").select("test_results, outsourced_snip_urls").eq("registration_id", reg.id).maybeSingle();
                    const prevResults = Array.isArray((existSnipReport as any)?.test_results) ? (existSnipReport as any).test_results : [];
                    const prevSnipUrls = Array.isArray((existSnipReport as any)?.outsourced_snip_urls) ? (existSnipReport as any).outsourced_snip_urls : [];
                    const newResults = prevResults.filter((r: any) => r.test_id !== st.testId).concat([{ test_id: st.testId, test_name: st.testName, is_outsourced: true, outsource_lab_name: st.labName }]);
                    const newSnipUrls = [...new Set([...prevSnipUrls.filter((u: string) => !u.includes(st.testId)), ...st.snipUrls])];
                    await supabase.from("approved_reports").upsert({ registration_id: reg.id, invoice_number: reg.invoice_number, umr_number: reg.umr_number, patient_name: reg.patient_name, title: reg.title, gender: reg.gender, dob: reg.dob, mobile_number: reg.mobile_number, email: reg.email, address: reg.address, doctor_name: reg.doctor_name, visit_type: reg.visit_type, is_stat: reg.is_stat, report_language: reg.report_language, approved_by: "Doctor", registration_date: reg.created_at, approval_date: new Date().toISOString(), test_results: newResults, outsourced_snip_urls: newSnipUrls } as any, { onConflict: "registration_id" as any, ignoreDuplicates: false });
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
                    <span className="text-xs font-medium text-muted-foreground">{tg.testName}</span>
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
                      <span className="font-medium">{reg.patient_name}</span>
                      {!["sample_accepted","entered","verified"].includes(reg.status) && Array.isArray(reg.accepted_samples) && reg.accepted_samples.length > 0 && (
                        <Badge className="bg-amber-100 text-amber-700 text-[10px]">PARTIAL</Badge>
                      )}
                      {reg.is_stat && <span className="relative inline-flex h-2.5 w-2.5"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-destructive opacity-75" /><span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-destructive" /></span>}
                      <span className="text-sm text-muted-foreground font-mono">{reg.invoice_number}</span>
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
      </>
      )}
    </div>
  );
};

export default DoctorApproval;
