import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2, Loader2 } from "lucide-react";

const ReportProfiles = () => {
  const [profiles, setProfiles] = useState<any[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ profile_name: "", department_id: "", analyzer: "", method: "", remarks: "", display_order: 0 });
  const { toast } = useToast();

  const load = async () => {
    setLoading(true);
    const [{ data: p }, { data: d }] = await Promise.all([
      supabase.from("report_profiles").select("*, report_departments(department_name)").order("display_order"),
      supabase.from("report_departments").select("*").order("display_order"),
    ]);
    setProfiles(p || []);
    setDepartments(d || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleSave = async () => {
    if (!form.profile_name.trim()) return;
    const payload = { ...form, department_id: form.department_id || null };
    if (editId) {
      await supabase.from("report_profiles").update(payload).eq("id", editId);
    } else {
      await supabase.from("report_profiles").insert(payload);
    }
    setDialogOpen(false);
    setEditId(null);
    load();
    toast({ title: editId ? "Profile updated" : "Profile added" });
  };

  const handleEdit = (p: any) => {
    setEditId(p.id);
    setForm({ profile_name: p.profile_name, department_id: p.department_id || "", analyzer: p.analyzer || "", method: p.method || "", remarks: p.remarks || "", display_order: p.display_order || 0 });
    setDialogOpen(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this profile?")) return;
    await supabase.from("report_profiles").delete().eq("id", id);
    load();
  };

  const openNew = () => {
    setEditId(null);
    setForm({ profile_name: "", department_id: "", analyzer: "", method: "", remarks: "", display_order: 0 });
    setDialogOpen(true);
  };

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
                {profiles.length === 0 && <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No profiles added yet</TableCell></TableRow>}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
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
          </div>
          <DialogFooter><Button onClick={handleSave}>Save</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ReportProfiles;
