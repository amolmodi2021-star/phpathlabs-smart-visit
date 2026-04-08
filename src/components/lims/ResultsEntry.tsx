import { useState, useCallback, useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, User, Monitor, Save, Calculator, Wifi, WifiOff, ChevronDown, ChevronUp, Check, Loader2, FlaskConical } from "lucide-react";
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
  displayOrder: number;
}

interface PatientEntry {
  registration: any;
  parameters: ParameterResult[];
}

const ResultsEntry = () => {
  const qc = useQueryClient();
  const [mode, setMode] = useState<"patient" | "department">("patient");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedDept, setSelectedDept] = useState<string>("all");
  const [expandedPatient, setExpandedPatient] = useState<string | null>(null);
  const [editedValues, setEditedValues] = useState<Record<string, string>>({});
  const [savingPatient, setSavingPatient] = useState<string | null>(null);

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

  // ─── Fetch departments ───
  const { data: departments = [] } = useQuery({
    queryKey: ["results_departments"],
    queryFn: async () => {
      const { data } = await supabase.from("report_departments").select("id, department_name").order("display_order");
      return (data || []) as any[];
    },
  });

  // ─── Fetch tests master ───
  const { data: testsMap = {} } = useQuery({
    queryKey: ["results_tests_map"],
    queryFn: async () => {
      const { data } = await supabase.from("tests").select("id, test_name, department_id");
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

  // ─── Build patient entries ───
  const patientEntries: PatientEntry[] = useMemo(() => {
    return acceptedRegs.map((reg: any) => {
      const tests = (reg.tests || []) as any[];
      const cancelledIds = new Set(((reg.cancelled_tests || []) as any[]).map((t: any) => t.test_id));
      const activeTests = tests.filter((t: any) => !cancelledIds.has(t.test_id));

      const parameters: ParameterResult[] = [];
      for (const t of activeTests) {
        const testInfo = testsMap[t.test_id] || {};
        const params = testParamsMap[t.test_id] || [];
        for (const tp of params) {
          if (tp.is_subheader) continue;
          const p = tp.report_test_parameters;
          if (!p) continue;
          // Check if result already exists
          const existing = existingResults.find(
            (r: any) => r.registration_id === reg.id && r.parameter_id === p.id
          );
          parameters.push({
            parameterId: p.id,
            paramCode: p.param_code || "",
            parameterName: p.parameter_name,
            unit: p.unit || "",
            referenceRange: p.normal_range_text || (p.normal_range_low != null && p.normal_range_high != null ? `${p.normal_range_low} - ${p.normal_range_high}` : ""),
            normalRangeLow: p.normal_range_low,
            normalRangeHigh: p.normal_range_high,
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
            displayOrder: tp.display_order || 0,
          });
        }
      }
      return { registration: reg, parameters };
    });
  }, [acceptedRegs, testsMap, testParamsMap, existingResults]);

  // ─── Calculate flag ───
  const calculateFlag = (value: string, low: number | null, high: number | null): string => {
    if (!value || value.trim() === "") return "";
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
  };

  // ─── Save results for a patient ───
  const saveMutation = useMutation({
    mutationFn: async ({ entry }: { entry: PatientEntry }) => {
      const reg = entry.registration;
      const upserts: any[] = [];

      for (const p of entry.parameters) {
        const key = `${reg.id}||${p.parameterId}`;
        const value = editedValues[key] !== undefined ? editedValues[key] : p.resultValue;
        if (!value && !p.isCalculated) continue;

        const flag = calculateFlag(value, p.normalRangeLow, p.normalRangeHigh);
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
          status: value ? "entered" : "pending",
          is_calculated: p.isCalculated,
          is_from_interface: p.isFromInterface,
        });
      }

      if (upserts.length === 0) return;

      // Delete existing and insert fresh
      await supabase.from("patient_results").delete().eq("registration_id", reg.id);
      const { error } = await supabase.from("patient_results").insert(upserts as any);
      if (error) throw error;
    },
    onSuccess: (_, { entry }) => {
      toast.success(`Results saved for ${entry.registration.patient_name}`);
      // Clear edited values for this patient
      const regId = entry.registration.id;
      setEditedValues(prev => {
        const next = { ...prev };
        Object.keys(next).forEach(k => { if (k.startsWith(`${regId}||`)) delete next[k]; });
        return next;
      });
      setSavingPatient(null);
      qc.invalidateQueries({ queryKey: ["patient_results_existing"] });
    },
    onError: (err: any) => {
      toast.error(err.message || "Failed to save results");
      setSavingPatient(null);
    },
  });

  // ─── Filter entries ───
  const filteredEntries = useMemo(() => {
    if (mode === "patient") return patientEntries;
    // Department mode: filter entries that have params in selected department
    if (selectedDept === "all") return patientEntries;
    return patientEntries
      .map(e => ({
        ...e,
        parameters: e.parameters.filter(p => p.departmentId === selectedDept),
      }))
      .filter(e => e.parameters.length > 0);
  }, [patientEntries, mode, selectedDept]);

  // ─── Stats ───
  const stats = useMemo(() => {
    let totalParams = 0, pendingParams = 0, enteredParams = 0, awaitingInterface = 0;
    for (const e of patientEntries) {
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
    return { totalParams, pendingParams, enteredParams, awaitingInterface, totalPatients: patientEntries.length };
  }, [patientEntries, editedValues]);

  // ─── Department-wise grouping inside a patient ───
  const groupByDepartment = (params: ParameterResult[]) => {
    const groups: Record<string, { deptName: string; params: ParameterResult[] }> = {};
    for (const p of params) {
      const deptId = p.departmentId || "ungrouped";
      if (!groups[deptId]) {
        const dept = departments.find((d: any) => d.id === deptId);
        groups[deptId] = { deptName: dept?.department_name || "Other", params: [] };
      }
      groups[deptId].params.push(p);
    }
    return Object.values(groups);
  };

  // ─── Group by test inside params ───
  const groupByTest = (params: ParameterResult[]) => {
    const groups: Record<string, { testName: string; params: ParameterResult[] }> = {};
    for (const p of params) {
      if (!groups[p.testId]) groups[p.testId] = { testName: p.testName, params: [] };
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
    const flag = calculateFlag(currentValue, p.normalRangeLow, p.normalRangeHigh);
    const isAwaiting = p.sendForInterface && !p.isCalculated && !currentValue;

    return (
      <TableRow key={key} className={flag === "H" || flag === "L" ? "bg-destructive/5" : ""}>
        <TableCell className="py-1.5 text-xs font-mono text-muted-foreground">{p.paramCode}</TableCell>
        <TableCell className="py-1.5 text-sm font-medium">
          {p.parameterName}
          {p.isCalculated && <Calculator className="inline h-3 w-3 ml-1 text-primary" />}
        </TableCell>
        <TableCell className="py-1.5 w-[180px]">
          {isAwaiting ? (
            <div className="flex items-center gap-1">
              <Input
                value={currentValue}
                onChange={e => handleValueChange(regId, p.parameterId, e.target.value, entry)}
                className="h-7 text-sm w-[120px]"
                placeholder="Manual"
              />
              <Badge variant="outline" className="text-xs text-orange-600 border-orange-300 whitespace-nowrap gap-0.5">
                <Wifi className="h-3 w-3" /> Awaiting
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
          ) : (
            <Input
              value={currentValue}
              onChange={e => handleValueChange(regId, p.parameterId, e.target.value, entry)}
              className={`h-7 text-sm w-[140px] ${flag === "H" || flag === "L" ? "border-destructive text-destructive font-bold" : ""}`}
              placeholder="Enter result"
            />
          )}
        </TableCell>
        <TableCell className="py-1.5 text-xs text-muted-foreground">{p.unit}</TableCell>
        <TableCell className="py-1.5 text-xs text-muted-foreground">{p.referenceRange}</TableCell>
        <TableCell className="py-1.5 text-center">
          {flag === "H" && <Badge variant="destructive" className="text-xs">HIGH</Badge>}
          {flag === "L" && <Badge variant="destructive" className="text-xs">LOW</Badge>}
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
    const deptGroups = groupByDepartment(entry.parameters);
    const completion = getCompletionPct(entry);
    const unsaved = hasUnsavedChanges(reg.id);

    return (
      <div className="space-y-3 p-3 bg-muted/20 rounded-lg border">
        <div className="flex items-center justify-between">
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
          <div className="flex items-center gap-2">
            {unsaved && <Badge variant="secondary" className="text-xs text-orange-600">Unsaved</Badge>}
            <Button
              size="sm"
              onClick={() => {
                setSavingPatient(reg.id);
                saveMutation.mutate({ entry });
              }}
              disabled={saveMutation.isPending && savingPatient === reg.id}
            >
              {saveMutation.isPending && savingPatient === reg.id ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
              ) : (
                <Save className="h-4 w-4 mr-1" />
              )}
              Save Results
            </Button>
          </div>
        </div>

        {deptGroups.map((dg, di) => (
          <div key={di} className="space-y-1">
            <div className="text-xs font-semibold text-primary uppercase tracking-wider px-1 pt-2 border-b border-primary/20 pb-1">
              {dg.deptName}
            </div>
            {groupByTest(dg.params).map((tg, ti) => (
              <div key={ti} className="ml-1">
                <div className="text-xs font-medium text-muted-foreground px-1 py-0.5 bg-muted/40 rounded-t">
                  {tg.testName}
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
                    {tg.params
                      .sort((a, b) => a.displayOrder - b.displayOrder)
                      .map(p => renderParamRow(entry, p))}
                  </TableBody>
                </Table>
              </div>
            ))}
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* Stats bar */}
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

      {/* Controls */}
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
            <TabsTrigger value="department" className="text-xs gap-1 h-7">
              <Building2 className="h-3.5 w-3.5" /> Department Wise
            </TabsTrigger>
          </TabsList>
        </Tabs>
        {mode === "department" && (
          <Select value={selectedDept} onValueChange={setSelectedDept}>
            <SelectTrigger className="w-[200px] h-9">
              <SelectValue placeholder="All Departments" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Departments</SelectItem>
              {departments.map((d: any) => (
                <SelectItem key={d.id} value={d.id}>{d.department_name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

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
    </div>
  );
};

export default ResultsEntry;
