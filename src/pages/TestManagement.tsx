import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Search, Download, Upload, Trash2, Pencil } from "lucide-react";
import { toast } from "sonner";
import { exportToExcel, parseExcelFile, downloadTemplate } from "@/lib/excel";

const TestManagement = () => {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({ test_name: "", price: "", fasting_required: false, discount_applicable: true, description: "" });

  const { data: tests = [], isLoading } = useQuery({
    queryKey: ["tests"],
    queryFn: async () => {
      const { data } = await supabase.from("tests").select("*").order("test_name");
      return data || [];
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (values: typeof form) => {
      const payload = { ...values, price: parseFloat(values.price) || 0 };
      if (editing) {
        await supabase.from("tests").update(payload).eq("id", editing.id);
      } else {
        await supabase.from("tests").insert(payload);
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["tests"] }); setDialogOpen(false); resetForm(); toast.success("Test saved"); },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => { await supabase.from("tests").delete().eq("id", id); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["tests"] }); toast.success("Test deleted"); },
  });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const rows = await parseExcelFile(file);
      const tests = rows.map((r: any) => ({
        test_name: r["Test Name"] || "",
        price: parseFloat(r["Price"]) || 0,
        fasting_required: String(r["Fasting Required"]).toLowerCase() === "yes",
        discount_applicable: String(r["Discount Applicable"]).toLowerCase() !== "no",
        description: r["Description"] || "",
      })).filter(t => t.test_name);
      if (tests.length === 0) throw new Error("No valid tests found");
      await supabase.from("tests").insert(tests);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["tests"] }); toast.success("Tests uploaded"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const resetForm = () => { setForm({ test_name: "", price: "", fasting_required: false, discount_applicable: true, description: "" }); setEditing(null); };

  const openEdit = (t: any) => {
    setEditing(t);
    setForm({ test_name: t.test_name, price: String(t.price), fasting_required: t.fasting_required, discount_applicable: t.discount_applicable, description: t.description || "" });
    setDialogOpen(true);
  };

  const filtered = tests.filter((t: any) => t.test_name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-xl font-bold">Test Management</h1>
        <div className="flex gap-2 flex-wrap">
          <Button size="sm" variant="outline" onClick={downloadTemplate}><Download className="h-4 w-4 mr-1" />Template</Button>
          <Button size="sm" variant="outline" onClick={() => document.getElementById("excel-upload")?.click()}>
            <Upload className="h-4 w-4 mr-1" />Upload
          </Button>
          <input id="excel-upload" type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => { if (e.target.files?.[0]) uploadMutation.mutate(e.target.files[0]); e.target.value = ""; }} />
          <Button size="sm" variant="outline" onClick={() => exportToExcel(tests.map((t: any) => ({ "Test Name": t.test_name, Price: t.price, "Fasting Required": t.fasting_required ? "Yes" : "No", "Discount Applicable": t.discount_applicable ? "Yes" : "No", Description: t.description })), "tests_export")}>
            <Download className="h-4 w-4 mr-1" />Export
          </Button>
          <Dialog open={dialogOpen} onOpenChange={(o) => { setDialogOpen(o); if (!o) resetForm(); }}>
            <DialogTrigger asChild><Button size="sm"><Plus className="h-4 w-4 mr-1" />Add Test</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>{editing ? "Edit Test" : "Add Test"}</DialogTitle></DialogHeader>
              <form onSubmit={(e) => { e.preventDefault(); saveMutation.mutate(form); }} className="space-y-4">
                <div><Label>Test Name *</Label><Input value={form.test_name} onChange={(e) => setForm(p => ({ ...p, test_name: e.target.value }))} required /></div>
                <div><Label>Price (₹) *</Label><Input type="number" value={form.price} onChange={(e) => setForm(p => ({ ...p, price: e.target.value }))} required /></div>
                <div className="flex items-center gap-3"><Switch checked={form.fasting_required} onCheckedChange={(v) => setForm(p => ({ ...p, fasting_required: v }))} /><Label>Fasting Required</Label></div>
                <div className="flex items-center gap-3"><Switch checked={form.discount_applicable} onCheckedChange={(v) => setForm(p => ({ ...p, discount_applicable: v }))} /><Label>Discount Applicable</Label></div>
                <div><Label>Description</Label><Textarea value={form.description} onChange={(e) => setForm(p => ({ ...p, description: e.target.value }))} /></div>
                <Button type="submit" className="w-full" disabled={saveMutation.isPending}>Save</Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" /><Input className="pl-9" placeholder="Search tests..." value={search} onChange={(e) => setSearch(e.target.value)} /></div>

      {isLoading ? <p className="text-muted-foreground text-sm">Loading...</p> : (
        <div className="grid gap-2">
          {filtered.map((t: any) => (
            <Card key={t.id} className="glass-card">
              <CardContent className="flex items-center justify-between p-3 gap-3">
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate">{t.test_name}</p>
                  <div className="flex flex-wrap gap-2 mt-1 text-xs text-muted-foreground">
                    <span>₹{t.price}</span>
                    {t.fasting_required && <span className="text-warning">Fasting</span>}
                    {!t.discount_applicable && <span className="text-destructive">No Discount</span>}
                  </div>
                </div>
                <div className="flex gap-1">
                  <Button size="icon" variant="ghost" onClick={() => openEdit(t)}><Pencil className="h-3.5 w-3.5" /></Button>
                  <Button size="icon" variant="ghost" onClick={() => deleteMutation.mutate(t.id)}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
                </div>
              </CardContent>
            </Card>
          ))}
          {filtered.length === 0 && <p className="text-sm text-muted-foreground text-center py-8">No tests found.</p>}
        </div>
      )}
    </div>
  );
};

export default TestManagement;
