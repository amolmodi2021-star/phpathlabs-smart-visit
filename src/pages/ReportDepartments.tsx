import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2, Loader2 } from "lucide-react";

const ReportDepartments = () => {
  const [departments, setDepartments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [order, setOrder] = useState(0);
  const { toast } = useToast();

  const load = async () => {
    setLoading(true);
    const { data } = await supabase.from("report_departments").select("*").order("display_order");
    setDepartments(data || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleSave = async () => {
    if (!name.trim()) return;
    if (editId) {
      await supabase.from("report_departments").update({ department_name: name.trim(), display_order: order }).eq("id", editId);
    } else {
      await supabase.from("report_departments").insert({ department_name: name.trim(), display_order: order });
    }
    setDialogOpen(false);
    setEditId(null);
    setName("");
    setOrder(0);
    load();
    toast({ title: editId ? "Department updated" : "Department added" });
  };

  const handleEdit = (d: any) => {
    setEditId(d.id);
    setName(d.department_name);
    setOrder(d.display_order || 0);
    setDialogOpen(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this department?")) return;
    await supabase.from("report_departments").delete().eq("id", id);
    load();
    toast({ title: "Department deleted" });
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Department Management</h1>
        <Button onClick={() => { setEditId(null); setName(""); setOrder(0); setDialogOpen(true); }}><Plus className="h-4 w-4 mr-2" />Add Department</Button>
      </div>

      <Card>
        <CardContent className="pt-6">
          {loading ? <div className="flex justify-center p-8"><Loader2 className="h-6 w-6 animate-spin" /></div> : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Department Name</TableHead>
                  <TableHead>Display Order</TableHead>
                  <TableHead className="w-[100px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {departments.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="font-medium">{d.department_name}</TableCell>
                    <TableCell>{d.display_order}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleEdit(d)}><Pencil className="h-3 w-3" /></Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleDelete(d.id)}><Trash2 className="h-3 w-3" /></Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {departments.length === 0 && <TableRow><TableCell colSpan={3} className="text-center py-8 text-muted-foreground">No departments added yet</TableCell></TableRow>}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editId ? "Edit" : "Add"} Department</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div><Label>Department Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
            <div><Label>Display Order</Label><Input type="number" value={order} onChange={(e) => setOrder(Number(e.target.value))} /></div>
          </div>
          <DialogFooter><Button onClick={handleSave}>Save</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ReportDepartments;
