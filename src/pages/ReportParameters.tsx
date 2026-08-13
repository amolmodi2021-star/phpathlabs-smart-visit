import { useState, useEffect, useCallback } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2, Loader2, Search, Download, Upload, X } from "lucide-react";
import DeletePasswordDialog from "@/components/DeletePasswordDialog";
import { exportToExcel, parseExcelFile } from "@/lib/excel";
import ExportPasswordDialog from "@/components/ExportPasswordDialog";
import MasterLookupSelect from "@/components/MasterLookupSelect";
import { secondsToMinSec, minSecToSeconds, formatTimeRange } from "@/lib/timeRange";
import { MASTER_LIST_PAGE_SIZE, pageRange, sanitizeIlike } from "@/lib/masterListPaging";
import PaginatedTableFooter from "@/components/ui/PaginatedTableFooter";

const PAGE_SIZE = MASTER_LIST_PAGE_SIZE;
const PARAM_LIST_COLUMNS =
  "id, param_code, parameter_name, unit, send_for_interface, is_calculated, use_global_normal_range, store_for_analytics, is_active";

const QUALITATIVE_PAIRS = [
  { label: "Absent / Present", values: ["Absent", "Present"] },
  { label: "Reactive / Non Reactive", values: ["Reactive", "Non Reactive"] },
  { label: "Positive / Negative", values: ["Positive", "Negative"] },
];

interface NormalRange {
  id?: string;
  gender: string;
  age_min: number | null;
  age_max: number | null;
  normal_range_low: number | null;
  normal_range_high: number | null;
  normal_range_text: string;
  range_type: string;
  expected_value: string;
  /** Descriptive: acceptable result text(s) for highlight only (not shown on report). */
  normal_findings: string;
  descriptive_options: string[];
  advisory_range?: boolean;
}

// No default age groups — users set ranges manually

const ReportParameters = ({ embedded }: { embedded?: boolean }) => {
  const [params, setParams] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [page, setPage] = useState(0);
  const [showInactive, setShowInactive] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [exportPwdOpen, setExportPwdOpen] = useState(false);
  const [deletePwdOpen, setDeletePwdOpen] = useState(false);
  const [deleteAllPwdOpen, setDeleteAllPwdOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [editId, setEditId] = useState<string | null>(null);
  const [editParamCode, setEditParamCode] = useState("");
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    parameter_name: "",
    parameter_description: "",
    unit: "",
    store_for_analytics: false,
    use_global_normal_range: false,
    same_for_gender: true,
    same_for_all_ages: true,
    normal_range_text: "",
    machine_name: "",
    machine_id: "",
    send_for_interface: true,
    is_calculated: false,
    calculation_formula: [] as { type: string; parameter_id: string; parameter_name: string; operator: string; fixed_value: string }[],
    unit_conversion_enabled: false,
    unit_conversion_operator: "*",
    unit_conversion_value: "",
    is_active: true,
    custom_sample_suffix_enabled: false,
    custom_sample_suffix: "",
  });

  const [normalRanges, setNormalRanges] = useState<NormalRange[]>([]);

  const { toast } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    const { from, to } = pageRange({ page, pageSize: PAGE_SIZE });
    let q = supabase
      .from("report_test_parameters")
      .select(PARAM_LIST_COLUMNS, { count: "exact" })
      .order("parameter_name");
    if (!showInactive) q = q.or("is_active.is.null,is_active.eq.true");
    const term = sanitizeIlike(appliedSearch);
    if (term) q = q.or(`parameter_name.ilike.%${term}%,param_code.ilike.%${term}%`);
    const { data: p, count, error } = await q.range(from, to);
    if (error) {
      toast({ title: "Failed to load parameters", description: error.message, variant: "destructive" });
      setParams([]);
      setTotal(0);
    } else {
      setParams(p || []);
      setTotal(count ?? 0);
    }
    setLoading(false);
  }, [appliedSearch, page, showInactive, toast]);

  useEffect(() => { load(); }, [load]);

  const runSearch = () => {
    setPage(0);
    setAppliedSearch(search.trim());
  };

  const clearSearch = () => {
    setSearch("");
    setAppliedSearch("");
    setPage(0);
  };

  // Build normal ranges based on toggles
  const buildRangesFromToggles = useCallback(() => {
    const { same_for_gender, same_for_all_ages } = form;
    const genders = same_for_gender ? ["all"] : ["male", "female"];

    if (same_for_all_ages) {
      // Collapse to single "all ages" per gender
      const newRanges: NormalRange[] = [];
      for (const gender of genders) {
        const existing = normalRanges.find(r => r.gender === gender && r.age_min === null && r.age_max === null);
        newRanges.push({
          id: existing?.id, gender, age_min: null, age_max: null,
          normal_range_low: existing?.normal_range_low ?? null,
          normal_range_high: existing?.normal_range_high ?? null,
          normal_range_text: existing?.normal_range_text ?? "",
          range_type: existing?.range_type ?? "numeric",
          expected_value: existing?.expected_value ?? "",
          normal_findings: existing?.normal_findings ?? "",
          descriptive_options: existing?.descriptive_options ?? [],
        });
      }
      setNormalRanges(newRanges);
    } else {
      // When switching to age-specific, keep existing age ranges per gender or seed defaults
      const newRanges: NormalRange[] = [];
      for (const gender of genders) {
        const existingForGender = normalRanges.filter(r => r.gender === gender && r.age_min !== null);
        if (existingForGender.length > 0) {
          newRanges.push(...existingForGender);
        } else {
          // Seed with one default range
          newRanges.push({ gender, age_min: 0, age_max: 150, normal_range_low: null, normal_range_high: null, normal_range_text: "", range_type: "numeric", expected_value: "", normal_findings: "", descriptive_options: [] });
        }
      }
      setNormalRanges(newRanges);
    }
  }, [form.same_for_gender, form.same_for_all_ages]);

  useEffect(() => {
    if (dialogOpen) {
      buildRangesFromToggles();
    }
  }, [form.same_for_gender, form.same_for_all_ages, dialogOpen]);

  const loadNormalRanges = async (parameterId: string) => {
    const { data } = await supabase
      .from("parameter_normal_ranges")
      .select("*")
      .eq("parameter_id", parameterId)
      .order("gender")
      .order("age_min");
    if (data && data.length > 0) {
      setNormalRanges(data.map((r: any) => {
        const rangeType = r.range_type || "numeric";
        const text = r.normal_range_text || "";
        const isAdvisory = rangeType === "numeric" && text.includes("\n");
        return {
          id: r.id,
          gender: r.gender,
          age_min: r.age_min,
          age_max: r.age_max,
          normal_range_low: r.normal_range_low,
          normal_range_high: r.normal_range_high,
          normal_range_text: text,
          range_type: rangeType,
          expected_value: r.expected_value || "",
          normal_findings: r.normal_findings || "",
          descriptive_options: Array.isArray(r.descriptive_options) ? r.descriptive_options : [],
          advisory_range: isAdvisory,
        };
      }));
    }
  };

  const handleSave = async () => {
    if (!form.parameter_name.trim()) return;
    setSaving(true);
    try {
      const payload: any = {
        parameter_name: form.parameter_name,
        parameter_description: form.parameter_description?.trim() || null,
        unit: form.unit || null,
        store_for_analytics: form.store_for_analytics,
        use_global_normal_range: form.use_global_normal_range,
        same_for_gender: form.same_for_gender,
        same_for_all_ages: form.same_for_all_ages,
        normal_range_text: form.normal_range_text || null,
        machine_name: form.machine_name || null,
        machine_id: form.machine_id || null,
        send_for_interface: form.send_for_interface,
        is_calculated: form.is_calculated,
        calculation_formula: form.is_calculated ? form.calculation_formula : [],
        unit_conversion_enabled: form.unit_conversion_enabled,
        unit_conversion_operator: form.unit_conversion_operator,
        unit_conversion_value: form.unit_conversion_value ? Number(form.unit_conversion_value) : null,
        is_active: form.is_active,
        custom_sample_suffix_enabled: form.custom_sample_suffix_enabled,
        custom_sample_suffix: form.custom_sample_suffix_enabled ? (form.custom_sample_suffix || null) : null,
      };

      let paramId = editId;
      if (editId) {
        await supabase.from("report_test_parameters").update(payload).eq("id", editId);
      } else {
        const { data } = await supabase.from("report_test_parameters").insert(payload).select("id").single();
        paramId = data?.id;
      }

      // Save normal ranges
      if (paramId) {
        await supabase.from("parameter_normal_ranges").delete().eq("parameter_id", paramId);
        if (normalRanges.length > 0) {
          const rangeInserts = normalRanges.map(r => {
            const isUndef = r.range_type === "undefined";
            const isDesc = r.range_type === "descriptive";
            return {
              parameter_id: paramId!,
              gender: r.gender,
              age_min: r.age_min,
              age_max: r.age_max,
              normal_range_low: (r.range_type === "numeric" || r.range_type === "time") ? r.normal_range_low : null,
              normal_range_high: (r.range_type === "numeric" || r.range_type === "time") ? r.normal_range_high : null,
              normal_range_text: r.normal_range_text || null,
              range_type: r.range_type || "numeric",
              expected_value: r.range_type === "qualitative" ? (r.expected_value || null) : null,
              normal_findings: isDesc ? (r.normal_findings || null) : null,
              descriptive_options: (isDesc || isUndef) ? (r.descriptive_options?.filter(o => o.trim()) || []) : [],
            };
          });
          await supabase.from("parameter_normal_ranges").insert(rangeInserts);
        }
      }

      setDialogOpen(false);
      setEditId(null);
      load();
      toast({ title: editId ? "Parameter updated" : "Parameter added" });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
    setSaving(false);
  };

  const handleEdit = async (p: any) => {
    setEditId(p.id);
    setEditParamCode(p.param_code || "");
    setNormalRanges([]);
    setDialogOpen(true);
    const { data: full, error } = await supabase.from("report_test_parameters").select("*").eq("id", p.id).maybeSingle();
    if (error || !full) {
      toast({ title: "Failed to load parameter", description: error?.message, variant: "destructive" });
      return;
    }
    setEditParamCode(full.param_code || "");
    setForm({
      parameter_name: full.parameter_name,
      parameter_description: full.parameter_description || "",
      unit: full.unit || "",
      store_for_analytics: full.store_for_analytics || false,
      use_global_normal_range: full.use_global_normal_range || false,
      same_for_gender: full.same_for_gender !== false,
      same_for_all_ages: full.same_for_all_ages !== false,
      normal_range_text: full.normal_range_text || "",
      machine_name: full.machine_name || "",
      machine_id: full.machine_id || "",
      send_for_interface: full.send_for_interface !== false,
      is_calculated: full.is_calculated || false,
      calculation_formula: Array.isArray(full.calculation_formula) ? full.calculation_formula : [],
      unit_conversion_enabled: full.unit_conversion_enabled || false,
      unit_conversion_operator: full.unit_conversion_operator || "*",
      unit_conversion_value: full.unit_conversion_value != null ? String(full.unit_conversion_value) : "",
      is_active: full.is_active !== false,
      custom_sample_suffix_enabled: full.custom_sample_suffix_enabled || false,
      custom_sample_suffix: full.custom_sample_suffix || "",
    });
    await loadNormalRanges(full.id);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this parameter?")) return;
    await supabase.from("report_test_parameters").delete().eq("id", id);
    setSelectedIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
    load();
  };

  const handleDeleteSelected = async () => {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    for (let i = 0; i < ids.length; i += 50) {
      await supabase.from("report_test_parameters").delete().in("id", ids.slice(i, i + 50));
    }
    setSelectedIds(new Set());
    load();
    toast({ title: `${ids.length} parameters deleted` });
  };

  const handleDeleteAll = async () => {
    const { data: allRows, error } = await supabase.from("report_test_parameters").select("id");
    if (error) {
      toast({ title: "Failed to load parameters for delete", description: error.message, variant: "destructive" });
      return;
    }
    const ids = (allRows || []).map((p) => p.id);
    if (!ids.length) return;
    for (let i = 0; i < ids.length; i += 50) {
      await supabase.from("report_test_parameters").delete().in("id", ids.slice(i, i + 50));
    }
    setSelectedIds(new Set());
    load();
    toast({ title: "All parameters deleted" });
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === params.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(params.map((p) => p.id)));
    }
  };

  const handleExport = async () => {
    const { data: all, error } = await supabase
      .from("report_test_parameters")
      .select("param_code, parameter_name, parameter_description, unit, store_for_analytics, use_global_normal_range, normal_range_text")
      .order("parameter_name");
    if (error) {
      toast({ title: "Export failed", description: error.message, variant: "destructive" });
      return;
    }
    const rows = (all || []).map((p) => ({
      "Param Code": p.param_code || "",
      "Parameter Name": p.parameter_name || "",
      "Description": p.parameter_description || "",
      "Unit": p.unit || "",
      "Store for Analytics": p.store_for_analytics ? "Yes" : "No",
      "Global Normal Range": p.use_global_normal_range ? "Yes" : "No",
      "Normal Range Text": p.normal_range_text || "",
    }));
    exportToExcel(rows, "test_parameters_export");
    toast({ title: "Exported successfully" });
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const rows = await parseExcelFile(file);
      if (!rows.length) { toast({ title: "Empty file", variant: "destructive" }); return; }
      const inserts = rows.map((r: any) => ({
        parameter_name: r["Parameter Name"] || "",
        parameter_description: r["Description"] || null,
        unit: r["Unit"] || null,
        store_for_analytics: (r["Store for Analytics"] || "").toString().toLowerCase() === "yes",
        use_global_normal_range: (r["Global Normal Range"] || "").toString().toLowerCase() === "yes",
        normal_range_text: r["Normal Range Text"] || null,
      })).filter((r: any) => r.parameter_name);

      if (!inserts.length) { toast({ title: "No valid rows found", variant: "destructive" }); return; }
      const { error } = await supabase.from("report_test_parameters").insert(inserts);
      if (error) throw error;
      toast({ title: `${inserts.length} parameters imported` });
      load();
    } catch (err: any) {
      toast({ title: "Import failed", description: err.message, variant: "destructive" });
    }
    e.target.value = "";
  };

  const openNew = () => {
    setEditId(null);
    setEditParamCode("");
    setForm({
      parameter_name: "", parameter_description: "", unit: "", store_for_analytics: false,
      use_global_normal_range: false, same_for_gender: true, same_for_all_ages: true,
      normal_range_text: "", machine_name: "", machine_id: "",
      send_for_interface: true, is_calculated: false, calculation_formula: [],
      unit_conversion_enabled: false, unit_conversion_operator: "*", unit_conversion_value: "",
      is_active: true, custom_sample_suffix_enabled: false, custom_sample_suffix: "",
    });
    setNormalRanges([]);
    setDialogOpen(true);
  };

  const updateRange = (index: number, field: keyof NormalRange, value: any) => {
    setNormalRanges(prev => prev.map((r, i) => {
      if (i !== index) return r;
      const updated = { ...r, [field]: value };
      // Auto-fill display text when low/high changes for numeric ranges (skip if advisory mode)
      if ((field === "normal_range_low" || field === "normal_range_high") && (updated.range_type || "numeric") === "numeric" && !updated.advisory_range) {
        const low = field === "normal_range_low" ? value : updated.normal_range_low;
        const high = field === "normal_range_high" ? value : updated.normal_range_high;
        const unit = form.unit || "";
        if (low !== null && low !== "" && high !== null && high !== "") {
          updated.normal_range_text = `${low} - ${high} ${unit}`.trim();
        } else if (low !== null && low !== "") {
          updated.normal_range_text = `> ${low} ${unit}`.trim();
        } else if (high !== null && high !== "") {
          updated.normal_range_text = `< ${high} ${unit}`.trim();
        }
      }
      return updated;
    }));
  };

  const addAgeRange = (gender: string) => {
    setNormalRanges(prev => [...prev, {
      gender, age_min: 0, age_max: 150,
      normal_range_low: null, normal_range_high: null, normal_range_text: "",
      range_type: "numeric", expected_value: "", normal_findings: "", descriptive_options: [],
    }]);
  };

  const removeAgeRange = (index: number) => {
    setNormalRanges(prev => prev.filter((_, i) => i !== index));
  };

  const getGenderLabel = (g: string) => g === "all" ? "All" : g === "male" ? "Male" : "Female";

  return (
    <div className={embedded ? "space-y-4" : "max-w-6xl mx-auto space-y-6"}>
      <div className="flex items-center justify-between flex-wrap gap-2">
        {!embedded && <h1 className="text-2xl font-bold">Test Parameter Management</h1>}
        <div className="flex gap-2 flex-wrap">
          {selectedIds.size > 0 && (
            <Button variant="destructive" onClick={() => setDeletePwdOpen(true)}>
              <Trash2 className="h-4 w-4 mr-2" />Delete Selected ({selectedIds.size})
            </Button>
          )}
          <Button variant="outline" className="text-destructive border-destructive" onClick={() => setDeleteAllPwdOpen(true)}>
            <Trash2 className="h-4 w-4 mr-2" />Delete All
          </Button>
          <Button variant="outline" onClick={() => setExportPwdOpen(true)}>
            <Download className="h-4 w-4 mr-2" />Export
          </Button>
          <Button variant="outline" asChild>
            <label className="cursor-pointer">
              <Upload className="h-4 w-4 mr-2" />Import
              <input type="file" accept=".xlsx,.xls" className="hidden" onChange={handleImport} />
            </label>
          </Button>
          <Button onClick={openNew}><Plus className="h-4 w-4 mr-2" />Add Parameter</Button>
        </div>
      </div>

      <ExportPasswordDialog open={exportPwdOpen} onOpenChange={setExportPwdOpen} onSuccess={handleExport} />

      <Card>
        <CardContent className="pt-6">
          <div className="mb-4 flex items-center gap-4 flex-wrap">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search parameters..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); runSearch(); } }}
                className="pl-8 max-w-sm"
              />
            </div>
            <Button size="sm" onClick={runSearch}>Search</Button>
            {appliedSearch && (
              <Button variant="ghost" size="sm" onClick={clearSearch}><X className="h-4 w-4 mr-1" />Clear</Button>
            )}
            <div className="flex items-center gap-2">
              <Switch checked={showInactive} onCheckedChange={(v) => { setShowInactive(v); setPage(0); }} />
              <Label className="text-sm whitespace-nowrap">Show Inactive</Label>
            </div>
          </div>
          {loading ? <div className="flex justify-center p-8"><Loader2 className="h-6 w-6 animate-spin" /></div> : (
            <div className="overflow-x-auto">
              <Table>
                 <TableHeader>
                  <TableRow>
                     <TableHead className="w-[40px]">
                      <Checkbox checked={params.length > 0 && selectedIds.size === params.length} onCheckedChange={toggleSelectAll} />
                     </TableHead>
                     <TableHead>Code</TableHead>
                     <TableHead>Parameter</TableHead>
                     <TableHead>Unit</TableHead>
                     <TableHead>Interface</TableHead>
                     <TableHead>Calculated</TableHead>
                     <TableHead>Global Range</TableHead>
                     <TableHead>Analytics</TableHead>
                     <TableHead>Status</TableHead>
                     <TableHead className="w-[80px]">Actions</TableHead>
                  </TableRow>
                 </TableHeader>
                 <TableBody>
                  {params.map((p) => (
                     <TableRow key={p.id} className={`${selectedIds.has(p.id) ? "bg-muted/50" : ""} ${p.is_active === false ? "opacity-60" : ""}`}>
                      <TableCell><Checkbox checked={selectedIds.has(p.id)} onCheckedChange={() => toggleSelect(p.id)} /></TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">{p.param_code || "-"}</TableCell>
                      <TableCell className="font-medium">{p.parameter_name}</TableCell>
                      <TableCell>{p.unit || "-"}</TableCell>
                      <TableCell>{p.send_for_interface !== false ? <Badge className="bg-emerald-100 text-emerald-800">AUTO</Badge> : <Badge variant="secondary">MANUAL</Badge>}</TableCell>
                      <TableCell>{p.is_calculated ? <Badge className="bg-purple-100 text-purple-800">CALC</Badge> : <span className="text-muted-foreground">-</span>}</TableCell>
                      <TableCell>{p.use_global_normal_range ? <Badge className="bg-blue-100 text-blue-800">ON</Badge> : <Badge variant="secondary">OFF</Badge>}</TableCell>
                      <TableCell>{p.store_for_analytics ? <Badge className="bg-green-100 text-green-800">YES</Badge> : <Badge variant="secondary">NO</Badge>}</TableCell>
                      <TableCell>{p.is_active !== false ? <Badge className="bg-emerald-100 text-emerald-800">Active</Badge> : <Badge variant="destructive">Inactive</Badge>}</TableCell>
                      <TableCell>
                         <div className="flex gap-1">
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleEdit(p)}><Pencil className="h-3 w-3" /></Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleDelete(p.id)}><Trash2 className="h-3 w-3" /></Button>
                         </div>
                      </TableCell>
                     </TableRow>
                  ))}
                  {params.length === 0 && <TableRow><TableCell colSpan={10} className="text-center py-8 text-muted-foreground">No parameters found</TableCell></TableRow>}
                 </TableBody>
              </Table>
              <PaginatedTableFooter page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editId ? "Edit" : "Add"} Test Parameter</DialogTitle></DialogHeader>
          <div className="space-y-4">
            {editId && (
              <div>
                <Label className="text-muted-foreground text-xs">Param Code (auto-generated)</Label>
                <Input value={editParamCode} disabled className="font-mono" />
              </div>
            )}
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Parameter Name *</Label><Input value={form.parameter_name} onChange={(e) => setForm({ ...form, parameter_name: e.target.value })} /></div>
              <div><Label>Unit</Label><MasterLookupSelect category="unit" value={form.unit} onChange={(v) => setForm({ ...form, unit: v })} placeholder="Select unit" /></div>
            </div>

            <div>
              <Label>Description (shown below parameter name on report)</Label>
              <Textarea
                value={form.parameter_description}
                onChange={(e) => setForm({ ...form, parameter_description: e.target.value })}
                placeholder="e.g. Used to assess cardiovascular risk."
                rows={2}
              />
              <p className="text-xs text-muted-foreground mt-1">Keep it short — one short line.</p>
            </div>

            <div className="flex items-center gap-2">
              <Checkbox checked={form.store_for_analytics} onCheckedChange={(c) => setForm({ ...form, store_for_analytics: !!c })} />
              <Label>Store for Analytics (include in historical trends)</Label>
            </div>

            <div className="flex items-center justify-between">
              <Label>Active</Label>
              <Switch checked={form.is_active} onCheckedChange={(v) => setForm({ ...form, is_active: v })} />
            </div>

            <Separator />

            {/* Interface & Machine Mapping */}
            <div className="space-y-3">
              <h3 className="font-semibold text-base">Interface Settings</h3>
              <div className="flex items-center justify-between">
                <Label>Send for Interfacing (auto result from machine)</Label>
                <Switch checked={form.send_for_interface} onCheckedChange={(v) => setForm({ ...form, send_for_interface: v })} />
              </div>
              {form.send_for_interface && (
                <div className="grid grid-cols-2 gap-3">
                  <div><Label className="text-sm">Machine Name</Label><MasterLookupSelect category="machine_name" value={form.machine_name} onChange={(v) => setForm({ ...form, machine_name: v })} onMappedValue={(v) => setForm(prev => ({ ...prev, machine_id: v }))} placeholder="Select machine" /></div>
                  <div><Label className="text-sm">Machine ID</Label><Input value={form.machine_id} onChange={(e) => setForm({ ...form, machine_id: e.target.value })} placeholder="Auto-filled or enter manually" /></div>
                </div>
              )}

              {/* Custom Sample ID Suffix */}
              <div className="flex items-center justify-between">
                <Label>Custom Sample ID Suffix</Label>
                <Switch checked={form.custom_sample_suffix_enabled} onCheckedChange={(v) => setForm({ ...form, custom_sample_suffix_enabled: v })} />
              </div>
              {form.custom_sample_suffix_enabled && (
                <div className="flex items-center gap-3 bg-muted/40 rounded-md p-3">
                  <span className="text-sm text-muted-foreground whitespace-nowrap">Sample ID will be:</span>
                  <span className="text-sm font-mono font-medium">INV######</span>
                  <Input
                    className="w-28"
                    value={form.custom_sample_suffix}
                    onChange={(e) => setForm({ ...form, custom_sample_suffix: e.target.value })}
                    placeholder="e.g. -F, -P"
                  />
                  {form.custom_sample_suffix && (
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      e.g. 2604080001{form.custom_sample_suffix}
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Unit Conversion */}
            {form.send_for_interface && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-base">Unit Conversion</h3>
                  <Switch checked={form.unit_conversion_enabled} onCheckedChange={(v) => setForm({ ...form, unit_conversion_enabled: v })} />
                </div>
                <p className="text-xs text-muted-foreground">Convert machine result value to the required unit before storing.</p>
                {form.unit_conversion_enabled && (
                  <div className="flex items-center gap-3 bg-muted/40 rounded-md p-3">
                    <span className="text-sm font-medium whitespace-nowrap">Result Value</span>
                    <Select value={form.unit_conversion_operator} onValueChange={(v) => setForm({ ...form, unit_conversion_operator: v })}>
                      <SelectTrigger className="w-20 h-9"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="*">×</SelectItem>
                        <SelectItem value="/">÷</SelectItem>
                      </SelectContent>
                    </Select>
                    <Input
                      type="number"
                      className="w-32"
                      value={form.unit_conversion_value}
                      onChange={(e) => setForm({ ...form, unit_conversion_value: e.target.value })}
                      placeholder="e.g. 1000"
                    />
                    {form.unit_conversion_value && (
                      <span className="text-xs text-muted-foreground whitespace-nowrap">
                        Preview: Result {form.unit_conversion_operator === "*" ? "×" : "÷"} {form.unit_conversion_value}
                      </span>
                    )}
                  </div>
                )}
              </div>
            )}

            <Separator />

            {/* Calculated Parameter */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-base">Calculated Parameter</h3>
                <Switch checked={form.is_calculated} onCheckedChange={(v) => setForm({ ...form, is_calculated: v })} />
              </div>
              {form.is_calculated && (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">Build formula: select parameters and operators. The result will be computed automatically.</p>
                  {form.calculation_formula.map((item, idx) => {
                    const t = item.type || "parameter";
                    if (t === "bracket_open" || t === "bracket_close") {
                      return (
                        <div key={idx} className="flex items-center gap-2">
                          {idx > 0 && t !== "bracket_close" && form.calculation_formula[idx - 1]?.type !== "bracket_open" && (
                            <Select value={item.operator || "+"} onValueChange={(v) => {
                              const f = [...form.calculation_formula];
                              f[idx] = { ...f[idx], operator: v };
                              setForm({ ...form, calculation_formula: f });
                            }}>
                              <SelectTrigger className="w-20 h-8"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="+">+</SelectItem>
                                <SelectItem value="-">−</SelectItem>
                                <SelectItem value="*">×</SelectItem>
                                <SelectItem value="/">÷</SelectItem>
                              </SelectContent>
                            </Select>
                          )}
                          <span className="text-lg font-bold w-8 text-center">{t === "bracket_open" ? "(" : ")"}</span>
                          <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-destructive shrink-0" onClick={() => {
                            const f = form.calculation_formula.filter((_, i) => i !== idx);
                            setForm({ ...form, calculation_formula: f });
                          }}>
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      );
                    }
                    return (
                    <div key={idx} className="flex items-center gap-2">
                      {idx > 0 && form.calculation_formula[idx - 1]?.type !== "bracket_open" && (
                        <Select value={item.operator} onValueChange={(v) => {
                          const f = [...form.calculation_formula];
                          f[idx] = { ...f[idx], operator: v };
                          setForm({ ...form, calculation_formula: f });
                        }}>
                          <SelectTrigger className="w-20 h-8"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="+">+</SelectItem>
                            <SelectItem value="-">−</SelectItem>
                            <SelectItem value="*">×</SelectItem>
                            <SelectItem value="/">÷</SelectItem>
                          </SelectContent>
                        </Select>
                      )}
                      <Select value={t} onValueChange={(v) => {
                        const f = [...form.calculation_formula];
                        f[idx] = { ...f[idx], type: v, parameter_id: "", parameter_name: "", fixed_value: "" };
                        setForm({ ...form, calculation_formula: f });
                      }}>
                        <SelectTrigger className="w-28 h-8"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="parameter">Parameter</SelectItem>
                          <SelectItem value="fixed">Fixed Value</SelectItem>
                          <SelectItem value="bracket_open">( Open</SelectItem>
                          <SelectItem value="bracket_close">) Close</SelectItem>
                        </SelectContent>
                      </Select>
                      {t === "parameter" ? (
                        <Select value={item.parameter_id} onValueChange={(v) => {
                          const selected = params.find(p => p.id === v);
                          const f = [...form.calculation_formula];
                          f[idx] = { ...f[idx], parameter_id: v, parameter_name: selected?.parameter_name || "" };
                          setForm({ ...form, calculation_formula: f });
                        }}>
                          <SelectTrigger className="flex-1 h-8"><SelectValue placeholder="Select parameter" /></SelectTrigger>
                          <SelectContent>
                            {params.filter(p => p.id !== editId).map(p => (
                              <SelectItem key={p.id} value={p.id}>{p.parameter_name} ({p.param_code})</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : t === "fixed" ? (
                        <Input
                          type="number"
                          step="any"
                          className="flex-1 h-8"
                          placeholder="Enter fixed value"
                          value={item.fixed_value || ""}
                          onChange={(e) => {
                            const f = [...form.calculation_formula];
                            f[idx] = { ...f[idx], fixed_value: e.target.value };
                            setForm({ ...form, calculation_formula: f });
                          }}
                        />
                      ) : null}
                      <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-destructive shrink-0" onClick={() => {
                        const f = form.calculation_formula.filter((_, i) => i !== idx);
                        setForm({ ...form, calculation_formula: f });
                      }}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                    );
                  })}
                  <div className="flex gap-2 flex-wrap">
                    <Button type="button" variant="outline" size="sm" onClick={() => {
                      setForm({ ...form, calculation_formula: [...form.calculation_formula, { type: "parameter", parameter_id: "", parameter_name: "", operator: "+", fixed_value: "" }] });
                    }}>
                      <Plus className="h-3 w-3 mr-1" />Add Parameter
                    </Button>
                    <Button type="button" variant="outline" size="sm" onClick={() => {
                      setForm({ ...form, calculation_formula: [...form.calculation_formula, { type: "fixed", parameter_id: "", parameter_name: "", operator: "+", fixed_value: "" }] });
                    }}>
                      <Plus className="h-3 w-3 mr-1" />Add Fixed Value
                    </Button>
                    <Button type="button" variant="outline" size="sm" onClick={() => {
                      setForm({ ...form, calculation_formula: [...form.calculation_formula, { type: "bracket_open", parameter_id: "", parameter_name: "", operator: "", fixed_value: "" }] });
                    }}>
                      (
                    </Button>
                    <Button type="button" variant="outline" size="sm" onClick={() => {
                      setForm({ ...form, calculation_formula: [...form.calculation_formula, { type: "bracket_close", parameter_id: "", parameter_name: "", operator: "", fixed_value: "" }] });
                    }}>
                      )
                    </Button>
                  </div>
                  {form.calculation_formula.length > 0 && (
                    <div className="text-xs text-muted-foreground bg-muted p-2 rounded font-mono">
                      Formula: {form.calculation_formula.map((item, i) => {
                        const t = item.type || "parameter";
                        const prev = i > 0 ? (form.calculation_formula[i - 1]?.type || "parameter") : null;
                        if (t === "bracket_open") {
                          const op = i > 0 && prev !== "bracket_open" && item.operator ? ` ${item.operator} ` : "";
                          return `${op}(`;
                        }
                        if (t === "bracket_close") return ")";
                        const label = t === "fixed" ? (item.fixed_value || "?") : (item.parameter_name || "?");
                        const needsOp = i > 0 && prev !== "bracket_open" && t !== "bracket_close";
                        return `${needsOp ? ` ${item.operator} ` : ""}${label}`;
                      }).join("")}
                    </div>
                  )}
                </div>
              )}
            </div>

            <Separator />

            <div className="space-y-3">
              <h3 className="font-semibold text-base">Normal Range Settings</h3>

              <div className="flex items-center justify-between">
                <Label>Show Global Normal Range in Report</Label>
                <Switch checked={form.use_global_normal_range} onCheckedChange={(v) => setForm({ ...form, use_global_normal_range: v })} />
              </div>

              {form.use_global_normal_range && (
                <div>
                  <Label>Global Normal Range Display Text</Label>
                  <Input
                    value={form.normal_range_text}
                    onChange={(e) => setForm({ ...form, normal_range_text: e.target.value })}
                    placeholder="e.g. 4.0 - 11.0 x10^3/µL"
                  />
                </div>
              )}

              <Separator />

              <h4 className="font-medium text-sm">Age & Gender-wise Normal Ranges</h4>

              <div className="flex items-center justify-between">
                <Label>Same for Male and Female</Label>
                <Switch checked={form.same_for_gender} onCheckedChange={(v) => setForm({ ...form, same_for_gender: v })} />
              </div>

              <div className="flex items-center justify-between">
                <Label>Same for All Age Ranges</Label>
                <Switch checked={form.same_for_all_ages} onCheckedChange={(v) => setForm({ ...form, same_for_all_ages: v })} />
              </div>

              {/* Group ranges by gender */}
              {(form.same_for_gender ? ["all"] : ["male", "female"]).map(gender => {
                const genderRanges = normalRanges.map((r, idx) => ({ ...r, _idx: idx })).filter(r => r.gender === gender);
                return (
                  <div key={gender} className="space-y-2">
                    <div className="flex items-center justify-between">
                      <h5 className="text-sm font-semibold text-primary">{getGenderLabel(gender)}</h5>
                      {!form.same_for_all_ages && (
                        <Button type="button" variant="outline" size="sm" onClick={() => addAgeRange(gender)}>
                          <Plus className="h-3 w-3 mr-1" />Add Age Range
                        </Button>
                      )}
                    </div>
                    {genderRanges.map((r) => (
                      <div key={r._idx} className="border rounded-lg p-3 space-y-2 bg-muted/30">
                        {!form.same_for_all_ages && (
                          <div className="flex items-center gap-2">
                            <div className="flex items-center gap-1 flex-1">
                              <Label className="text-xs whitespace-nowrap">Age From</Label>
                              <Input type="number" className="h-7 w-20" value={r.age_min ?? ""} onChange={(e) => updateRange(r._idx, "age_min", e.target.value ? Number(e.target.value) : null)} />
                              <Label className="text-xs whitespace-nowrap">to</Label>
                              <Input type="number" className="h-7 w-20" value={r.age_max ?? ""} onChange={(e) => updateRange(r._idx, "age_max", e.target.value ? Number(e.target.value) : null)} />
                              <span className="text-xs text-muted-foreground">yr</span>
                            </div>
                            {genderRanges.length > 1 && (
                              <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => removeAgeRange(r._idx)}>
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            )}
                          </div>
                        )}
                        {form.same_for_all_ages && (
                          <div className="text-xs text-muted-foreground">All Ages</div>
                        )}
                        <div className="flex items-center gap-2 mb-1">
                          <Label className="text-xs whitespace-nowrap">Range Type</Label>
                          <Select value={r.range_type || "numeric"} onValueChange={(v) => updateRange(r._idx, "range_type", v)}>
                            <SelectTrigger className="h-7 w-36">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="numeric">Numeric</SelectItem>
                              <SelectItem value="qualitative">Qualitative</SelectItem>
                              <SelectItem value="descriptive">Descriptive</SelectItem>
                              <SelectItem value="time">Time (Min : Sec)</SelectItem>
                              <SelectItem value="undefined">Undefined</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        {(r.range_type || "numeric") === "numeric" ? (
                          <div className="space-y-2">
                            <div className="flex items-center gap-2">
                              <Checkbox
                                id={`advisory-${r._idx}`}
                                checked={!!r.advisory_range}
                                onCheckedChange={(checked) => updateRange(r._idx, "advisory_range", !!checked)}
                              />
                              <Label htmlFor={`advisory-${r._idx}`} className="text-xs cursor-pointer">Advisory Range (multi-category, e.g. HbA1c)</Label>
                            </div>
                            <div className={`grid ${r.advisory_range ? 'grid-cols-2' : 'grid-cols-3'} gap-2`}>
                              <div>
                                <Label className="text-xs">Low {r.advisory_range ? '(for flagging)' : ''}</Label>
                                <Input type="number" step="any" value={r.normal_range_low ?? ""} onChange={(e) => updateRange(r._idx, "normal_range_low", e.target.value ? Number(e.target.value) : null)} placeholder="Low" />
                              </div>
                              <div>
                                <Label className="text-xs">High {r.advisory_range ? '(for flagging)' : ''}</Label>
                                <Input type="number" step="any" value={r.normal_range_high ?? ""} onChange={(e) => updateRange(r._idx, "normal_range_high", e.target.value ? Number(e.target.value) : null)} placeholder="High" />
                              </div>
                              {!r.advisory_range && (
                                <div>
                                  <Label className="text-xs">Display Text</Label>
                                  <Input value={r.normal_range_text} onChange={(e) => updateRange(r._idx, "normal_range_text", e.target.value)} placeholder="e.g. 4.0-11.0" />
                                </div>
                              )}
                            </div>
                            {r.advisory_range && (
                              <div>
                                <Label className="text-xs">Display Text (multi-line for report)</Label>
                                <Textarea
                                  value={r.normal_range_text}
                                  onChange={(e) => updateRange(r._idx, "normal_range_text", e.target.value)}
                                  placeholder={"Non-Diabetic: < 5.7%\nPre-Diabetic: 5.7 - 6.4%\nDiabetic: ≥ 6.5%"}
                                  rows={3}
                                  className="text-sm"
                                />
                              </div>
                            )}
                          </div>
                        ) : r.range_type === "qualitative" ? (
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <Label className="text-xs">Expected Normal Value</Label>
                              <Select
                                value={r.expected_value || ""}
                                onValueChange={(val) => {
                                  updateRange(r._idx, "expected_value", val);
                                  const pair = QUALITATIVE_PAIRS.find(p => p.label === val);
                                  if (pair) {
                                    const currentDisplay = r.normal_range_text;
                                    if (!currentDisplay || !pair.values.includes(currentDisplay)) {
                                      updateRange(r._idx, "normal_range_text", pair.values[0]);
                                    }
                                  }
                                }}
                              >
                                <SelectTrigger><SelectValue placeholder="Select pair" /></SelectTrigger>
                                <SelectContent>
                                  {QUALITATIVE_PAIRS.map(p => (
                                    <SelectItem key={p.label} value={p.label}>{p.label}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div>
                              <Label className="text-xs">Display Text</Label>
                              {(() => {
                                const activePair = QUALITATIVE_PAIRS.find(p => p.label === r.expected_value);
                                const displayOptions = activePair ? activePair.values : [];
                                return (
                                  <Select
                                    value={r.normal_range_text || ""}
                                    onValueChange={(val) => updateRange(r._idx, "normal_range_text", val)}
                                    disabled={displayOptions.length === 0}
                                  >
                                    <SelectTrigger><SelectValue placeholder="Select display text" /></SelectTrigger>
                                    <SelectContent>
                                      {displayOptions.map(v => (
                                        <SelectItem key={v} value={v}>{v}</SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                );
                              })()}
                            </div>
                          </div>
                        ) : r.range_type === "descriptive" || r.range_type === "undefined" ? (
                          <div className="space-y-2">
                            {r.range_type === "undefined" && (
                              <div className="text-xs text-muted-foreground">
                                No flag/highlight for this type. If a Unit is set on the parameter, the result value will be concatenated with the Unit on the report.
                              </div>
                            )}
                            <div className="flex items-center justify-between">
                              <Label className="text-xs font-medium">
                                Dropdown Options {r.range_type === "undefined" ? "(optional, for result selection)" : "(for result selection)"}
                              </Label>
                              <Button type="button" variant="outline" size="sm" className="h-6 text-xs" onClick={() => {
                                const opts = [...(r.descriptive_options || []), ""];
                                updateRange(r._idx, "descriptive_options", opts);
                              }}>
                                <Plus className="h-3 w-3 mr-1" />Add Option
                              </Button>
                            </div>
                            {(r.descriptive_options || []).map((opt, optIdx) => (
                              <div key={optIdx} className="flex items-center gap-2">
                                <Input
                                  className="h-7"
                                  value={opt}
                                  onChange={(e) => {
                                    const opts = [...(r.descriptive_options || [])];
                                    opts[optIdx] = e.target.value;
                                    updateRange(r._idx, "descriptive_options", opts);
                                  }}
                                  placeholder={`Option ${optIdx + 1}`}
                                />
                                <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-destructive shrink-0" onClick={() => {
                                  const opts = (r.descriptive_options || []).filter((_, i) => i !== optIdx);
                                  updateRange(r._idx, "descriptive_options", opts);
                                }}>
                                  <Trash2 className="h-3 w-3" />
                                </Button>
                              </div>
                            ))}
                            {(!r.descriptive_options || r.descriptive_options.length === 0) && (
                              <p className="text-xs text-muted-foreground">No options added yet. Click "Add Option" to add text choices.</p>
                            )}
                            <div>
                              <Label className="text-xs">
                                {r.range_type === "undefined"
                                  ? "Display Text for Reference Range (optional, leave blank to omit)"
                                  : "Display Text (report reference range, optional)"}
                              </Label>
                              <Input
                                value={r.normal_range_text}
                                onChange={(e) => updateRange(r._idx, "normal_range_text", e.target.value)}
                                onBlur={(e) => {
                                  const raw = (e.target.value || "").trim();
                                  const u = (form.unit || "").trim();
                                  if (!raw || !u) return;
                                  if (raw.toLowerCase().endsWith(u.toLowerCase())) return;
                                  updateRange(r._idx, "normal_range_text", `${raw} ${u}`.replace(/\s+/g, " ").trim());
                                }}
                                placeholder={r.range_type === "undefined" ? "e.g. 10 - 50 mL (leave blank for none)" : "Shown in report Reference Range (can be blank)"}
                              />
                            </div>
                            {r.range_type === "descriptive" && (
                              <div>
                                <Label className="text-xs">Normal Findings (for highlight only — not shown on report)</Label>
                                <Input
                                  value={r.normal_findings || ""}
                                  onChange={(e) => updateRange(r._idx, "normal_findings", e.target.value)}
                                  placeholder="e.g. Clear | Absent (mismatch highlights row, no HIGH/LOW)"
                                />
                                <p className="text-[10px] text-muted-foreground mt-1">
                                  If the result does not match Normal Findings, the row is highlighted. Use | or new lines for multiple acceptable values.
                                </p>
                              </div>
                            )}
                          </div>
                        ) : r.range_type === "time" ? (
                          (() => {
                            const lowMS = secondsToMinSec(r.normal_range_low);
                            const highMS = secondsToMinSec(r.normal_range_high);
                            const updateLow = (m: number, s: number) => {
                              const total = minSecToSeconds(m, s);
                              const newLow = (m === 0 && s === 0) ? null : total;
                              updateRange(r._idx, "normal_range_low", newLow);
                              updateRange(r._idx, "normal_range_text", formatTimeRange(newLow, r.normal_range_high));
                            };
                            const updateHigh = (m: number, s: number) => {
                              const total = minSecToSeconds(m, s);
                              const newHigh = (m === 0 && s === 0) ? null : total;
                              updateRange(r._idx, "normal_range_high", newHigh);
                              updateRange(r._idx, "normal_range_text", formatTimeRange(r.normal_range_low, newHigh));
                            };
                            return (
                              <div className="space-y-2">
                                <div className="grid grid-cols-2 gap-3">
                                  <div>
                                    <Label className="text-xs">Low (Min : Sec)</Label>
                                    <div className="flex items-center gap-1">
                                      <Input type="number" min={0} className="h-8 w-20" value={lowMS.min || ""} placeholder="min" onChange={(e) => updateLow(Number(e.target.value) || 0, lowMS.sec)} />
                                      <span className="font-bold">:</span>
                                      <Input type="number" min={0} max={59} className="h-8 w-20" value={lowMS.sec || ""} placeholder="sec" onChange={(e) => updateLow(lowMS.min, Number(e.target.value) || 0)} />
                                    </div>
                                  </div>
                                  <div>
                                    <Label className="text-xs">High (Min : Sec)</Label>
                                    <div className="flex items-center gap-1">
                                      <Input type="number" min={0} className="h-8 w-20" value={highMS.min || ""} placeholder="min" onChange={(e) => updateHigh(Number(e.target.value) || 0, highMS.sec)} />
                                      <span className="font-bold">:</span>
                                      <Input type="number" min={0} max={59} className="h-8 w-20" value={highMS.sec || ""} placeholder="sec" onChange={(e) => updateHigh(highMS.min, Number(e.target.value) || 0)} />
                                    </div>
                                  </div>
                                </div>
                                <div>
                                  <Label className="text-xs">Display Text (auto-generated, editable)</Label>
                                  <Input value={r.normal_range_text || ""} onChange={(e) => updateRange(r._idx, "normal_range_text", e.target.value)} placeholder="e.g. 2 min – 7 min" />
                                </div>
                                <p className="text-[11px] text-muted-foreground">Result entry will show two boxes (Min : Sec). Report will display as "2 min 30 sec".</p>
                              </div>
                            );
                          })()
                        ) : null}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving || !form.parameter_name.trim()}>
              {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DeletePasswordDialog open={deletePwdOpen} onOpenChange={setDeletePwdOpen} onSuccess={handleDeleteSelected} description={`Delete ${selectedIds.size} selected parameter(s)?`} />
      <DeletePasswordDialog open={deleteAllPwdOpen} onOpenChange={setDeleteAllPwdOpen} onSuccess={handleDeleteAll} description={`Delete ALL ${params.length} parameters? This cannot be undone.`} />
    </div>
  );
};

export default ReportParameters;
