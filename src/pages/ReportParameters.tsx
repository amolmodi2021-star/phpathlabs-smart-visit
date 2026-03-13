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
import { Plus, Pencil, Trash2, Loader2, Search } from "lucide-react";
import RichTextEditor from "@/components/RichTextEditor";

const ReportParameters = () => {
  const [params, setParams] = useState<any[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [profiles, setProfiles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
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
    load();
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
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Test Parameter Management</h1>
        <Button onClick={openNew}><Plus className="h-4 w-4 mr-2" />Add Parameter</Button>
      </div>

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
                    <TableRow key={p.id}>
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
                  {filtered.length === 0 && <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">No parameters found</TableCell></TableRow>}
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
    </div>
  );
};

export default ReportParameters;
