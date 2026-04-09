import { useState, useCallback, useEffect, useMemo, useRef } from "react";
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
import { Search, User, Monitor, Save, Calculator, Wifi, WifiOff, ChevronDown, ChevronUp, Check, Loader2, FlaskConical, Package, SendHorizonal, ArrowRightLeft } from "lucide-react";
import { useMasterLookup } from "@/hooks/useMasterLookup";
import OutsourcedResults from "./OutsourcedResults";
import { format } from "date-fns";
import { toast } from "sonner";

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
}

interface PatientEntry {
  registration: any;
  parameters: ParameterResult[];
}

const ResultsEntry = () => {
  const qc = useQueryClient();
  const { data: masterMachines = [] } = useMasterLookup("machine_name");
  const [mode, setMode] = useState<"patient" | "machine" | "outsourced">("patient");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedMachine, setSelectedMachine] = useState<string>("all");
  const [expandedPatient, setExpandedPatient] = useState<string | null>(null);
  const [editedValues, setEditedValues] = useState<Record<string, string>>({});
  const [blankParamCount, setBlankParamCount] = useState(0);
  const [highlightBlanksForRegs, setHighlightBlanksForRegs] = useState<Set<string>>(new Set());
  const autoSaveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 400);
    return () => clearTimeout(t);
  }, [search]);

  // ─── Fetch accepted registrations ───
  const { data: acceptedRegs = [], isLoading: loadingRegs } = useQuery({
    queryKey: ["results_accepted_regs", debouncedSearch],
    queryFn: async () => {
      let query = supabase
        .from("patient_registrations")
        .select("*")
        .eq("status", "sample_accepted")
        .eq("bill_cancelled", false)
        .order("is_stat", { ascending: false })
        .order("updated_at", { ascending: false });
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

  // ─── Fetch outsourced_test_snips to know which inhouse tests have been transferred ───
  const { data: outsourcedSnips = [] } = useQuery({
    queryKey: ["results_outsourced_snips", regIds.join(",")],
    enabled: regIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("outsourced_test_snips")
        .select("registration_id, test_id")
        .in("registration_id", regIds);
      if (error) throw error;
      return (data || []) as any[];
    },
  });

  // Set of transferred test keys (regId||testId)
  const transferredTestKeys = useMemo(() => {
    const set = new Set<string>();
    outsourcedSnips.forEach((s: any) => set.add(`${s.registration_id}||${s.test_id}`));
    return set;
  }, [outsourcedSnips]);

  // ─── Transfer to outsourced state ───
  const [transferringKey, setTransferringKey] = useState<string | null>(null);
  const transferToOutsourced = async (regId: string, testId: string, testName: string) => {
    const key = `${regId}||${testId}`;
    setTransferringKey(key);
    try {
      await supabase.from("outsourced_test_snips").upsert({
        registration_id: regId,
        test_id: testId,
        outsource_status: "pending",
        result_mode: "manual",
      } as any, { onConflict: "registration_id,test_id" });
      // Delete any pending patient_results for this test
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

  // ─── Build patient entries ───
  const patientEntries: PatientEntry[] = useMemo(() => {
    return acceptedRegs.map((reg: any) => {
      const tests = (reg.tests || []) as any[];
      const cancelledIds = new Set(((reg.cancelled_tests || []) as any[]).map((t: any) => t.test_id));
      const activeTests = tests.filter((t: any) => !cancelledIds.has(t.test_id));

      const parameters: ParameterResult[] = [];
      for (const t of activeTests) {
        // Skip tests that are outsourced by nature or transferred to outsourced
        const testInfo = testsMap[t.test_id] || {};
        if (testInfo.is_outsourced) continue;
        if (transferredTestKeys.has(`${reg.id}||${t.test_id}`)) continue;
        const params = testParamsMap[t.test_id] || [];
        for (const tp of params) {
          if (tp.is_subheader) continue;
          const p = tp.report_test_parameters;
          if (!p) continue;
          const existing = existingResults.find(
            (r: any) => r.registration_id === reg.id && r.parameter_id === p.id
          );
          // Resolve reference range from parameter_normal_ranges
          const resolved = resolveNormalRange(p.id, reg);
          // Fallback to report_test_parameters fields if no range in parameter_normal_ranges
          const refText = resolved.text || p.normal_range_text || (p.normal_range_low != null && p.normal_range_high != null ? `${p.normal_range_low} - ${p.normal_range_high}` : "");
          const rangeLow = resolved.low ?? p.normal_range_low;
          const rangeHigh = resolved.high ?? p.normal_range_high;

          parameters.push({
            parameterId: p.id,
            paramCode: p.param_code || "",
            parameterName: p.parameter_name,
            unit: p.unit || "",
            referenceRange: refText,
            normalRangeLow: rangeLow,
            normalRangeHigh: rangeHigh,
            resultValue: existing?.result_value || "",
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
          });
        }
      }
      return { registration: reg, parameters };
    }).filter(entry => entry.parameters.length > 0);
  }, [acceptedRegs, testsMap, testParamsMap, existingResults, resolveNormalRange, transferredTestKeys]);

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
      for (const token of formula) {
        if (token.type === "parameter") {
          const val = paramValues[token.parameter_id];
          if (!val || isNaN(parseFloat(val))) return "";
          expr += parseFloat(val);
        } else if (token.type === "fixed_value") {
          expr += token.fixed_value;
        } else if (token.type === "bracket_open") {
          expr += "(";
        } else if (token.type === "bracket_close") {
          expr += ")";
        }
        if (token.operator && token.type !== "bracket_close") {
          const op = token.operator;
          if (["+", "-", "*", "/"].includes(op)) expr += ` ${op} `;
        }
      }
      // Clean up
      expr = expr.replace(/\s+/g, " ").trim();
      if (expr.endsWith("+") || expr.endsWith("-") || expr.endsWith("*") || expr.endsWith("/")) {
        expr = expr.slice(0, -1).trim();
      }
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
      const flag = calculateFlag(value, p.normalRangeLow, p.normalRangeHigh, p.rangeType, p.expectedValue);
      upserts.push({
        registration_id: regId,
        test_id: p.testId,
        parameter_id: p.parameterId,
        param_code: p.paramCode,
        parameter_name: p.parameterName,
        result_value: value || null,
        unit: p.unit,
        reference_range: p.referenceRange,
        normal_range_low: p.normalRangeLow,
        normal_range_high: p.normalRangeHigh,
        flag: flag || null,
        status: "pending",
        is_calculated: p.isCalculated,
        is_from_interface: p.isFromInterface,
      });
    }
    if (upserts.length === 0) return;
    try {
      await supabase.from("patient_results").delete().eq("registration_id", regId).eq("test_id", testId);
      await supabase.from("patient_results").insert(upserts as any);
    } catch {
      // silent auto-save failure
    }
  };

  // ─── Save & send to verification (per-test) ───
  const [savingTestKey, setSavingTestKey] = useState<string | null>(null);
  const [blankConfirmTestParams, setBlankConfirmTestParams] = useState<{ entry: PatientEntry; testId: string; testName: string } | null>(null);

  const saveMutation = useMutation({
    mutationFn: async ({ entry, testId }: { entry: PatientEntry; testId: string }) => {
      const reg = entry.registration;
      const testParams = entry.parameters.filter(p => p.testId === testId);
      const upserts: any[] = [];

      for (const p of testParams) {
        const key = `${reg.id}||${p.parameterId}`;
        const value = editedValues[key] !== undefined ? editedValues[key] : p.resultValue;

        const flag = calculateFlag(value, p.normalRangeLow, p.normalRangeHigh, p.rangeType, p.expectedValue);
        upserts.push({
          registration_id: reg.id,
          test_id: p.testId,
          parameter_id: p.parameterId,
          param_code: p.paramCode,
          parameter_name: p.parameterName,
          result_value: value || null,
          unit: p.unit,
          reference_range: p.referenceRange,
          normal_range_low: p.normalRangeLow,
          normal_range_high: p.normalRangeHigh,
          flag: flag || null,
          status: "entered",
          is_calculated: p.isCalculated,
          is_from_interface: p.isFromInterface,
        });
      }

      if (upserts.length === 0) return;

      // Delete existing results for this specific test only, then insert
      await supabase.from("patient_results").delete().eq("registration_id", reg.id).eq("test_id", testId);
      const { error } = await supabase.from("patient_results").insert(upserts as any);
      if (error) throw error;
    },
    onSuccess: (_, { entry, testId }) => {
      const testName = entry.parameters.find(p => p.testId === testId)?.testName || "Test";
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
      qc.invalidateQueries({ queryKey: ["patient_results_existing"] });
      qc.invalidateQueries({ queryKey: ["verification_"] });
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
      setBlankConfirmTestParams({ entry, testId, testName });
      setHighlightBlanksForRegs(prev => new Set(prev).add(`${reg.id}||${testId}`));
    } else {
      setSavingTestKey(`${reg.id}||${testId}`);
      saveMutation.mutate({ entry, testId });
    }
  };

  // ─── Filter entries: hide patients whose all results are already "entered" ───
  const filteredEntries = useMemo(() => {
    // Filter out patients where ALL parameters already have status "entered" or "verified"
    // Now filter at test level: remove tests whose params are all entered/verified
    const activeEntries = patientEntries.map(e => {
      const activeParams = e.parameters.filter(p => p.status !== "entered" && p.status !== "verified");
      return { ...e, parameters: activeParams };
    }).filter(e => e.parameters.length > 0);

    if (mode === "patient") return activeEntries;
    if (selectedMachine === "all") return activeEntries;
    const filterMachine = selectedMachine === "others" ? "" : selectedMachine;
    return activeEntries
      .map(e => ({
        ...e,
        parameters: e.parameters.filter(p => (p.machineName || "") === filterMachine),
      }))
      .filter(e => e.parameters.length > 0);
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

  // ─── Render parameter row ───
  const renderParamRow = (entry: PatientEntry, p: ParameterResult) => {
    const regId = entry.registration.id;
    const key = `${regId}||${p.parameterId}`;
    const currentValue = editedValues[key] !== undefined ? editedValues[key] : p.resultValue;
    const flag = calculateFlag(currentValue, p.normalRangeLow, p.normalRangeHigh, p.rangeType, p.expectedValue);
    const isInterfaceParameter = p.sendForInterface && !p.isCalculated;
    const isAwaiting = isInterfaceParameter && !currentValue;

    const isBlank = !currentValue || currentValue.trim() === "";
    const shouldHighlightBlanks = highlightBlanksForRegs.has(`${regId}||${p.testId}`);
    const rowBg = (flag === "H" || flag === "L" || flag === "A") ? "bg-destructive/5" : (isBlank && !p.isCalculated && shouldHighlightBlanks ? "bg-yellow-50" : "");

    return (
      <TableRow key={key} className={rowBg}>
        <TableCell className="py-1.5 text-xs font-mono text-muted-foreground">{p.paramCode}</TableCell>
        <TableCell className="py-1.5 text-sm font-medium">
          {p.parameterName}
          {p.isCalculated && <Calculator className="inline h-3 w-3 ml-1 text-primary" />}
        </TableCell>
        <TableCell className="py-1.5 w-[180px]">
          {isInterfaceParameter ? (
            <div className="flex items-center gap-1">
              <Input
                value={currentValue}
                onChange={e => handleValueChange(regId, p.parameterId, e.target.value, entry)}
                className="h-7 text-sm w-[120px]"
                placeholder="Manual"
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
                readOnly
                className="h-7 text-sm bg-muted/50 w-[120px] font-mono"
                placeholder="Auto"
              />
              <Badge variant="secondary" className="text-xs gap-0.5">
                <Calculator className="h-3 w-3" /> Calc
              </Badge>
            </div>
          ) : p.rangeType === "descriptive" && p.descriptiveOptions.length > 0 ? (
            <Select
              value={currentValue || undefined}
              onValueChange={(v) => handleValueChange(regId, p.parameterId, v, entry)}
            >
              <SelectTrigger className="h-7 text-sm w-[180px]">
                <SelectValue placeholder="Select..." />
              </SelectTrigger>
              <SelectContent>
                {p.descriptiveOptions.map((opt: string) => (
                  <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input
              value={currentValue}
              onChange={e => handleValueChange(regId, p.parameterId, e.target.value, entry)}
              className={`h-7 text-sm w-[140px] ${flag === "H" || flag === "L" || flag === "A" ? "border-destructive text-destructive font-bold" : ""}`}
              placeholder="Enter result"
            />
          )}
        </TableCell>
        <TableCell className="py-1.5 text-xs text-muted-foreground">{p.unit}</TableCell>
        <TableCell className="py-1.5 text-xs text-muted-foreground">{p.referenceRange}</TableCell>
        <TableCell className="py-1.5 text-center">
          {flag === "H" && <Badge variant="destructive" className="text-xs">HIGH</Badge>}
          {flag === "L" && <Badge variant="destructive" className="text-xs">LOW</Badge>}
          {flag === "A" && <Badge variant="destructive" className="text-xs">Abnormal</Badge>}
          {flag === "N" && <Badge variant="secondary" className="text-xs text-green-700">Normal</Badge>}
          {!flag && currentValue && <Badge variant="outline" className="text-xs">—</Badge>}
        </TableCell>
        <TableCell className="py-1.5 text-center">
          {p.status === "entered" && <Badge variant="secondary" className="text-xs">Entered</Badge>}
          {p.status === "verified" && <Badge className="text-xs bg-green-600">Verified</Badge>}
          {p.status === "pending" && !currentValue && <Badge variant="outline" className="text-xs">Pending</Badge>}
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
            <span className="font-semibold">{reg.patient_name}</span>
            {reg.is_stat && (
              <span className="relative inline-flex h-2.5 w-2.5 ml-1.5 align-middle">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-destructive opacity-75" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-destructive" />
              </span>
            )}
            <span className="text-sm text-muted-foreground ml-2">{reg.invoice_number}</span>
          </div>
          <Badge variant={completion === 100 ? "default" : "outline"} className="text-xs">
            {completion}% Complete
          </Badge>
        </div>

        {machineGroups.map((mg) => (
          <div key={mg.machineName} className="space-y-1">
            <div className="text-xs font-semibold text-primary uppercase tracking-wider px-1 pt-2 border-b border-primary/20 pb-1 flex items-center gap-1.5">
              <Monitor className="h-3.5 w-3.5" /> {mg.machineName}
            </div>
            {groupByTest(mg.params).map((tg) => {
              const testKey = `${reg.id}||${tg.testId}`;
              const isTestSaving = saveMutation.isPending && savingTestKey === testKey;
              return (
                <div key={tg.testId} className="ml-1">
                  <div className="flex items-center justify-between px-1 py-0.5 bg-muted/40 rounded-t">
                    <span className="text-xs font-medium text-muted-foreground">{tg.testName}</span>
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
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="py-1 text-xs w-[80px]">Code</TableHead>
                        <TableHead className="py-1 text-xs">Parameter</TableHead>
                        <TableHead className="py-1 text-xs w-[200px]">Result</TableHead>
                        <TableHead className="py-1 text-xs w-[60px]">Unit</TableHead>
                        <TableHead className="py-1 text-xs w-[120px]">Ref. Range</TableHead>
                        <TableHead className="py-1 text-xs w-[70px] text-center">Flag</TableHead>
                        <TableHead className="py-1 text-xs w-[70px] text-center">Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {tg.params.map(p => renderParamRow(entry, p))}
                    </TableBody>
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
      {/* Mode tabs */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-sm">
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
                      className="flex items-center gap-3 p-3 cursor-pointer hover:bg-muted/30 transition-colors"
                      onClick={() => setExpandedPatient(isExpanded ? null : reg.id)}
                    >
                      {isExpanded ? <ChevronUp className="h-4 w-4 shrink-0" /> : <ChevronDown className="h-4 w-4 shrink-0" />}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{reg.patient_name}</span>
                          {reg.is_stat && (
                            <span className="relative inline-flex h-2.5 w-2.5">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-destructive opacity-75" />
                              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-destructive" />
                            </span>
                          )}
                          <span className="text-sm text-muted-foreground font-mono">{reg.invoice_number}</span>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {reg.mobile_number} • {entry.parameters.length} parameters
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
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
      {/* Blank values confirmation dialog */}
      <AlertDialog open={!!blankConfirmTestParams} onOpenChange={open => { if (!open) setBlankConfirmTestParams(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Blank Result Values Detected</AlertDialogTitle>
            <AlertDialogDescription>
              {blankParamCount} parameter{blankParamCount > 1 ? "s have" : " has"} blank/empty result values in <strong>{blankConfirmTestParams?.testName}</strong> (highlighted in yellow). 
              Are you sure you want to save and send to verification with blank values?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => {
              if (blankConfirmTestParams) {
                const { entry, testId } = blankConfirmTestParams;
                setSavingTestKey(`${entry.registration.id}||${testId}`);
                saveMutation.mutate({ entry, testId });
              }
            }}>
              Yes, Send to Verification
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default ResultsEntry;
