import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRealtimeSync } from "@/hooks/useRealtimeSync";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Search, Download, Upload, Trash2, Pencil, Loader2, Lock, Unlock } from "lucide-react";
import { toast } from "sonner";
import { exportToExcel, parseExcelFile, downloadTemplate } from "@/lib/excel";
import { getTests, saveTest, deleteTest, bulkInsertTests } from "@/lib/tests";
import ExportPasswordDialog from "@/components/ExportPasswordDialog";
import DeletePasswordDialog from "@/components/DeletePasswordDialog";

const INCENTIVE_PASSWORD = "9819111107";

const TestManagement = () => {
  useRealtimeSync("tests", ["tests"]);
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [exportDialog, setExportDialog] = useState(false);
  const [deleteDialog, setDeleteDialog] = useState<string | null>(null);
  const [incentiveLocked, setIncentiveLocked] = useState(true);
  const [incentivePassword, setIncentivePassword] = useState("");
  const [form, setForm] = useState({ test_name: "", price: "", fasting_required: false, discount_applicable: true, description: "", incentive_allowed: false, incentive_amount: "" });

  const { data: tests = [], isLoading, isError, error: queryError, refetch } = useQuery({
    queryKey: ["tests"],
    queryFn: getTests,
    retry: 2,
    retryDelay: 3000,
  });

  const saveMutation = useMutation({
    mutationFn: async (values: typeof form) => {
      const payload = { ...values, price: parseFloat(values.price) || 0, incentive_amount: parseFloat(values.incentive_amount) || 0 };
      await saveTest(payload, editing?.id);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["tests"] }); setDialogOpen(false); resetForm(); toast.success("Test saved"); },
    onError: (e: Error) => toast.error("Save failed: " + e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => { await deleteTest(id); },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["tests"] }); toast.success("Test deleted"); },
    onError: (e: Error) => toast.error("Delete failed: " + e.message),
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
        incentive_allowed: String(r["Incentive Allowed"]).toLowerCase() === "yes",
        incentive_amount: parseFloat(r["Incentive Amount"]) || 0,
      })).filter(t => t.test_name);
      if (tests.length === 0) throw new Error("No valid tests found");
      await bulkInsertTests(tests);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["tests"] }); toast.success("Tests uploaded"); },
    onError: (e: Error) => toast.error("Upload failed: " + e.message),
  });

  const resetForm = () => { setForm({ test_name: "", price: "", fasting_required: false, discount_applicable: true, description: "", incentive_allowed: false, incentive_amount: "" }); setEditing(null); setIncentiveLocked(true); setIncentivePassword(""); };

  const openEdit = (t: any) => {
    setEditing(t);
    setForm({ test_name: t.test_name, price: String(t.price), fasting_required: t.fasting_required, discount_applicable: t.discount_applicable, description: t.description || "", incentive_allowed: t.incentive_allowed || false, incentive_amount: t.incentive_amount ? String(t.incentive_amount) : "" });
    setIncentiveLocked(true);
    setIncentivePassword("");
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
          <Button size="sm" variant="outline" onClick={() => setExportDialog(true)}>
            <Download className="h-4 w-4 mr-1" />Export
          </Button>
          <Dialog open={dialogOpen} onOpenChange={(o) => { setDialogOpen(o); if (!o) resetForm(); }}>
            <DialogTrigger asChild><Button size="sm"><Plus className="h-4 w-4 mr-1" />Add Test</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{editing ? "Edit Test" : "Add Test"}</DialogTitle>
                <DialogDescription>{editing ? "Update the test details below." : "Fill in the test details below."}</DialogDescription>
              </DialogHeader>
              <form onSubmit={(e) => { e.preventDefault(); saveMutation.mutate(form); }} className="space-y-4">
                <div><Label>Test Name *</Label><Input value={form.test_name} onChange={(e) => setForm(p => ({ ...p, test_name: e.target.value }))} required /></div>
                <div><Label>Price (₹) *</Label><Input type="number" value={form.price} onChange={(e) => setForm(p => ({ ...p, price: e.target.value }))} required /></div>
                <div className="flex items-center gap-3"><Switch checked={form.fasting_required} onCheckedChange={(v) => setForm(p => ({ ...p, fasting_required: v }))} /><Label>Fasting Required</Label></div>
                <div className="flex items-center gap-3"><Switch checked={form.discount_applicable} onCheckedChange={(v) => setForm(p => ({ ...p, discount_applicable: v }))} /><Label>Discount Applicable</Label></div>
                <div><Label>Description</Label><Textarea value={form.description} onChange={(e) => setForm(p => ({ ...p, description: e.target.value }))} /></div>
                
                {/* Incentive fields - password protected */}
                <div className="border rounded-md p-3 space-y-3 bg-muted/30">
                  <div className="flex items-center justify-between">
                    <Label className="font-semibold text-sm">Incentive Settings</Label>
                    {incentiveLocked ? (
                      <div className="flex items-center gap-2">
                        <Lock className="h-4 w-4 text-muted-foreground" />
                        <span className="text-xs text-muted-foreground">Locked</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <Unlock className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                        <span className="text-xs text-emerald-600 dark:text-emerald-400">Unlocked</span>
                      </div>
                    )}
                  </div>
                  {incentiveLocked ? (
                    <div className="flex gap-2">
                      <Input
                        type="password"
                        placeholder="Enter password to unlock"
                        value={incentivePassword}
                        onChange={(e) => setIncentivePassword(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            if (incentivePassword === INCENTIVE_PASSWORD) { setIncentiveLocked(false); setIncentivePassword(""); } else { toast.error("Incorrect password"); setIncentivePassword(""); }
                          }
                        }}
                      />
                      <Button type="button" size="sm" variant="outline" onClick={() => {
                        if (incentivePassword === INCENTIVE_PASSWORD) { setIncentiveLocked(false); setIncentivePassword(""); } else { toast.error("Incorrect password"); setIncentivePassword(""); }
                      }}>Unlock</Button>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center gap-3"><Switch checked={form.incentive_allowed} onCheckedChange={(v) => setForm(p => ({ ...p, incentive_allowed: v, incentive_amount: v ? p.incentive_amount : "" }))} /><Label>Incentive Allowed</Label></div>
                      {form.incentive_allowed && (
                        <div><Label>Incentive Amount (₹)</Label><Input type="number" value={form.incentive_amount} onChange={(e) => setForm(p => ({ ...p, incentive_amount: e.target.value }))} placeholder="Enter incentive amount" /></div>
                      )}
                    </>
                  )}
                </div>

                <Button type="submit" className="w-full" disabled={saveMutation.isPending}>
                  {saveMutation.isPending ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" />Saving...</> : "Save"}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" /><Input className="pl-9" placeholder="Search tests..." value={search} onChange={(e) => setSearch(e.target.value)} /></div>

      {isLoading ? <p className="text-muted-foreground text-sm">Loading...</p> : isError ? (
        <Card className="glass-card">
          <CardContent className="p-6 text-center space-y-3">
            <p className="text-sm text-destructive font-medium">Could not reach backend. {queryError?.message || ""}</p>
            <Button size="sm" variant="outline" onClick={() => refetch()}>Retry</Button>
          </CardContent>
        </Card>
      ) : (
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
                    {t.incentive_allowed && <span className="text-primary">Incentive: ₹{t.incentive_amount}</span>}
                  </div>
                </div>
                <div className="flex gap-1">
                  <Button size="icon" variant="ghost" onClick={() => openEdit(t)}><Pencil className="h-3.5 w-3.5" /></Button>
                  <Button size="icon" variant="ghost" onClick={() => setDeleteDialog(t.id)}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
                </div>
              </CardContent>
            </Card>
          ))}
          {filtered.length === 0 && <p className="text-sm text-muted-foreground text-center py-8">No tests found.</p>}
        </div>
      )}
      <ExportPasswordDialog open={exportDialog} onOpenChange={setExportDialog} onSuccess={() => exportToExcel(tests.map((t: any) => ({ "Test Name": t.test_name, Price: t.price, "Fasting Required": t.fasting_required ? "Yes" : "No", "Discount Applicable": t.discount_applicable ? "Yes" : "No", Description: t.description, "Incentive Allowed": t.incentive_allowed ? "Yes" : "No", "Incentive Amount": t.incentive_amount || 0 })), "tests_export")} />
      <DeletePasswordDialog
        open={!!deleteDialog}
        onOpenChange={(o) => !o && setDeleteDialog(null)}
        onSuccess={() => { if (deleteDialog) deleteMutation.mutate(deleteDialog); }}
        description="Delete this test?"
      />
    </div>
  );
};

export default TestManagement;
