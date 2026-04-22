import { useState, useCallback, useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Search, ChevronDown, ChevronUp, Loader2, Save, Eye, FileCheck, Calculator } from "lucide-react";
import { toast } from "sonner";
import PaginatedTableFooter from "@/components/ui/PaginatedTableFooter";

const PAGE_SIZE = 50;

const ModifiedApproval = () => {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(0);
  const [expandedPatient, setExpandedPatient] = useState<string | null>(null);
  const [editedValues, setEditedValues] = useState<Record<string, string>>({});
  const [editedUnits, setEditedUnits] = useState<Record<string, string>>({});
  const [editedRefRanges, setEditedRefRanges] = useState<Record<string, string>>({});
  const [editedFlags, setEditedFlags] = useState<Record<string, string>>({});
  const [actionKey, setActionKey] = useState<string | null>(null);
  const [viewSnipImages, setViewSnipImages] = useState<string[] | null>(null);

  useEffect(() => { const t = setTimeout(() => setDebouncedSearch(search), 400); return () => clearTimeout(t); }, [search]);
  useEffect(() => { setPage(0); }, [debouncedSearch]);

  // Fetch approved_reports — server-side paginated
  const { data: pagedReports, isLoading } = useQuery({
    queryKey: ["modified_approval_reports", debouncedSearch, page],
    queryFn: async () => {
      const from = page * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;
      // Use estimated count when unfiltered (avoids full-table scan); exact when searching.
      const useEstimated = !debouncedSearch;
      let query = supabase.from("approved_reports").select("*", { count: useEstimated ? "estimated" : "exact" }).order("approval_date", { ascending: false }).range(from, to);
      if (debouncedSearch) query = query.or(`patient_name.ilike.%${debouncedSearch}%,mobile_number.ilike.%${debouncedSearch}%,invoice_number.ilike.%${debouncedSearch}%,umr_number.ilike.%${debouncedSearch}%`);
      const { data, count } = await query;
      return { rows: (data || []) as any[], total: count || 0 };
    },
  });

  const approvedReports = pagedReports?.rows || [];
  const totalReports = pagedReports?.total || 0;

  const regIds = approvedReports.map((r: any) => r.registration_id);

  // Fetch approved patient_results for editing
  const { data: approvedResults = [] } = useQuery({
    queryKey: ["modified_approval_results", regIds.join(",")],
    enabled: regIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase.from("patient_results").select("*").in("registration_id", regIds).eq("status", "approved");
      return (data || []) as any[];
    },
  });

  // Fetch outsourced snips
  const { data: approvedSnips = [] } = useQuery({
    queryKey: ["modified_approval_snips", regIds.join(",")],
    enabled: regIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase.from("outsourced_test_snips").select("registration_id, test_id, outsourced_parameter_ids, outsource_status, outsourced_lab_name, result_mode, snip_image_urls").in("registration_id", regIds).eq("outsource_status", "approved");
      return (data || []) as any[];
    },
  });

  const { data: testsMap = {} } = useQuery({
    queryKey: ["results_tests_map"],
    queryFn: async () => { const { data } = await supabase.from("tests").select("id, test_name, department_id, instrument_name"); const map: Record<string, any> = {}; (data || []).forEach((t: any) => { map[t.id] = t; }); return map; },
  });

  const { data: testParamsMap = {} } = useQuery({
    queryKey: ["results_test_params_full"],
    queryFn: async () => { const { data } = await supabase.from("test_parameters").select("test_id, parameter_id, display_order, is_subheader, subheader_text, report_test_parameters(id, param_code, parameter_name, parameter_description, unit, normal_range_low, normal_range_high, normal_range_text, is_calculated, calculation_formula, send_for_interface)").order("display_order"); const map: Record<string, any[]> = {}; (data || []).forEach((tp: any) => { if (!tp.test_id) return; if (!map[tp.test_id]) map[tp.test_id] = []; map[tp.test_id].push(tp); }); return map; },
  });

  const { data: normalRangesMap = {} } = useQuery({
    queryKey: ["results_normal_ranges"],
    queryFn: async () => { const { data } = await supabase.from("parameter_normal_ranges").select("*").order("age_min"); const map: Record<string, any[]> = {}; (data || []).forEach((r: any) => { if (!map[r.parameter_id]) map[r.parameter_id] = []; map[r.parameter_id].push(r); }); return map; },
  });

  // Build entries grouped by report
  const entries = useMemo(() => {
    return approvedReports.map((report: any) => {
      const regId = report.registration_id;
      const results = approvedResults.filter((r: any) => r.registration_id === regId);
      const snips = approvedSnips.filter((s: any) => s.registration_id === regId);

      // Group results by test
      const testGroups: Record<string, { testId: string; testName: string; params: any[]; isOutsourced: boolean; labName: string | null; snipUrls: string[] }> = {};

      for (const r of results) {
        if (!testGroups[r.test_id]) {
          const testInfo = testsMap[r.test_id] || {};
          const snip = snips.find((s: any) => s.test_id === r.test_id);
          testGroups[r.test_id] = {
            testId: r.test_id,
            testName: testInfo.test_name || r.parameter_name || "Unknown",
            params: [],
            isOutsourced: !!snip,
            labName: snip?.outsourced_lab_name || null,
            snipUrls: snip?.result_mode === "snip" && Array.isArray(snip?.snip_image_urls) ? snip.snip_image_urls : [],
          };
        }
        testGroups[r.test_id].params.push(r);
      }

      // Add snip-only tests (no results)
      for (const snip of snips) {
        if (!testGroups[snip.test_id]) {
          const testInfo = testsMap[snip.test_id] || {};
          const urls = snip.result_mode === "snip" && Array.isArray(snip.snip_image_urls) ? snip.snip_image_urls : [];
          if (urls.length > 0) {
            testGroups[snip.test_id] = {
              testId: snip.test_id,
              testName: testInfo.test_name || "Unknown",
              params: [],
              isOutsourced: true,
              labName: snip.outsourced_lab_name || null,
              snipUrls: urls,
            };
          }
        }
      }

      return { report, testGroups: Object.values(testGroups) };
    }).filter(e => e.testGroups.length > 0);
  }, [approvedReports, approvedResults, approvedSnips, testsMap]);

  const calculateFlag = (value: string, low: number | null, high: number | null): string => {
    if (!value || !value.trim()) return "";
    const num = parseFloat(value); if (isNaN(num)) return "";
    if (low != null && num < low) return "L"; if (high != null && num > high) return "H"; return "N";
  };

  const evaluateFormula = (formula: any[], paramValues: Record<string, string>): string => {
    if (!formula || formula.length === 0) return "";
    try { let expr = ""; for (let idx = 0; idx < formula.length; idx++) { const token = formula[idx]; if (token.type === "bracket_open") { if (idx > 0 && token.operator && ["+", "-", "*", "/"].includes(token.operator)) expr += ` ${token.operator} `; expr += "("; } else if (token.type === "bracket_close") { expr += ")"; } else if (token.type === "parameter") { if (idx > 0 && token.operator && ["+", "-", "*", "/"].includes(token.operator)) expr += ` ${token.operator} `; const val = paramValues[token.parameter_id]; if (!val || isNaN(parseFloat(val))) return ""; expr += parseFloat(val); } else if (token.type === "fixed_value" || token.type === "fixed") { if (idx > 0 && token.operator && ["+", "-", "*", "/"].includes(token.operator)) expr += ` ${token.operator} `; expr += token.fixed_value ?? token.value ?? ""; } } expr = expr.replace(/\s+/g, " ").trim(); const result = new Function(`return (${expr})`)(); if (typeof result === "number" && isFinite(result)) return parseFloat(result.toFixed(2)).toString(); return ""; } catch { return ""; }
  };

  const handleValueChange = (regId: string, paramId: string, value: string, allParams: any[]) => {
    const key = `${regId}||${paramId}`;
    const newEdited = { ...editedValues, [key]: value };

    // Check for calculated fields
    const paramValues: Record<string, string> = {};
    for (const p of allParams) {
      const pk = `${regId}||${p.parameter_id}`;
      paramValues[p.parameter_id] = pk === key ? value : (newEdited[pk] !== undefined ? newEdited[pk] : p.result_value || "");
    }

    // Look up test_parameters for calculation formulas
    for (const p of allParams) {
      const testParams = testParamsMap[p.test_id] || [];
      const tp = testParams.find((t: any) => t.parameter_id === p.parameter_id);
      const paramDef = tp?.report_test_parameters;
      if (paramDef?.is_calculated && paramDef.calculation_formula?.length > 0) {
        const r = evaluateFormula(paramDef.calculation_formula, paramValues);
        newEdited[`${regId}||${p.parameter_id}`] = r;
        paramValues[p.parameter_id] = r;
      }
    }

    setEditedValues(newEdited);
  };

  const toggleHold = async (reportId: string, currentHeld: boolean) => {
    setActionKey(`${reportId}||hold`);
    try {
      await supabase.from("approved_reports").update({ is_held: !currentHeld } as any).eq("id", reportId);
      toast.success(currentHeld ? "Report released for dispatch" : "Report held from dispatch");
      qc.invalidateQueries({ queryKey: ["modified_approval_reports"] });
      qc.invalidateQueries({ queryKey: ["dispatch_"] });
    } catch (err: any) { toast.error(err.message || "Failed"); }
    finally { setActionKey(null); }
  };

  const saveChanges = async (report: any, testGroups: any[]) => {
    const regId = report.registration_id;
    setActionKey(`${regId}||save`);
    try {
      const allTestResults: any[] = [];
      const allSnipUrls: string[] = [];

      for (const tg of testGroups) {
        for (const p of tg.params) {
          const key = `${regId}||${p.parameter_id}`;
          const newValue = editedValues[key] !== undefined ? editedValues[key] : p.result_value;
          const newUnit = editedUnits[key] !== undefined ? editedUnits[key] : p.unit;
          const newRefRange = editedRefRanges[key] !== undefined ? editedRefRanges[key] : p.reference_range;
          const newFlag = editedFlags[key] !== undefined ? editedFlags[key] : (calculateFlag(newValue, p.normal_range_low, p.normal_range_high) || p.flag);

          // Update patient_results
          await supabase.from("patient_results").update({
            result_value: newValue || null,
            unit: newUnit || null,
            reference_range: newRefRange || null,
            flag: newFlag || null,
          } as any).eq("id", p.id);

          allTestResults.push({
            test_id: p.test_id, test_name: tg.testName,
            parameter_id: p.parameter_id, param_code: p.param_code, parameter_name: p.parameter_name,
            result_value: newValue, unit: newUnit, reference_range: newRefRange,
            normal_range_low: p.normal_range_low, normal_range_high: p.normal_range_high,
            flag: newFlag, is_calculated: p.is_calculated, is_outsourced: tg.isOutsourced,
            outsource_lab_name: tg.labName,
          });
        }

        if (tg.snipUrls.length > 0) {
          allSnipUrls.push(...tg.snipUrls);
          if (tg.params.length === 0) {
            allTestResults.push({
              test_id: tg.testId, test_name: tg.testName,
              is_outsourced: true, outsource_lab_name: tg.labName,
            });
          }
        }
      }

      // Re-save snapshot to approved_reports
      await supabase.from("approved_reports").update({
        test_results: allTestResults,
        outsourced_snip_urls: allSnipUrls,
        approval_date: new Date().toISOString(),
      } as any).eq("id", report.id);

      toast.success(`Changes saved for ${report.patient_name}`);
      // Clear edited state for this patient
      const prefix = `${regId}||`;
      setEditedValues(prev => { const n = { ...prev }; Object.keys(n).filter(k => k.startsWith(prefix)).forEach(k => delete n[k]); return n; });
      setEditedUnits(prev => { const n = { ...prev }; Object.keys(n).filter(k => k.startsWith(prefix)).forEach(k => delete n[k]); return n; });
      setEditedRefRanges(prev => { const n = { ...prev }; Object.keys(n).filter(k => k.startsWith(prefix)).forEach(k => delete n[k]); return n; });
      setEditedFlags(prev => { const n = { ...prev }; Object.keys(n).filter(k => k.startsWith(prefix)).forEach(k => delete n[k]); return n; });
      qc.invalidateQueries({ queryKey: ["modified_approval_"] });
      qc.invalidateQueries({ queryKey: ["dispatch_"] });
    } catch (err: any) { toast.error(err.message || "Save failed"); }
    finally { setActionKey(null); }
  };

  const hasEdits = (regId: string) => {
    const prefix = `${regId}||`;
    return Object.keys(editedValues).some(k => k.startsWith(prefix)) ||
      Object.keys(editedUnits).some(k => k.startsWith(prefix)) ||
      Object.keys(editedRefRanges).some(k => k.startsWith(prefix)) ||
      Object.keys(editedFlags).some(k => k.startsWith(prefix));
  };

  return (
    <div className="space-y-4">
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input placeholder="Search by name, mobile, invoice, UMR…" value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Card className="p-3"><div className="text-xs text-muted-foreground">Total Approved Reports</div><div className="text-xl font-bold">{entries.length}</div></Card>
        <Card className="p-3"><div className="text-xs text-muted-foreground">On Hold</div><div className="text-xl font-bold text-amber-600">{approvedReports.filter((r: any) => r.is_held).length}</div></Card>
        <Card className="p-3"><div className="text-xs text-muted-foreground">Ready for Dispatch</div><div className="text-xl font-bold text-green-600">{approvedReports.filter((r: any) => !r.is_held).length}</div></Card>
      </div>

      {isLoading ? (
        <Card><CardContent className="p-8 text-center text-muted-foreground"><Loader2 className="h-6 w-6 animate-spin mx-auto" /></CardContent></Card>
      ) : entries.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <FileCheck className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p className="text-lg font-medium">No approved reports found</p>
          <p className="text-sm">Reports will appear here after doctor approval</p>
        </div>
      ) : (
        <div className="space-y-2">
          {entries.map(({ report, testGroups }) => {
            const isExpanded = expandedPatient === report.id;
            const isSaving = actionKey === `${report.registration_id}||save`;
            const isHolding = actionKey === `${report.id}||hold`;
            const isHeld = report.is_held;
            const edited = hasEdits(report.registration_id);

            return (
              <Card key={report.id} className={isExpanded ? "ring-1 ring-primary/30" : ""}>
                <div className="flex items-center justify-between p-3 cursor-pointer hover:bg-muted/30 transition-colors" onClick={() => setExpandedPatient(isExpanded ? null : report.id)}>
                  <div className="flex items-center gap-3 min-w-0">
                    {isExpanded ? <ChevronUp className="h-4 w-4 shrink-0" /> : <ChevronDown className="h-4 w-4 shrink-0" />}
                    <div className="min-w-0">
                      <div className="font-medium text-sm truncate">
                        {report.patient_name}
                        <span className="text-xs text-muted-foreground ml-2">{report.invoice_number}</span>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {report.mobile_number} • {testGroups.length} test{testGroups.length !== 1 ? "s" : ""}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0" onClick={e => e.stopPropagation()}>
                    {isHeld ? (
                      <Badge className="text-xs bg-amber-500">On Hold</Badge>
                    ) : (
                      <Badge className="text-xs bg-green-600">Ready for Dispatch</Badge>
                    )}
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-muted-foreground">{isHeld ? "Held" : "Dispatching"}</span>
                      <Switch checked={isHeld} disabled={isHolding} onCheckedChange={() => toggleHold(report.id, isHeld)} />
                    </div>
                    {edited && (
                      <Button size="sm" variant="default" className="h-7 text-xs gap-1" disabled={isSaving} onClick={() => saveChanges(report, testGroups)}>
                        {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save Changes
                      </Button>
                    )}
                  </div>
                </div>

                {isExpanded && (
                  <CardContent className="pt-0 pb-3 px-3">
                    <div className="space-y-3">
                      {testGroups.map(tg => (
                        <div key={tg.testId} className="border rounded-lg overflow-hidden bg-background">
                          <div className="flex items-center justify-between px-3 py-2 bg-muted/40">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium">{tg.testName}</span>
                              {tg.isOutsourced && tg.labName && (
                                <Badge variant="outline" className="text-[10px] text-green-600 border-green-300">{tg.labName}</Badge>
                              )}
                            </div>
                            {tg.snipUrls.length > 0 && (
                              <Button size="sm" variant="outline" className="h-6 text-xs gap-1" onClick={() => setViewSnipImages(tg.snipUrls)}>
                                <Eye className="h-3 w-3" /> View Snip ({tg.snipUrls.length})
                              </Button>
                            )}
                          </div>
                          {tg.params.length > 0 && (
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead className="py-1 text-xs w-[80px]">Code</TableHead>
                                  <TableHead className="py-1 text-xs">Parameter</TableHead>
                                  <TableHead className="py-1 text-xs w-[180px]">Result</TableHead>
                                  <TableHead className="py-1 text-xs w-[80px]">Unit</TableHead>
                                  <TableHead className="py-1 text-xs w-[120px]">Ref. Range</TableHead>
                                  <TableHead className="py-1 text-xs w-[80px] text-center">Flag</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {tg.params.map(p => {
                                  const key = `${report.registration_id}||${p.parameter_id}`;
                                  const currentValue = editedValues[key] !== undefined ? editedValues[key] : (p.result_value || "");
                                  const currentUnit = editedUnits[key] !== undefined ? editedUnits[key] : (p.unit || "");
                                  const currentRef = editedRefRanges[key] !== undefined ? editedRefRanges[key] : (p.reference_range || "");
                                  const autoFlag = calculateFlag(currentValue, p.normal_range_low, p.normal_range_high);
                                  const currentFlag = editedFlags[key] !== undefined ? editedFlags[key] : (p.flag || autoFlag);
                                  const rowBg = (currentFlag === "H" || currentFlag === "L" || currentFlag === "A") ? "bg-destructive/5" : "";

                                  // Check if calculated
                                  const testParams = testParamsMap[p.test_id] || [];
                                  const tp = testParams.find((t: any) => t.parameter_id === p.parameter_id);
                                  const isCalc = tp?.report_test_parameters?.is_calculated || false;

                                  return (
                                    <TableRow key={key} className={rowBg}>
                                      <TableCell className="py-1.5 text-xs font-mono text-muted-foreground">{p.param_code}</TableCell>
                                      <TableCell className="py-1.5 text-sm font-medium">
                                        {p.parameter_name}
                                        {isCalc && <Calculator className="inline h-3 w-3 ml-1 text-primary" />}
                                      </TableCell>
                                      <TableCell className="py-1.5">
                                        {isCalc ? (
                                          <div className="flex items-center gap-1"><Input value={currentValue} onChange={e => handleValueChange(report.registration_id, p.parameter_id, e.target.value, tg.params)} className="h-7 text-sm w-[120px] font-mono" placeholder="Auto" /><Button type="button" variant="ghost" size="icon" className="h-7 w-7" title="Recalculate" onClick={() => { if (!p.calculation_formula) return; const paramValues: Record<string, string> = {}; tg.params.forEach((ep: any) => { const k = `${report.registration_id}::${ep.parameter_id}`; paramValues[ep.parameter_id] = editedValues[k] ?? ep.result_value ?? ""; }); const result = evaluateFormula(p.calculation_formula, paramValues); if (result) handleValueChange(report.registration_id, p.parameter_id, result, tg.params); }}><Calculator className="h-3 w-3 text-primary" /></Button></div>
                                        ) : (
                                          <Input value={currentValue} onChange={e => handleValueChange(report.registration_id, p.parameter_id, e.target.value, tg.params)} className={`h-7 text-sm w-[160px] ${(currentFlag === "H" || currentFlag === "L" || currentFlag === "A") ? "border-destructive text-destructive font-bold" : ""}`} />
                                        )}
                                      </TableCell>
                                      <TableCell className="py-1.5">
                                        <Input value={currentUnit} onChange={e => setEditedUnits(prev => ({ ...prev, [key]: e.target.value }))} className="h-6 text-xs w-[70px]" />
                                      </TableCell>
                                      <TableCell className="py-1.5">
                                        <Input value={currentRef} onChange={e => setEditedRefRanges(prev => ({ ...prev, [key]: e.target.value }))} className="h-6 text-xs w-[100px]" />
                                      </TableCell>
                                      <TableCell className="py-1.5 text-center">
                                        <Select value={currentFlag || "none"} onValueChange={v => setEditedFlags(prev => ({ ...prev, [key]: v === "none" ? "" : v }))}>
                                          <SelectTrigger className="h-6 text-xs w-[80px]"><SelectValue /></SelectTrigger>
                                          <SelectContent>
                                            <SelectItem value="none">—</SelectItem>
                                            <SelectItem value="N">Normal</SelectItem>
                                            <SelectItem value="H">HIGH</SelectItem>
                                            <SelectItem value="L">LOW</SelectItem>
                                            <SelectItem value="A">Abnormal</SelectItem>
                                          </SelectContent>
                                        </Select>
                                      </TableCell>
                                    </TableRow>
                                  );
                                })}
                              </TableBody>
                            </Table>
                          )}
                        </div>
                      ))}
                      {edited && (
                        <div className="flex justify-end">
                          <Button size="sm" variant="default" className="gap-1" disabled={isSaving} onClick={() => saveChanges(report, testGroups)}>
                            {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save Changes
                          </Button>
                        </div>
                      )}
                    </div>
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

      <PaginatedTableFooter page={page} pageSize={PAGE_SIZE} total={totalReports} onPageChange={setPage} />
    </div>
  );
};

export default ModifiedApproval;
