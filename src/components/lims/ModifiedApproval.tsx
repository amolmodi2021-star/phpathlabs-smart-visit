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
import { Search, ChevronDown, ChevronUp, Loader2, Save, Eye, FileCheck, Calculator, StickyNote, Trash2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import PaginatedTableFooter from "@/components/ui/PaginatedTableFooter";
import { isSuspectNegativeResult } from "@/lib/reportFlags";
import TimeResultInput from "./TimeResultInput";
import { parseTimeResultToSeconds, toCanonicalTimeResult } from "@/lib/timeRange";
import { checkDifferentialSum } from "@/lib/differentialCount";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { fetchAllByIds } from "@/lib/fetchAllRows";
import { shortIdsKey } from "@/lib/queryKeys";
import { patientDisplayName } from "@/lib/patientDisplayName";

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
  const [editedNotes, setEditedNotes] = useState<Record<string, string>>({});
  const [savedOverrides, setSavedOverrides] = useState<Record<string, { value: string; unit: string; ref: string; flag: string; note: string | null; testNote: string | null }>>({});
  const [activeNoteKey, setActiveNoteKey] = useState<string | null>(null);
  const [editedTestNotes, setEditedTestNotes] = useState<Record<string, string>>({});
  const [activeTestNoteKey, setActiveTestNoteKey] = useState<string | null>(null);
  const [actionKey, setActionKey] = useState<string | null>(null);
  const [viewSnipImages, setViewSnipImages] = useState<string[] | null>(null);
  const [diffConfirm, setDiffConfirm] = useState<{ report: any; testGroups: any[]; issues: { testName: string; sum: number; diff: number }[] } | null>(null);

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
  const regKey = shortIdsKey(regIds, "ma");

  // Fetch approved patient_results for editing
  const { data: approvedResults = [] } = useQuery({
    queryKey: ["modified_approval_results", regKey],
    enabled: regIds.length > 0,
    queryFn: async () => {
      return await fetchAllByIds<any>("patient_results", "*", "registration_id", regIds, { eq: { status: "approved" } });
    },
  });

  // Fetch outsourced snips
  const { data: approvedSnips = [] } = useQuery({
    queryKey: ["modified_approval_snips", regKey],
    enabled: regIds.length > 0,
    queryFn: async () => {
      return await fetchAllByIds<any>(
        "outsourced_test_snips",
        "id, registration_id, test_id, outsourced_parameter_ids, outsource_status, outsourced_lab_name, result_mode, snip_image_urls",
        "registration_id",
        regIds,
        { eq: { outsource_status: "approved" } },
      );
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
      const snapshotResults = Array.isArray(report.test_results) ? report.test_results : [];
      const dbResults = approvedResults.filter((r: any) => r.registration_id === regId);
      const seenResultKeys = new Set<string>();
      const results = [...dbResults, ...snapshotResults.map((r: any) => ({
        ...r,
        registration_id: regId,
        status: "approved",
        __snapshot: true,
      }))].filter((r: any) => {
        const k = `${r.test_id}||${r.parameter_id}`;
        if (seenResultKeys.has(k)) return false;
        seenResultKeys.add(k);
        return true;
      });
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

      // Inject any parameters that exist in the test definition but are missing
      // from saved patient_results — including subheaders. This guarantees the
      // Modified Approval view always shows the full structure of every test
      // (calculated params that didn't auto-evaluate, params that were skipped
      // during entry, subheader rows, etc.) so nothing is silently hidden.
      Object.values(testGroups).forEach((tg) => {
        const defs = (testParamsMap as any)[tg.testId] || [];
        const existingPids = new Set(tg.params.map((p: any) => p.parameter_id));
        defs.forEach((tp: any) => {
          if (tp.is_subheader) return; // subheaders aren't editable rows here
          const rtp = tp.report_test_parameters;
          if (!rtp) return;
          if (existingPids.has(tp.parameter_id)) return;
          tg.params.push({
            registration_id: regId,
            test_id: tg.testId,
            parameter_id: tp.parameter_id,
            param_code: rtp.param_code,
            parameter_name: rtp.parameter_name,
            result_value: "",
            unit: rtp.unit || "",
            reference_range: rtp.normal_range_text || "",
            normal_range_low: rtp.normal_range_low,
            normal_range_high: rtp.normal_range_high,
            flag: "",
            note: "",
            test_note: "",
            calculation_formula: rtp.calculation_formula || [],
            is_calculated: !!rtp.is_calculated,
            __synthetic: true,
            display_order: tp.display_order ?? 9999,
          });
        });
        // Sort by display_order from test definition so calculated params slot
        // into their natural position rather than appearing at the end.
        const orderMap: Record<string, number> = {};
        defs.forEach((tp: any) => { orderMap[tp.parameter_id] = tp.display_order ?? 9999; });
        tg.params.sort((a: any, b: any) => {
          const da = orderMap[a.parameter_id] ?? 9999;
          const db = orderMap[b.parameter_id] ?? 9999;
          return da - db;
        });
      });

      return { report, testGroups: Object.values(testGroups) };
    }).filter(e => e.testGroups.length > 0);
  }, [approvedReports, approvedResults, approvedSnips, testsMap, testParamsMap]);

  // Loaded test-level notes: first non-null test_note per (regId, testId)
  const loadedTestNotes = useMemo(() => {
    const map: Record<string, string> = {};
    for (const r of approvedResults as any[]) {
      const k = `${r.registration_id}||${r.test_id}`;
      if (map[k] == null && r.test_note) map[k] = r.test_note;
    }
    return map;
  }, [approvedResults]);
  const getTestNote = (regId: string, testId: string): string => {
    const k = `${regId}||${testId}`;
    if (editedTestNotes[k] !== undefined) return editedTestNotes[k];
    return loadedTestNotes[k] || "";
  };

  // Resolve range_type + display "normal" text + descriptive options + unit
  const resolveRangeMeta = (parameterId: string): { rangeType: string; normalRangeText: string; descriptiveOptions: string[] } => {
    const ranges = (normalRangesMap as any)[parameterId] || [];
    if (ranges.length > 0) {
      const r = ranges[0];
      return {
        rangeType: r.range_type || "numeric",
        normalRangeText: r.normal_range_text || "",
        descriptiveOptions: Array.isArray(r.descriptive_options) ? r.descriptive_options : [],
      };
    }
    return { rangeType: "numeric", normalRangeText: "", descriptiveOptions: [] };
  };

  const calculateFlag = (value: string, low: number | null, high: number | null, rangeType?: string, expectedValue?: string, descriptiveOptions?: string[], normalRangeText?: string): string => {
    if (!value || !value.trim()) return "";
    if (rangeType === "undefined") return "";
    if (rangeType === "time") {
      const total = parseTimeResultToSeconds(value);
      if (total == null) return "";
      if (low != null && total < low) return "L";
      if (high != null && total > high) return "H";
      return "N";
    }
    if (rangeType === "qualitative" || rangeType === "descriptive") {
      const ref = (normalRangeText || "").trim().toLowerCase();
      if (!ref) return "";
      return value.trim().toLowerCase() === ref ? "N" : "X";
    }
    // Operator-prefixed values (">5", "> 5", "≥5", "<0.01", "≤ 2") → cap → H/L
    const trimmed = value.trim();
    if (/^(?:>=|≥|>)\s*-?\d*\.?\d+/.test(trimmed)) return "H";
    if (/^(?:<=|≤|<)\s*-?\d*\.?\d+/.test(trimmed)) return "L";
    const num = parseFloat(trimmed); if (isNaN(num)) return "";
    if (low != null && num < low) return "L"; if (high != null && num > high) return "H"; return "N";
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

  const saveChanges = async (report: any, testGroups: any[], skipDiffCheck = false) => {
    const regId = report.registration_id;

    if (!skipDiffCheck) {
      const issues: { testName: string; sum: number; diff: number }[] = [];
      for (const tg of testGroups) {
        const list = (tg.params || []).map((p: any) => {
          const key = `${regId}||${p.parameter_id}`;
          const saved = savedOverrides[key];
          const v = editedValues[key] !== undefined ? editedValues[key] : (saved?.value ?? p.result_value);
          return { paramCode: p.param_code, value: v };
        });
        const r = checkDifferentialSum(list);
        if (r.hasDifferential && !r.isOk) issues.push({ testName: tg.testName, sum: r.sum, diff: r.diff });
      }
      if (issues.length > 0) {
        setDiffConfirm({ report, testGroups, issues });
        return;
      }
    }

    setActionKey(`${regId}||save`);
    try {
      const allTestResults: any[] = [];
      const allSnipUrls: string[] = [];
      const nextSavedOverrides: Record<string, { value: string; unit: string; ref: string; flag: string; note: string | null; testNote: string | null }> = {};

      for (const tg of testGroups) {
        const testNoteKey = `${regId}||${tg.testId}`;
        const newTestNote = editedTestNotes[testNoteKey] !== undefined
          ? (editedTestNotes[testNoteKey] || null)
          : (loadedTestNotes[testNoteKey] || null);

        for (const p of tg.params) {
          const key = `${regId}||${p.parameter_id}`;
          const saved = savedOverrides[key];
          const rawValue = editedValues[key] !== undefined ? editedValues[key] : (saved?.value ?? p.result_value);
          const newUnit = editedUnits[key] !== undefined ? editedUnits[key] : (saved?.unit ?? p.unit);
          const newRefRange = editedRefRanges[key] !== undefined ? editedRefRanges[key] : (saved?.ref ?? p.reference_range);
          const rangeMeta = resolveRangeMeta(p.parameter_id);
          const newValue = rangeMeta.rangeType === "time" ? toCanonicalTimeResult(rawValue) : rawValue;
          const newFlag = editedFlags[key] !== undefined ? editedFlags[key] : (calculateFlag(newValue, p.normal_range_low, p.normal_range_high, rangeMeta.rangeType, undefined, undefined, rangeMeta.normalRangeText) || p.flag);
          const noteKey = `${regId}||${p.parameter_id}`;
          const newNote = editedNotes[noteKey] !== undefined ? (editedNotes[noteKey] || null) : (saved?.note ?? p.note ?? null);

          // Update existing patient_results row, OR insert one if this is a
          // synthetic row (parameter present in test definition but never
          // saved to patient_results during initial entry/approval). Without
          // this insert, edits to those rows would only land in the
          // approved_reports JSONB snapshot (used by the PDF) but never reach
          // patient_results — so the value would disappear next time the
          // record is reopened in Modified Approval.
          const persistPayload = {
              result_value: applyUnitSuffix(newValue, newUnit, rangeMeta.rangeType) || null,
              unit: newUnit || null,
              reference_range: newRefRange || null,
              flag: newFlag || null,
              note: newNote,
              test_note: newTestNote,
          };

          if (p.id) {
            await supabase.from("patient_results").update(persistPayload as any).eq("id", p.id);
          } else if (newValue && String(newValue).trim() !== "") {
            const nowIso = new Date().toISOString();
            await supabase.from("patient_results").upsert({
              ...persistPayload,
              registration_id: regId,
              test_id: p.test_id,
              parameter_id: p.parameter_id,
              param_code: p.param_code || null,
              parameter_name: p.parameter_name || null,
              normal_range_low: p.normal_range_low ?? null,
              normal_range_high: p.normal_range_high ?? null,
              status: "approved",
              is_calculated: !!p.is_calculated,
              approved_at: nowIso,
              approved_by: report.approved_by || null,
            } as any, { onConflict: "registration_id,test_id,parameter_id" });
          }

          allTestResults.push({
            test_id: p.test_id, test_name: tg.testName,
            parameter_id: p.parameter_id, param_code: p.param_code, parameter_name: p.parameter_name,
            result_value: newValue, unit: newUnit, reference_range: newRefRange,
            normal_range_low: p.normal_range_low, normal_range_high: p.normal_range_high,
            flag: newFlag, is_calculated: p.is_calculated, is_outsourced: tg.isOutsourced,
            outsource_lab_name: tg.labName,
            note: newNote,
            test_note: newTestNote,
          });
          nextSavedOverrides[key] = { value: newValue || "", unit: newUnit || "", ref: newRefRange || "", flag: newFlag || "", note: newNote, testNote: newTestNote };
        }

        if (tg.snipUrls.length > 0) {
          allSnipUrls.push(...tg.snipUrls);
          if (tg.params.length === 0) {
            allTestResults.push({
              test_id: tg.testId, test_name: tg.testName,
              is_outsourced: true, outsource_lab_name: tg.labName,
              test_note: newTestNote,
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

      await Promise.all([
        qc.invalidateQueries({ queryKey: ["modified_approval_reports"] }),
        qc.invalidateQueries({ queryKey: ["modified_approval_results"] }),
        qc.invalidateQueries({ queryKey: ["modified_approval_snips"] }),
        qc.invalidateQueries({ queryKey: ["dispatch_"] }),
      ]);

      setSavedOverrides(prev => ({ ...prev, ...nextSavedOverrides }));
      toast.success(`Changes saved for ${patientDisplayName(report)}`);
      // Clear edited state only after the reloaded patient_results rows are back.
      // Synthetic rows (like BT entered first) otherwise fall back to their old
      // empty p.result_value and appear blank until a manual refresh.
      const prefix = `${regId}||`;
      setEditedValues(prev => { const n = { ...prev }; Object.keys(n).filter(k => k.startsWith(prefix)).forEach(k => delete n[k]); return n; });
      setEditedUnits(prev => { const n = { ...prev }; Object.keys(n).filter(k => k.startsWith(prefix)).forEach(k => delete n[k]); return n; });
      setEditedRefRanges(prev => { const n = { ...prev }; Object.keys(n).filter(k => k.startsWith(prefix)).forEach(k => delete n[k]); return n; });
      setEditedFlags(prev => { const n = { ...prev }; Object.keys(n).filter(k => k.startsWith(prefix)).forEach(k => delete n[k]); return n; });
      setEditedNotes(prev => { const n = { ...prev }; Object.keys(n).filter(k => k.startsWith(prefix)).forEach(k => delete n[k]); return n; });
      setEditedTestNotes(prev => { const n = { ...prev }; Object.keys(n).filter(k => k.startsWith(prefix)).forEach(k => delete n[k]); return n; });
    } catch (err: any) { toast.error(err.message || "Save failed"); }
    finally { setActionKey(null); }
  };

  const hasEdits = (regId: string) => {
    const prefix = `${regId}||`;
    return Object.keys(editedValues).some(k => k.startsWith(prefix)) ||
      Object.keys(editedUnits).some(k => k.startsWith(prefix)) ||
      Object.keys(editedRefRanges).some(k => k.startsWith(prefix)) ||
      Object.keys(editedFlags).some(k => k.startsWith(prefix)) ||
      Object.keys(editedNotes).some(k => k.startsWith(prefix)) ||
      Object.keys(editedTestNotes).some(k => k.startsWith(prefix));
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
                        {patientDisplayName(report)}
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
                          <div className="px-3 py-2 bg-muted/40">
                            <div className="flex items-center justify-between">
                               <div className="flex items-center gap-2">
                                {(() => {
                                  const hasNegative = tg.params.some((p: any) => {
                                    const k = `${report.registration_id}||${p.parameter_id}`;
                                    const v = editedValues[k] !== undefined ? editedValues[k] : (p.result_value || "");
                                    return isSuspectNegativeResult(v);
                                  });
                                  return (
                                    <>
                                      <span className={`text-sm font-medium ${hasNegative ? "text-red-600 font-bold" : ""}`}>{tg.testName}</span>
                                      {hasNegative && (
                                        <Badge className="text-[10px] bg-red-600 text-white hover:bg-red-700 gap-0.5">
                                          <AlertTriangle className="h-3 w-3" /> Negative value — please verify
                                        </Badge>
                                      )}
                                    </>
                                  );
                                })()}
                                {tg.isOutsourced && tg.labName && (
                                  <Badge variant="outline" className="text-[10px] text-green-600 border-green-300">{tg.labName}</Badge>
                                )}
                                {(() => {
                                  const tnKey = `${report.registration_id}||${tg.testId}`;
                                  const tnVal = getTestNote(report.registration_id, tg.testId);
                                  return (
                                    <StickyNote
                                      className={`inline h-3.5 w-3.5 cursor-pointer shrink-0 ${tnVal ? 'text-amber-600' : 'text-muted-foreground hover:text-primary'}`}
                                      onClick={() => {
                                        if (activeTestNoteKey === tnKey) { setActiveTestNoteKey(null); }
                                        else {
                                          setActiveTestNoteKey(tnKey);
                                          if (!tnVal) setEditedTestNotes(prev => ({ ...prev, [tnKey]: "Kindly correlate clinically" }));
                                        }
                                      }}
                                    />
                                  );
                                })()}
                              </div>
                              {tg.snipUrls.length > 0 && (
                                <Button size="sm" variant="outline" className="h-6 text-xs gap-1" onClick={() => setViewSnipImages(tg.snipUrls)}>
                                  <Eye className="h-3 w-3" /> View Snip ({tg.snipUrls.length})
                                </Button>
                              )}
                            </div>
                            {(() => {
                              const tnKey = `${report.registration_id}||${tg.testId}`;
                              const tnVal = getTestNote(report.registration_id, tg.testId);
                              if (activeTestNoteKey === tnKey) {
                                return (
                                  <div className="flex items-center gap-1 mt-1">
                                    <Input value={tnVal} onChange={e => setEditedTestNotes(prev => ({ ...prev, [tnKey]: e.target.value }))} className="h-6 text-xs w-full" placeholder="Kindly correlate clinically" autoFocus />
                                    <Trash2 className="h-3.5 w-3.5 text-destructive cursor-pointer shrink-0" onClick={() => { setEditedTestNotes(prev => ({ ...prev, [tnKey]: "" })); setActiveTestNoteKey(null); }} />
                                  </div>
                                );
                              }
                              if (tnVal) {
                                return (
                                  <div className="flex items-center gap-1 mt-0.5">
                                    <div className="text-xs font-bold text-amber-700 cursor-pointer" onClick={() => setActiveTestNoteKey(tnKey)}>📝 {tnVal}</div>
                                    <Trash2 className="h-3 w-3 text-destructive/60 hover:text-destructive cursor-pointer shrink-0" onClick={() => setEditedTestNotes(prev => ({ ...prev, [tnKey]: "" }))} />
                                  </div>
                                );
                              }
                              return null;
                            })()}
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
                                  const saved = savedOverrides[key];
                                  const currentValue = editedValues[key] !== undefined ? editedValues[key] : (saved?.value ?? p.result_value ?? "");
                                  const currentUnit = editedUnits[key] !== undefined ? editedUnits[key] : (saved?.unit ?? p.unit ?? "");
                                  const currentRef = editedRefRanges[key] !== undefined ? editedRefRanges[key] : (saved?.ref ?? p.reference_range ?? "");
                                  const rangeMeta = resolveRangeMeta(p.parameter_id);
                                  const autoFlag = calculateFlag(currentValue, p.normal_range_low, p.normal_range_high, rangeMeta.rangeType, undefined, undefined, rangeMeta.normalRangeText);
                                  const currentFlag = editedFlags[key] !== undefined ? editedFlags[key] : (saved?.flag || p.flag || autoFlag);
                                  const isNegative = isSuspectNegativeResult(currentValue);
                                  const rowBg = isNegative
                                    ? "bg-red-50"
                                    : ((rangeMeta.rangeType !== "undefined") && (currentFlag === "H" || currentFlag === "L" || currentFlag === "A" || currentFlag === "X") ? "bg-destructive/5" : "");
                                  const negCls = isNegative ? "border-red-500 ring-1 ring-red-300 text-red-700 font-semibold" : "";

                                  // Check if calculated
                                  const testParams = testParamsMap[p.test_id] || [];
                                  const tp = testParams.find((t: any) => t.parameter_id === p.parameter_id);
                                  const isCalc = tp?.report_test_parameters?.is_calculated || false;

                                  return (
                                    <TableRow key={key} className={rowBg}>
                                      <TableCell className="py-1.5 text-xs font-mono text-muted-foreground">{p.param_code}</TableCell>
                                      <TableCell className="py-1.5 text-sm font-medium">
                                        <div className="flex items-center gap-1 flex-wrap">
                                          <span>{p.parameter_name}</span>
                                          {isCalc && <Calculator className="inline h-3 w-3 ml-1 text-primary" />}
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
                                      <TableCell className="py-1.5">
                                        {isCalc ? (
                                          <div className="flex items-center gap-1"><Input value={currentValue} onChange={e => handleValueChange(report.registration_id, p.parameter_id, e.target.value, tg.params)} className={`h-7 text-sm w-[120px] font-mono ${negCls}`} placeholder="Auto" /><Button type="button" variant="ghost" size="icon" className="h-7 w-7" title="Recalculate" onClick={() => { if (!p.calculation_formula) return; const paramValues: Record<string, string> = {}; tg.params.forEach((ep: any) => { const k = `${report.registration_id}::${ep.parameter_id}`; paramValues[ep.parameter_id] = editedValues[k] ?? ep.result_value ?? ""; }); const result = evaluateFormula(p.calculation_formula, paramValues); if (result) handleValueChange(report.registration_id, p.parameter_id, result, tg.params); }}><Calculator className="h-3 w-3 text-primary" /></Button></div>
                                        ) : rangeMeta.rangeType === "time" ? (
                                          <TimeResultInput value={currentValue} onChange={(v) => handleValueChange(report.registration_id, p.parameter_id, v, tg.params)} abnormal={currentFlag === "H" || currentFlag === "L" || currentFlag === "A"} />
                                        ) : (
                                          <Input value={currentValue} onChange={e => handleValueChange(report.registration_id, p.parameter_id, e.target.value, tg.params)} className={`h-7 text-sm w-[160px] ${isNegative ? "border-red-500 ring-1 ring-red-300 text-red-700 font-semibold" : ((currentFlag === "H" || currentFlag === "L" || currentFlag === "A") ? "border-destructive text-destructive font-bold" : "")}`} />
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
                <div className="text-muted-foreground pt-1">The sum of WBC differential parameters should be exactly 100. You can continue saving anyway.</div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => {
              if (diffConfirm) {
                const { report, testGroups } = diffConfirm;
                setDiffConfirm(null);
                saveChanges(report, testGroups, true);
              }
            }}>Continue Anyway</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <PaginatedTableFooter page={page} pageSize={PAGE_SIZE} total={totalReports} onPageChange={setPage} />
    </div>
  );
};

export default ModifiedApproval;
