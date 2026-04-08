import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Plus, Search, Pencil, Trash2, Loader2, Lock, Unlock } from "lucide-react";
import { toast } from "sonner";
import {
  getHealthCheckups, saveHealthCheckup, deleteHealthCheckup,
  getHealthCheckupTests, linkTestToCheckup, unlinkTestFromCheckup,
  getHealthCheckupProfiles, linkProfileToCheckup, unlinkProfileFromCheckup,
  HealthCheckup,
} from "@/lib/healthCheckups";
import TestLinker from "@/components/TestLinker";
import ProfileLinker from "@/components/ProfileLinker";
import DeletePasswordDialog from "@/components/DeletePasswordDialog";

const INCENTIVE_PASSWORD = "9819111107";

const defaultForm = {
  health_checkup_name: "", display_name: "", price: "",
  fasting_required: true, discount_applicable: false,
  bold_in_report: true, show_in_report: true,
  incentive_allowed: false, incentive_amount: "",
  is_active: true,
};

const HealthCheckUpManagement = () => {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [deleteDialog, setDeleteDialog] = useState<string | null>(null);
  const [incentiveLocked, setIncentiveLocked] = useState(true);
  const [incentivePassword, setIncentivePassword] = useState("");
  const [form, setForm] = useState(defaultForm);

  const { data: items = [], isLoading } = useQuery({
    queryKey: ["health_checkups"],
    queryFn: getHealthCheckups,
  });

  const saveMutation = useMutation({
    mutationFn: async (values: typeof form) => {
      const payload = {
        health_checkup_name: values.health_checkup_name,
        display_name: values.display_name || null,
        price: parseFloat(values.price) || 0,
        fasting_required: values.fasting_required,
        discount_applicable: values.discount_applicable,
        bold_in_report: values.bold_in_report,
        show_in_report: values.show_in_report,
        incentive_allowed: values.incentive_allowed,
        incentive_amount: parseFloat(values.incentive_amount) || 0,
        is_active: values.is_active,
      };
      await saveHealthCheckup(payload, editing?.id);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["health_checkups"] }); setDialogOpen(false); resetForm(); toast.success("Health Check-Up saved"); },
    onError: (e: Error) => toast.error("Save failed: " + e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteHealthCheckup,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["health_checkups"] }); toast.success("Deleted"); },
    onError: (e: Error) => toast.error("Delete failed: " + e.message),
  });

  const resetForm = () => { setForm(defaultForm); setEditing(null); setIncentiveLocked(true); setIncentivePassword(""); };

  const openEdit = (t: HealthCheckup) => {
    setEditing(t);
    setForm({
      health_checkup_name: t.health_checkup_name,
      display_name: t.display_name || "",
      price: String(t.price),
      fasting_required: t.fasting_required,
      discount_applicable: t.discount_applicable,
      bold_in_report: t.bold_in_report,
      show_in_report: t.show_in_report,
      incentive_allowed: t.incentive_allowed,
      incentive_amount: t.incentive_amount ? String(t.incentive_amount) : "",
      is_active: t.is_active !== false,
    });
    setIncentiveLocked(true);
    setIncentivePassword("");
    setDialogOpen(true);
  };

  const filtered = items.filter((t) => {
    const matchesSearch = t.health_checkup_name.toLowerCase().includes(search.toLowerCase());
    const matchesActive = showInactive || t.is_active !== false;
    return matchesSearch && matchesActive;
  });

  const unlockIncentive = () => {
    if (incentivePassword === INCENTIVE_PASSWORD) { setIncentiveLocked(false); setIncentivePassword(""); }
    else { toast.error("Incorrect password"); setIncentivePassword(""); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-lg font-bold">Health Check-Up Management</h2>
        <Dialog open={dialogOpen} onOpenChange={(o) => { setDialogOpen(o); if (!o) resetForm(); }}>
          <DialogTrigger asChild><Button size="sm"><Plus className="h-4 w-4 mr-1" />Add Health Check-Up</Button></DialogTrigger>
          <DialogContent className="max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editing ? "Edit Health Check-Up" : "Add Health Check-Up"}</DialogTitle>
              <DialogDescription>{editing ? "Update the details below." : "Fill in the details below."}</DialogDescription>
            </DialogHeader>
            <form onSubmit={(e) => { e.preventDefault(); saveMutation.mutate(form); }} className="space-y-4">
              {editing?.health_checkup_code && (
                <div><Label className="text-xs text-muted-foreground">Code</Label><Input value={editing.health_checkup_code} disabled className="bg-muted font-mono text-sm" /></div>
              )}
              <div><Label>Health Check-Up Name *</Label><Input value={form.health_checkup_name} onChange={(e) => setForm(p => ({ ...p, health_checkup_name: e.target.value }))} required /></div>
              <div><Label>Display Name</Label><Input value={form.display_name} onChange={(e) => setForm(p => ({ ...p, display_name: e.target.value }))} placeholder="Optional" /></div>
              <div><Label>Price (₹) *</Label><Input type="number" value={form.price} onChange={(e) => setForm(p => ({ ...p, price: e.target.value }))} required /></div>

              <div className="grid grid-cols-2 gap-3">
                <div className="flex items-center gap-3"><Switch checked={form.fasting_required} onCheckedChange={(v) => setForm(p => ({ ...p, fasting_required: v }))} /><Label className="text-sm">Fasting Required</Label></div>
                <div className="flex items-center gap-3"><Switch checked={form.discount_applicable} onCheckedChange={(v) => setForm(p => ({ ...p, discount_applicable: v }))} /><Label className="text-sm">Discount Applicable</Label></div>
                <div className="flex items-center gap-3"><Switch checked={form.is_active} onCheckedChange={(v) => setForm(p => ({ ...p, is_active: v }))} /><Label className="text-sm">Active</Label></div>
              </div>

              <div className="border rounded-md p-3 space-y-3 bg-muted/30">
                <Label className="font-semibold text-sm">Report Settings</Label>
                <div className="grid grid-cols-1 gap-2">
                  <div className="flex items-center gap-3"><Switch checked={form.bold_in_report} onCheckedChange={(v) => setForm(p => ({ ...p, bold_in_report: v }))} /><Label className="text-sm">Bold in Report</Label></div>
                  <div className="flex items-center gap-3"><Switch checked={form.show_in_report} onCheckedChange={(v) => setForm(p => ({ ...p, show_in_report: v }))} /><Label className="text-sm">Show Display Name in Report</Label></div>
                </div>
              </div>

              <div className="border rounded-md p-3 space-y-3 bg-muted/30">
                <div className="flex items-center justify-between">
                  <Label className="font-semibold text-sm">Incentive Settings</Label>
                  {incentiveLocked ? (
                    <div className="flex items-center gap-2"><Lock className="h-4 w-4 text-muted-foreground" /><span className="text-xs text-muted-foreground">Locked</span></div>
                  ) : (
                    <div className="flex items-center gap-2"><Unlock className="h-4 w-4 text-emerald-600" /><span className="text-xs text-emerald-600">Unlocked</span></div>
                  )}
                </div>
                {incentiveLocked ? (
                  <div className="flex gap-2">
                    <Input type="password" placeholder="Enter password to unlock" value={incentivePassword} onChange={(e) => setIncentivePassword(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); unlockIncentive(); } }} />
                    <Button type="button" size="sm" variant="outline" onClick={unlockIncentive}>Unlock</Button>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-3"><Switch checked={form.incentive_allowed} onCheckedChange={(v) => setForm(p => ({ ...p, incentive_allowed: v, incentive_amount: v ? p.incentive_amount : "" }))} /><Label>Incentive Allowed</Label></div>
                    {form.incentive_allowed && (
                      <div><Label>Incentive Amount (₹)</Label><Input type="number" value={form.incentive_amount} onChange={(e) => setForm(p => ({ ...p, incentive_amount: e.target.value }))} /></div>
                    )}
                  </>
                )}
              </div>

              <Button type="submit" className="w-full" disabled={saveMutation.isPending}>
                {saveMutation.isPending ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" />Saving...</> : "Save"}
              </Button>
            </form>

            {editing?.id && (
              <TestLinker
                parentId={editing.id}
                parentLabel="Health Check-Up"
                fetchLinks={getHealthCheckupTests}
                linkTest={linkTestToCheckup}
                unlinkTest={unlinkTestFromCheckup}
              />
            )}
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex items-center gap-4">
        <div className="relative flex-1"><Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" /><Input className="pl-9" placeholder="Search health check-ups..." value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        <div className="flex items-center gap-2"><Switch checked={showInactive} onCheckedChange={setShowInactive} /><Label className="text-sm whitespace-nowrap">Show Inactive</Label></div>
      </div>

      {isLoading ? <p className="text-muted-foreground text-sm">Loading...</p> : (
        <div className="grid gap-2">
          {filtered.map((t) => (
            <Card key={t.id} className={`glass-card ${t.is_active === false ? "opacity-60" : ""}`}>
              <CardContent className="flex items-center justify-between p-3 gap-3">
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate">{t.health_checkup_name}</p>
                  <div className="flex flex-wrap gap-2 mt-1 text-xs text-muted-foreground">
                    <span className="font-mono">{t.health_checkup_code}</span>
                    <span>₹{t.price}</span>
                    {t.fasting_required && <span className="text-warning">Fasting</span>}
                    {t.incentive_allowed && <span className="text-primary">Incentive: ₹{t.incentive_amount}</span>}
                    <span className="text-blue-500">Package</span>
                    {t.is_active === false && <span className="text-destructive font-semibold">Inactive</span>}
                  </div>
                </div>
                <div className="flex gap-1">
                  <Button size="icon" variant="ghost" onClick={() => openEdit(t)}><Pencil className="h-3.5 w-3.5" /></Button>
                  <Button size="icon" variant="ghost" onClick={() => setDeleteDialog(t.id)}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
                </div>
              </CardContent>
            </Card>
          ))}
          {filtered.length === 0 && <p className="text-sm text-muted-foreground text-center py-8">No health check-ups found.</p>}
        </div>
      )}
      <DeletePasswordDialog
        open={!!deleteDialog}
        onOpenChange={(o) => !o && setDeleteDialog(null)}
        onSuccess={() => { if (deleteDialog) deleteMutation.mutate(deleteDialog); }}
        description="Delete this health check-up?"
      />
    </div>
  );
};

export default HealthCheckUpManagement;
