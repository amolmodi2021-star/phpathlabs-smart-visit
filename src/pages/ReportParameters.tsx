import { useState, useEffect, useCallback } from "react";
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
import { Plus, Pencil, Trash2, Loader2, Search, Download, Upload } from "lucide-react";
import DeletePasswordDialog from "@/components/DeletePasswordDialog";
import { exportToExcel, parseExcelFile } from "@/lib/excel";
import ExportPasswordDialog from "@/components/ExportPasswordDialog";

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
  descriptive_options: string[];
}

// No default age groups — users set ranges manually

const ReportParameters = () => {
  const [params, setParams] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [exportPwdOpen, setExportPwdOpen] = useState(false);
  const [deletePwdOpen, setDeletePwdOpen] = useState(false);
  const [deleteAllPwdOpen, setDeleteAllPwdOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [editId, setEditId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    parameter_name: "",
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
    calculation_formula: [] as { parameter_id: string; parameter_name: string; operator: string }[],
  });

  const [normalRanges, setNormalRanges] = useState<NormalRange[]>([]);

  const { toast } = useToast();

  const load = async () => {
    setLoading(true);
    const { data: p } = await supabase.from("report_test_parameters").select("*").order("parameter_name");
    setParams(p || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const filtered = params.filter((p) =>
    p.parameter_name.toLowerCase().includes(search.toLowerCase()) ||
    (p.param_code || "").toLowerCase().includes(search.toLowerCase())
  );

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
          newRanges.push({ gender, age_min: 0, age_max: 150, normal_range_low: null, normal_range_high: null, normal_range_text: "", range_type: "numeric", expected_value: "", descriptive_options: [] });
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
      setNormalRanges(data.map((r: any) => ({
        id: r.id,
        gender: r.gender,
        age_min: r.age_min,
        age_max: r.age_max,
        normal_range_low: r.normal_range_low,
        normal_range_high: r.normal_range_high,
        normal_range_text: r.normal_range_text || "",
        range_type: r.range_type || "numeric",
        expected_value: r.expected_value || "",
        descriptive_options: Array.isArray(r.descriptive_options) ? r.descriptive_options : [],
      })));
    }
  };

  const handleSave = async () => {
    if (!form.parameter_name.trim()) return;
    setSaving(true);
    try {
      const payload: any = {
        parameter_name: form.parameter_name,
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
          const rangeInserts = normalRanges.map(r => ({
            parameter_id: paramId!,
            gender: r.gender,
            age_min: r.age_min,
            age_max: r.age_max,
            normal_range_low: r.range_type === "numeric" ? r.normal_range_low : null,
            normal_range_high: r.range_type === "numeric" ? r.normal_range_high : null,
            normal_range_text: r.normal_range_text || null,
            range_type: r.range_type || "numeric",
            expected_value: r.range_type === "qualitative" ? (r.expected_value || null) : null,
            descriptive_options: r.range_type === "descriptive" ? (r.descriptive_options?.filter(o => o.trim()) || []) : [],
          }));
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
    setForm({
      parameter_name: p.parameter_name,
      unit: p.unit || "",
      store_for_analytics: p.store_for_analytics || false,
      use_global_normal_range: p.use_global_normal_range || false,
      same_for_gender: p.same_for_gender !== false,
      same_for_all_ages: p.same_for_all_ages !== false,
      normal_range_text: p.normal_range_text || "",
      machine_name: p.machine_name || "",
      machine_id: p.machine_id || "",
      send_for_interface: p.send_for_interface !== false,
      is_calculated: p.is_calculated || false,
      calculation_formula: Array.isArray(p.calculation_formula) ? p.calculation_formula : [],
    });
    setNormalRanges([]);
    setDialogOpen(true);
    await loadNormalRanges(p.id);
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
    const ids = params.map((p) => p.id);
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
    if (selectedIds.size === filtered.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map((p) => p.id)));
    }
  };

  const handleExport = () => {
    const rows = params.map((p) => ({
      "Param Code": p.param_code || "",
      "Parameter Name": p.parameter_name || "",
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
    setForm({
      parameter_name: "", unit: "", store_for_analytics: false,
      use_global_normal_range: false, same_for_gender: true, same_for_all_ages: true,
      normal_range_text: "", machine_name: "", machine_id: "",
      send_for_interface: true, is_calculated: false, calculation_formula: [],
    });
    setNormalRanges([]);
    setDialogOpen(true);
  };

  const updateRange = (index: number, field: keyof NormalRange, value: any) => {
    setNormalRanges(prev => prev.map((r, i) => i === index ? { ...r, [field]: value } : r));
  };

  const addAgeRange = (gender: string) => {
    setNormalRanges(prev => [...prev, {
      gender, age_min: 0, age_max: 150,
      normal_range_low: null, normal_range_high: null, normal_range_text: "",
      range_type: "numeric", expected_value: "", descriptive_options: [],
    }]);
  };

  const removeAgeRange = (index: number) => {
    setNormalRanges(prev => prev.filter((_, i) => i !== index));
  };

  const getGenderLabel = (g: string) => g === "all" ? "All" : g === "male" ? "Male" : "Female";

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-2xl font-bold">Test Parameter Management</h1>
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
          <div className="mb-4 relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search parameters..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-8 max-w-sm" />
          </div>
          {loading ? <div className="flex justify-center p-8"><Loader2 className="h-6 w-6 animate-spin" /></div> : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[40px]">
                      <Checkbox checked={filtered.length > 0 && selectedIds.size === filtered.length} onCheckedChange={toggleSelectAll} />
                    </TableHead>
                    <TableHead>Code</TableHead>
                    <TableHead>Parameter</TableHead>
                    <TableHead>Unit</TableHead>
                    <TableHead>Global Range</TableHead>
                    <TableHead>Analytics</TableHead>
                    <TableHead className="w-[80px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((p) => (
                    <TableRow key={p.id} className={selectedIds.has(p.id) ? "bg-muted/50" : ""}>
                      <TableCell><Checkbox checked={selectedIds.has(p.id)} onCheckedChange={() => toggleSelect(p.id)} /></TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">{p.param_code || "-"}</TableCell>
                      <TableCell className="font-medium">{p.parameter_name}</TableCell>
                      <TableCell>{p.unit || "-"}</TableCell>
                      <TableCell>{p.use_global_normal_range ? <Badge className="bg-blue-100 text-blue-800">ON</Badge> : <Badge variant="secondary">OFF</Badge>}</TableCell>
                      <TableCell>{p.store_for_analytics ? <Badge className="bg-green-100 text-green-800">YES</Badge> : <Badge variant="secondary">NO</Badge>}</TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleEdit(p)}><Pencil className="h-3 w-3" /></Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleDelete(p.id)}><Trash2 className="h-3 w-3" /></Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {filtered.length === 0 && <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No parameters found</TableCell></TableRow>}
                </TableBody>
              </Table>
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
                <Input value={params.find(p => p.id === editId)?.param_code || ""} disabled className="font-mono" />
              </div>
            )}
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Parameter Name *</Label><Input value={form.parameter_name} onChange={(e) => setForm({ ...form, parameter_name: e.target.value })} /></div>
              <div><Label>Unit</Label><Input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} /></div>
            </div>

            <div className="flex items-center gap-2">
              <Checkbox checked={form.store_for_analytics} onCheckedChange={(c) => setForm({ ...form, store_for_analytics: !!c })} />
              <Label>Store for Analytics (include in historical trends)</Label>
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
                            </SelectContent>
                          </Select>
                        </div>
                        {(r.range_type || "numeric") === "numeric" ? (
                          <div className="grid grid-cols-3 gap-2">
                            <div>
                              <Label className="text-xs">Low</Label>
                              <Input type="number" step="any" value={r.normal_range_low ?? ""} onChange={(e) => updateRange(r._idx, "normal_range_low", e.target.value ? Number(e.target.value) : null)} placeholder="Low" />
                            </div>
                            <div>
                              <Label className="text-xs">High</Label>
                              <Input type="number" step="any" value={r.normal_range_high ?? ""} onChange={(e) => updateRange(r._idx, "normal_range_high", e.target.value ? Number(e.target.value) : null)} placeholder="High" />
                            </div>
                            <div>
                              <Label className="text-xs">Display Text</Label>
                              <Input value={r.normal_range_text} onChange={(e) => updateRange(r._idx, "normal_range_text", e.target.value)} placeholder="e.g. 4.0-11.0" />
                            </div>
                          </div>
                        ) : r.range_type === "qualitative" ? (
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <Label className="text-xs">Expected Normal Value</Label>
                              <Input value={r.expected_value || ""} onChange={(e) => updateRange(r._idx, "expected_value", e.target.value)} placeholder="e.g. Absent, Negative" />
                            </div>
                            <div>
                              <Label className="text-xs">Display Text</Label>
                              <Input value={r.normal_range_text} onChange={(e) => updateRange(r._idx, "normal_range_text", e.target.value)} placeholder="e.g. Absent" />
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <Label className="text-xs font-medium">Dropdown Options (for result selection)</Label>
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
                              <p className="text-xs text-muted-foreground">No options added yet. Click "Add Option" to add descriptive text choices.</p>
                            )}
                            <div>
                              <Label className="text-xs">Display Text</Label>
                              <Input value={r.normal_range_text} onChange={(e) => updateRange(r._idx, "normal_range_text", e.target.value)} placeholder="e.g. Normal findings" />
                            </div>
                          </div>
                        )}
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
