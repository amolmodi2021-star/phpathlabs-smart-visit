import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2, Loader2, Search, Download, Upload, CheckSquare } from "lucide-react";
import DeletePasswordDialog from "@/components/DeletePasswordDialog";
import RichTextEditor from "@/components/RichTextEditor";
import { exportToExcel, parseExcelFile } from "@/lib/excel";
import ExportPasswordDialog from "@/components/ExportPasswordDialog";

const ReportParameters = () => {
  const [params, setParams] = useState<any[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [profiles, setProfiles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [exportPwdOpen, setExportPwdOpen] = useState(false);
  const [deletePwdOpen, setDeletePwdOpen] = useState(false);
  const [deleteAllPwdOpen, setDeleteAllPwdOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({
    parameter_name: "", test_name: "", profile_id: "", department_id: "",
    unit: "", analyzer: "", method: "", store_for_analytics: false, display_order: 0,
    sample_type: "", is_outsourced: false, outsourced_caption: "", interpretation: "",
  });
  const { toast } = useToast();

  const load = async () => {
    setLoading(true);
    const [{ data: p }, { data: d }, { data: pr }] = await Promise.all([
      supabase.from("report_test_parameters").select("*, report_departments(department_name), report_profiles(profile_name)").order("display_order"),
      supabase.from("report_departments").select("*").order("display_order"),
      supabase.from("report_profiles").select("*").order("display_order"),
    ]);
    setParams(p || []);
    setDepartments(d || []);
    setProfiles(pr || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const filtered = params.filter((p) =>
    p.parameter_name.toLowerCase().includes(search.toLowerCase()) ||
    (p.test_name || "").toLowerCase().includes(search.toLowerCase())
  );

  const handleSave = async () => {
    if (!form.parameter_name.trim()) return;
    const payload = {
      parameter_name: form.parameter_name,
      test_name: form.test_name || null,
      profile_id: form.profile_id || null,
      department_id: form.department_id || null,
      unit: form.unit || null,
      analyzer: form.analyzer || null,
      method: form.method || null,
      store_for_analytics: form.store_for_analytics,
      display_order: form.display_order,
      sample_type: form.sample_type || null,
      is_outsourced: form.is_outsourced,
      outsourced_caption: form.outsourced_caption || null,
      interpretation: form.interpretation || null,
      normal_range_low: null,
      normal_range_high: null,
      normal_range_text: null,
    };
    if (editId) {
      await supabase.from("report_test_parameters").update(payload).eq("id", editId);
    } else {
      await supabase.from("report_test_parameters").insert(payload);
    }
    setDialogOpen(false);
    setEditId(null);
    load();
    toast({ title: editId ? "Parameter updated" : "Parameter added" });
  };

  const handleEdit = (p: any) => {
    setEditId(p.id);
    setForm({
      parameter_name: p.parameter_name, test_name: p.test_name || "",
      profile_id: p.profile_id || "", department_id: p.department_id || "",
      unit: p.unit || "",
      analyzer: p.analyzer || "", method: p.method || "",
      store_for_analytics: p.store_for_analytics || false, display_order: p.display_order || 0,
      sample_type: p.sample_type || "", is_outsourced: p.is_outsourced || false,
      outsourced_caption: p.outsourced_caption || "", interpretation: p.interpretation || "",
    });
    setDialogOpen(true);
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
      const batch = ids.slice(i, i + 50);
      await supabase.from("report_test_parameters").delete().in("id", batch);
    }
    setSelectedIds(new Set());
    load();
    toast({ title: `${ids.length} parameters deleted` });
  };

  const handleDeleteAll = async () => {
    const ids = params.map((p) => p.id);
    if (!ids.length) return;
    for (let i = 0; i < ids.length; i += 50) {
      const batch = ids.slice(i, i + 50);
      await supabase.from("report_test_parameters").delete().in("id", batch);
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
      "Parameter Name": p.parameter_name || "",
      "Test Name": p.test_name || "",
      "Department": p.report_departments?.department_name || "",
      "Profile": p.report_profiles?.profile_name || "",
      "Unit": p.unit || "",
      "Sample Type": p.sample_type || "",
      "Analyzer": p.analyzer || "",
      "Method": p.method || "",
      "Display Order": p.display_order ?? 0,
      "Store for Analytics": p.store_for_analytics ? "Yes" : "No",
      "Is Outsourced": p.is_outsourced ? "Yes" : "No",
      "Outsourced Caption": p.outsourced_caption || "",
      "Interpretation": p.interpretation || "",
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

      // Build lookup maps for department and profile names → ids
      const deptMap = new Map(departments.map((d: any) => [d.department_name.toLowerCase(), d.id]));
      const profMap = new Map(profiles.map((p: any) => [p.profile_name.toLowerCase(), p.id]));

      const inserts = rows.map((r: any) => ({
        parameter_name: r["Parameter Name"] || "",
        test_name: r["Test Name"] || null,
        department_id: deptMap.get((r["Department"] || "").toLowerCase()) || null,
        profile_id: profMap.get((r["Profile"] || "").toLowerCase()) || null,
        unit: r["Unit"] || null,
        sample_type: r["Sample Type"] || null,
        analyzer: r["Analyzer"] || null,
        method: r["Method"] || null,
        display_order: Number(r["Display Order"]) || 0,
        store_for_analytics: (r["Store for Analytics"] || "").toString().toLowerCase() === "yes",
        is_outsourced: (r["Is Outsourced"] || "").toString().toLowerCase() === "yes",
        outsourced_caption: r["Outsourced Caption"] || null,
        interpretation: r["Interpretation"] || null,
      })).filter((r: any) => r.parameter_name);

      if (!inserts.length) { toast({ title: "No valid rows found", variant: "destructive" }); return; }

      const { error } = await supabase.from("report_test_parameters").insert(inserts);
      if (error) throw error;

      // Auto-rebuild profile_parameters junction table for newly imported params
      const { data: newParams } = await supabase
        .from("report_test_parameters")
        .select("id, profile_id, display_order")
        .not("profile_id", "is", null);
      if (newParams && newParams.length > 0) {
        // Clear existing and rebuild
        await supabase.from("profile_parameters").delete().neq("id", "00000000-0000-0000-0000-000000000000");
        const junctionInserts = newParams.map((p: any) => ({
          parameter_id: p.id,
          profile_id: p.profile_id,
          display_order: p.display_order || 0,
        }));
        // Insert in batches of 50
        for (let i = 0; i < junctionInserts.length; i += 50) {
          await supabase.from("profile_parameters").insert(junctionInserts.slice(i, i + 50));
        }
      }

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
      parameter_name: "", test_name: "", profile_id: "", department_id: "", unit: "",
      analyzer: "", method: "", store_for_analytics: false, display_order: 0,
      sample_type: "", is_outsourced: false, outsourced_caption: "", interpretation: "",
    });
    setDialogOpen(true);
  };

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
                      <Checkbox
                        checked={filtered.length > 0 && selectedIds.size === filtered.length}
                        onCheckedChange={toggleSelectAll}
                      />
                    </TableHead>
                    <TableHead>Parameter</TableHead>
                    <TableHead>Test</TableHead>
                    <TableHead>Department</TableHead>
                    <TableHead>Profile</TableHead>
                    <TableHead>Sample Type</TableHead>
                    <TableHead>Unit</TableHead>
                    <TableHead>Outsourced</TableHead>
                    <TableHead>Analytics</TableHead>
                    <TableHead className="w-[80px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((p) => (
                    <TableRow key={p.id} className={selectedIds.has(p.id) ? "bg-muted/50" : ""}>
                      <TableCell>
                        <Checkbox checked={selectedIds.has(p.id)} onCheckedChange={() => toggleSelect(p.id)} />
                      </TableCell>
                      <TableCell className="font-medium">{p.parameter_name}</TableCell>
                      <TableCell>{p.test_name || "-"}</TableCell>
                      <TableCell>{p.report_departments?.department_name || "-"}</TableCell>
                      <TableCell>{p.report_profiles?.profile_name || "-"}</TableCell>
                      <TableCell>{p.sample_type || "-"}</TableCell>
                      <TableCell>{p.unit || "-"}</TableCell>
                      <TableCell>{p.is_outsourced ? "Yes" : "-"}</TableCell>
                      <TableCell>{p.store_for_analytics ? <Badge className="bg-green-100 text-green-800">YES</Badge> : <Badge variant="secondary">NO</Badge>}</TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleEdit(p)}><Pencil className="h-3 w-3" /></Button>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleDelete(p.id)}><Trash2 className="h-3 w-3" /></Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {filtered.length === 0 && <TableRow><TableCell colSpan={10} className="text-center py-8 text-muted-foreground">No parameters found</TableCell></TableRow>}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editId ? "Edit" : "Add"} Test Parameter</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label>Parameter Name *</Label><Input value={form.parameter_name} onChange={(e) => setForm({ ...form, parameter_name: e.target.value })} /></div>
            <div><Label>Test Name</Label><Input value={form.test_name} onChange={(e) => setForm({ ...form, test_name: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Department</Label>
                <Select value={form.department_id} onValueChange={(v) => setForm({ ...form, department_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>{departments.map((d) => <SelectItem key={d.id} value={d.id}>{d.department_name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>Profile</Label>
                <Select value={form.profile_id} onValueChange={(v) => setForm({ ...form, profile_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>{profiles.map((p) => <SelectItem key={p.id} value={p.id}>{p.profile_name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Unit</Label><Input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} /></div>
              <div><Label>Sample Type</Label><Input value={form.sample_type} onChange={(e) => setForm({ ...form, sample_type: e.target.value })} placeholder="e.g. Blood, Serum" /></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Analyzer</Label><Input value={form.analyzer} onChange={(e) => setForm({ ...form, analyzer: e.target.value })} /></div>
              <div><Label>Method</Label><Input value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })} /></div>
            </div>
            <div><Label>Display Order</Label><Input type="number" value={form.display_order} onChange={(e) => setForm({ ...form, display_order: Number(e.target.value) })} /></div>
            <div className="flex items-center gap-2">
              <Checkbox checked={form.store_for_analytics} onCheckedChange={(c) => setForm({ ...form, store_for_analytics: !!c })} />
              <Label>Store for Analytics (include in historical trends)</Label>
            </div>

            <div className="flex items-center gap-2">
              <Checkbox checked={form.is_outsourced} onCheckedChange={(c) => setForm({ ...form, is_outsourced: !!c })} />
              <Label>Mark as Outsourced</Label>
            </div>
            {form.is_outsourced && (
              <div><Label>Outsourced Caption</Label><Input value={form.outsourced_caption} onChange={(e) => setForm({ ...form, outsourced_caption: e.target.value })} placeholder="e.g. This test was outsourced to XYZ Lab" /></div>
            )}

            <div>
              <Label>Interpretation</Label>
              <RichTextEditor value={form.interpretation} onChange={(html) => setForm({ ...form, interpretation: html })} />
            </div>
          </div>
          <DialogFooter><Button onClick={handleSave}>Save</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <DeletePasswordDialog
        open={deletePwdOpen}
        onOpenChange={setDeletePwdOpen}
        onSuccess={handleDeleteSelected}
        description={`Delete ${selectedIds.size} selected parameter(s)?`}
      />
      <DeletePasswordDialog
        open={deleteAllPwdOpen}
        onOpenChange={setDeleteAllPwdOpen}
        onSuccess={handleDeleteAll}
        description={`Delete ALL ${params.length} parameters? This cannot be undone.`}
      />
    </div>
  );
};

export default ReportParameters;
