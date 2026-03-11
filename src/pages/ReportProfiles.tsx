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
import { Plus, Pencil, Trash2, Loader2, ArrowUp, ArrowDown } from "lucide-react";

interface SelectedParam {
  parameter_id: string;
  parameter_name: string;
  display_order: number;
}

const ReportProfiles = () => {
  const [profiles, setProfiles] = useState<any[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [allParameters, setAllParameters] = useState<any[]>([]);
  const [profileParamCounts, setProfileParamCounts] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ profile_name: "", department_id: "", analyzer: "", method: "", remarks: "", display_order: 0 });
  const [selectedParams, setSelectedParams] = useState<SelectedParam[]>([]);
  const [paramSearch, setParamSearch] = useState("");
  const { toast } = useToast();

  const load = async () => {
    setLoading(true);
    const [{ data: p }, { data: d }, { data: params }, { data: pp }] = await Promise.all([
      supabase.from("report_profiles").select("*, report_departments(department_name)").order("display_order"),
      supabase.from("report_departments").select("*").order("display_order"),
      supabase.from("report_test_parameters").select("id, parameter_name, test_name").order("parameter_name"),
      supabase.from("profile_parameters").select("profile_id, parameter_id"),
    ]);
    setProfiles(p || []);
    setDepartments(d || []);
    setAllParameters(params || []);

    // Count parameters per profile
    const counts = new Map<string, number>();
    (pp || []).forEach((row: any) => {
      counts.set(row.profile_id, (counts.get(row.profile_id) || 0) + 1);
    });
    setProfileParamCounts(counts);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleSave = async () => {
    if (!form.profile_name.trim()) return;
    const payload = { ...form, department_id: form.department_id || null };
    let profileId = editId;

    if (editId) {
      await supabase.from("report_profiles").update(payload).eq("id", editId);
    } else {
      const { data } = await supabase.from("report_profiles").insert(payload).select("id").single();
      profileId = data?.id || null;
    }

    // Save profile parameters
    if (profileId) {
      // Delete existing
      await supabase.from("profile_parameters").delete().eq("profile_id", profileId);
      // Insert new
      if (selectedParams.length > 0) {
        const rows = selectedParams.map((sp, idx) => ({
          profile_id: profileId!,
          parameter_id: sp.parameter_id,
          display_order: idx,
        }));
        await supabase.from("profile_parameters").insert(rows);
      }
    }

    setDialogOpen(false);
    setEditId(null);
    load();
    toast({ title: editId ? "Profile updated" : "Profile added" });
  };

  const handleEdit = async (p: any) => {
    setEditId(p.id);
    setForm({ profile_name: p.profile_name, department_id: p.department_id || "", analyzer: p.analyzer || "", method: p.method || "", remarks: p.remarks || "", display_order: p.display_order || 0 });

    // Load existing profile parameters
    const { data: pp } = await supabase
      .from("profile_parameters")
      .select("parameter_id, display_order, report_test_parameters(parameter_name)")
      .eq("profile_id", p.id)
      .order("display_order");

    const existing: SelectedParam[] = (pp || []).map((row: any) => ({
      parameter_id: row.parameter_id,
      parameter_name: row.report_test_parameters?.parameter_name || "",
      display_order: row.display_order,
    }));
    setSelectedParams(existing);
    setParamSearch("");
    setDialogOpen(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this profile?")) return;
    await supabase.from("profile_parameters").delete().eq("profile_id", id);
    await supabase.from("report_profiles").delete().eq("id", id);
    load();
  };

  const openNew = () => {
    setEditId(null);
    setForm({ profile_name: "", department_id: "", analyzer: "", method: "", remarks: "", display_order: 0 });
    setSelectedParams([]);
    setParamSearch("");
    setDialogOpen(true);
  };

  const toggleParam = (param: any) => {
    setSelectedParams((prev) => {
      const exists = prev.find((sp) => sp.parameter_id === param.id);
      if (exists) {
        return prev.filter((sp) => sp.parameter_id !== param.id);
      }
      return [...prev, { parameter_id: param.id, parameter_name: param.parameter_name, display_order: prev.length }];
    });
  };

  const moveParam = (index: number, direction: "up" | "down") => {
    setSelectedParams((prev) => {
      const arr = [...prev];
      const swapIdx = direction === "up" ? index - 1 : index + 1;
      if (swapIdx < 0 || swapIdx >= arr.length) return prev;
      [arr[index], arr[swapIdx]] = [arr[swapIdx], arr[index]];
      return arr;
    });
  };

  const filteredParams = allParameters.filter((p) =>
    p.parameter_name.toLowerCase().includes(paramSearch.toLowerCase())
  );

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Profile Management</h1>
        <Button onClick={openNew}><Plus className="h-4 w-4 mr-2" />Add Profile</Button>
      </div>

      <Card>
        <CardContent className="pt-6">
          {loading ? <div className="flex justify-center p-8"><Loader2 className="h-6 w-6 animate-spin" /></div> : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Profile Name</TableHead>
                  <TableHead>Department</TableHead>
                  <TableHead>Parameters</TableHead>
                  <TableHead>Analyzer</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead className="w-[100px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {profiles.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium">{p.profile_name}</TableCell>
                    <TableCell>{p.report_departments?.department_name || "-"}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{profileParamCounts.get(p.id) || 0}</Badge>
                    </TableCell>
                    <TableCell>{p.analyzer || "-"}</TableCell>
                    <TableCell>{p.method || "-"}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleEdit(p)}><Pencil className="h-3 w-3" /></Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleDelete(p.id)}><Trash2 className="h-3 w-3" /></Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {profiles.length === 0 && <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No profiles added yet</TableCell></TableRow>}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editId ? "Edit" : "Add"} Profile</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label>Profile Name</Label><Input value={form.profile_name} onChange={(e) => setForm({ ...form, profile_name: e.target.value })} /></div>
            <div>
              <Label>Department</Label>
              <Select value={form.department_id} onValueChange={(v) => setForm({ ...form, department_id: v })}>
                <SelectTrigger><SelectValue placeholder="Select department" /></SelectTrigger>
                <SelectContent>{departments.map((d) => <SelectItem key={d.id} value={d.id}>{d.department_name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div><Label>Analyzer</Label><Input value={form.analyzer} onChange={(e) => setForm({ ...form, analyzer: e.target.value })} /></div>
              <div><Label>Method</Label><Input value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })} /></div>
            </div>
            <div><Label>Remarks</Label><Input value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} /></div>
            <div><Label>Display Order</Label><Input type="number" value={form.display_order} onChange={(e) => setForm({ ...form, display_order: Number(e.target.value) })} /></div>

            {/* Parameter Selection */}
            <div className="border rounded-lg p-4 space-y-3">
              <Label className="text-base font-semibold">Parameters in this Profile</Label>

              {/* Selected parameters with ordering */}
              {selectedParams.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Selected ({selectedParams.length}): use arrows to reorder</p>
                  {selectedParams.map((sp, idx) => (
                    <div key={sp.parameter_id} className="flex items-center gap-2 p-2 bg-accent/50 rounded text-sm">
                      <span className="text-xs text-muted-foreground w-6">{idx + 1}.</span>
                      <span className="flex-1 font-medium">{sp.parameter_name}</span>
                      <Button variant="ghost" size="icon" className="h-6 w-6" disabled={idx === 0} onClick={() => moveParam(idx, "up")}>
                        <ArrowUp className="h-3 w-3" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-6 w-6" disabled={idx === selectedParams.length - 1} onClick={() => moveParam(idx, "down")}>
                        <ArrowDown className="h-3 w-3" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => toggleParam({ id: sp.parameter_id, parameter_name: sp.parameter_name })}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              {/* Search and add parameters */}
              <Input placeholder="Search parameters..." value={paramSearch} onChange={(e) => setParamSearch(e.target.value)} className="h-8" />
              <div className="max-h-48 overflow-y-auto border rounded space-y-0">
                {filteredParams.map((param) => {
                  const isSelected = selectedParams.some((sp) => sp.parameter_id === param.id);
                  return (
                    <div
                      key={param.id}
                      className="flex items-center gap-2 px-3 py-1.5 hover:bg-accent cursor-pointer text-sm"
                      onClick={() => toggleParam(param)}
                    >
                      <Checkbox checked={isSelected} />
                      <span>{param.parameter_name}</span>
                      {param.test_name && <span className="text-xs text-muted-foreground ml-auto">{param.test_name}</span>}
                    </div>
                  );
                })}
                {filteredParams.length === 0 && <p className="text-center py-3 text-xs text-muted-foreground">No parameters found</p>}
              </div>
            </div>
          </div>
          <DialogFooter><Button onClick={handleSave}>Save</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ReportProfiles;
