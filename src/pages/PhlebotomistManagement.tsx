import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useRealtimeSync } from "@/hooks/useRealtimeSync";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Plus, Search, Pencil, Trash2, Phone, CalendarDays } from "lucide-react";
import { toast } from "sonner";
import DeletePasswordDialog from "@/components/DeletePasswordDialog";
import PhlebotomistLeavesDialog from "@/components/PhlebotomistLeavesDialog";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const PhlebotomistManagement = () => {
  useRealtimeSync("phlebotomists", ["phlebotomists"]);
  useRealtimeSync("phlebotomist_leaves", ["phlebotomist_leaves"]);
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [deleteDialog, setDeleteDialog] = useState<string | null>(null);
  const [leavesPhlebotomist, setLeavesPhlebotomist] = useState<any>(null);
  const [form, setForm] = useState({ name: "", mobile: "", alternate_mobile: "", area_zone: "", status: "Active", notes: "" });

  const { data: list = [] } = useQuery({
    queryKey: ["phlebotomists"],
    queryFn: async () => { const { data } = await supabase.from("phlebotomists").select("*").order("name"); return data || []; },
  });

  const saveMutation = useMutation({
    mutationFn: async (v: typeof form) => {
      const payload = { ...v, name: v.name.toUpperCase(), area_zone: v.area_zone ? v.area_zone.toUpperCase() : "", notes: v.notes ? v.notes.toUpperCase() : "" };
      if (editing) { const { error } = await supabase.from("phlebotomists").update(payload).eq("id", editing.id); if (error) throw error; }
      else { const { error } = await supabase.from("phlebotomists").insert(payload); if (error) throw error; }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["phlebotomists"] }); setDialogOpen(false); resetForm(); toast.success("Saved"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from("phlebotomists").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["phlebotomists"] }); toast.success("Deleted"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const resetForm = () => { setForm({ name: "", mobile: "", alternate_mobile: "", area_zone: "", status: "Active", notes: "" }); setEditing(null); };

  const openEdit = (p: any) => {
    setEditing(p);
    setForm({ name: p.name, mobile: p.mobile, alternate_mobile: p.alternate_mobile || "", area_zone: p.area_zone || "", status: p.status, notes: p.notes || "" });
    setDialogOpen(true);
  };

  const filtered = list.filter((p: any) => p.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-bold">Phlebotomists</h1>
        <Dialog open={dialogOpen} onOpenChange={(o) => { setDialogOpen(o); if (!o) resetForm(); }}>
          <DialogTrigger asChild><Button size="sm"><Plus className="h-4 w-4 mr-1" />Add</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>{editing ? "Edit" : "Add"} Phlebotomist</DialogTitle></DialogHeader>
            <form onSubmit={(e) => { e.preventDefault(); saveMutation.mutate(form); }} className="space-y-4">
              <div><Label>Name *</Label><Input value={form.name} onChange={(e) => setForm(p => ({ ...p, name: e.target.value }))} required /></div>
              <div><Label>Mobile *</Label><Input value={form.mobile} onChange={(e) => setForm(p => ({ ...p, mobile: e.target.value }))} required /></div>
              <div><Label>Alternate Mobile</Label><Input value={form.alternate_mobile} onChange={(e) => setForm(p => ({ ...p, alternate_mobile: e.target.value }))} /></div>
              <div><Label>Area / Zone</Label><Input value={form.area_zone} onChange={(e) => setForm(p => ({ ...p, area_zone: e.target.value }))} /></div>
              <div>
                <Label>Status</Label>
                <Select value={form.status} onValueChange={(v) => setForm(p => ({ ...p, status: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="Active">Active</SelectItem><SelectItem value="Inactive">Inactive</SelectItem></SelectContent>
                </Select>
              </div>
              <div><Label>Notes</Label><Textarea value={form.notes} onChange={(e) => setForm(p => ({ ...p, notes: e.target.value }))} /></div>
              <Button type="submit" className="w-full" disabled={saveMutation.isPending}>Save</Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" /><Input className="pl-9" placeholder="Search..." value={search} onChange={(e) => setSearch(e.target.value)} /></div>

      <div className="grid gap-2">
        {filtered.map((p: any) => {
          const weeklyOff: number[] = p.weekly_off_days || [];
          return (
            <Card key={p.id} className="glass-card">
              <CardContent className="p-3 space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm">{p.name}</p>
                    <div className="flex gap-2 mt-1 text-xs text-muted-foreground">
                      <span>{p.mobile}</span>
                      {p.area_zone && <span>• {p.area_zone}</span>}
                      <span className={p.status === "Active" ? "text-success" : "text-destructive"}>{p.status}</span>
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <Button size="icon" variant="ghost" onClick={() => setLeavesPhlebotomist(p)} title="Manage availability"><CalendarDays className="h-3.5 w-3.5" /></Button>
                    <Button size="icon" variant="ghost" onClick={() => window.open(`tel:${p.mobile}`)}><Phone className="h-3.5 w-3.5" /></Button>
                    <Button size="icon" variant="ghost" onClick={() => openEdit(p)}><Pencil className="h-3.5 w-3.5" /></Button>
                    <Button size="icon" variant="ghost" onClick={() => setDeleteDialog(p.id)}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
                  </div>
                </div>
                {weeklyOff.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    <span className="text-xs text-muted-foreground">Weekly off:</span>
                    {weeklyOff.map((d) => (
                      <Badge key={d} variant="secondary" className="text-xs px-1.5 py-0">{DAY_LABELS[d]}</Badge>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
        {filtered.length === 0 && <p className="text-sm text-muted-foreground text-center py-8">No phlebotomists found.</p>}
      </div>

      <DeletePasswordDialog
        open={!!deleteDialog}
        onOpenChange={(o) => !o && setDeleteDialog(null)}
        onSuccess={() => { if (deleteDialog) deleteMutation.mutate(deleteDialog); }}
        description="Delete this phlebotomist?"
      />

      <PhlebotomistLeavesDialog
        open={!!leavesPhlebotomist}
        onClose={() => setLeavesPhlebotomist(null)}
        phlebotomist={leavesPhlebotomist}
      />
    </div>
  );
};

export default PhlebotomistManagement;
