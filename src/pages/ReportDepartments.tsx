import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2, Loader2, GripVertical } from "lucide-react";
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, DragEndEvent } from "@dnd-kit/core";
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

const SortableRow = ({ dept, onEdit, onDelete }: { dept: any; onEdit: () => void; onDelete: () => void }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: dept.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };

  return (
    <div ref={setNodeRef} style={style} className="flex items-center gap-3 px-4 py-3 border-b last:border-b-0 bg-background">
      <button type="button" className="cursor-grab touch-none text-muted-foreground" {...attributes} {...listeners}>
        <GripVertical className="h-4 w-4" />
      </button>
      <span className="flex-1 font-medium text-sm">{dept.department_name}</span>
      <span className="text-xs text-muted-foreground w-12 text-center">{dept.display_order}</span>
      <div className="flex gap-1">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onEdit}><Pencil className="h-3 w-3" /></Button>
        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={onDelete}><Trash2 className="h-3 w-3" /></Button>
      </div>
    </div>
  );
};

const ReportDepartments = () => {
  const [departments, setDepartments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const { toast } = useToast();

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const load = async () => {
    setLoading(true);
    const { data } = await supabase.from("report_departments").select("*").order("display_order");
    setDepartments(data || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = departments.findIndex((d) => d.id === active.id);
    const newIndex = departments.findIndex((d) => d.id === over.id);
    const reordered = arrayMove(departments, oldIndex, newIndex).map((d, i) => ({ ...d, display_order: i + 1 }));
    setDepartments(reordered);

    // Persist all order changes
    await Promise.all(
      reordered.map((d) => supabase.from("report_departments").update({ display_order: d.display_order }).eq("id", d.id))
    );
    toast({ title: "Order updated" });
  };

  const handleSave = async () => {
    if (!name.trim()) return;
    if (editId) {
      await supabase.from("report_departments").update({ department_name: name.trim() }).eq("id", editId);
    } else {
      const newOrder = departments.length > 0 ? Math.max(...departments.map(d => d.display_order || 0)) + 1 : 1;
      await supabase.from("report_departments").insert({ department_name: name.trim(), display_order: newOrder });
    }
    setDialogOpen(false);
    setEditId(null);
    setName("");
    load();
    toast({ title: editId ? "Department updated" : "Department added" });
  };

  const handleEdit = (d: any) => {
    setEditId(d.id);
    setName(d.department_name);
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
        <Button onClick={() => { setEditId(null); setName(""); setDialogOpen(true); }}><Plus className="h-4 w-4 mr-2" />Add Department</Button>
      </div>

      <Card>
        <CardContent className="pt-6">
          {loading ? <div className="flex justify-center p-8"><Loader2 className="h-6 w-6 animate-spin" /></div> : departments.length === 0 ? (
            <p className="text-center py-8 text-muted-foreground">No departments added yet</p>
          ) : (
            <>
              <div className="flex items-center gap-3 px-4 py-2 text-xs font-medium text-muted-foreground border-b">
                <span className="w-4" />
                <span className="flex-1">Department Name</span>
                <span className="w-12 text-center">Order</span>
                <span className="w-[72px]">Actions</span>
              </div>
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={departments.map(d => d.id)} strategy={verticalListSortingStrategy}>
                  {departments.map((d) => (
                    <SortableRow key={d.id} dept={d} onEdit={() => handleEdit(d)} onDelete={() => handleDelete(d.id)} />
                  ))}
                </SortableContext>
              </DndContext>
            </>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editId ? "Edit" : "Add"} Department</DialogTitle></DialogHeader>
          <div><Label>Department Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
          <DialogFooter><Button onClick={handleSave}>Save</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ReportDepartments;
