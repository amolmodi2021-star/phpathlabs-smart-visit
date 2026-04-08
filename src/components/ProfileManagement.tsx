import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Search, Pencil, Trash2, Loader2, Lock, Unlock } from "lucide-react";
import { toast } from "sonner";
import {
  getBillingProfiles, saveBillingProfile, deleteBillingProfile,
  getBillingProfileTests, linkTestToProfile, unlinkTestFromProfile,
  BillingProfile,
} from "@/lib/billingProfiles";
import TestLinker from "@/components/TestLinker";
import DeletePasswordDialog from "@/components/DeletePasswordDialog";

const INCENTIVE_PASSWORD = "9819111107";

const defaultForm = {
  profile_name: "", display_name: "", price: "", department_id: "",
  fasting_required: false, discount_applicable: false, is_outsourced: false,
  bold_in_report: true, show_in_report: true,
  instrument_name: "", method: "", sample_type: "", interpretation: "", description: "",
  incentive_allowed: false, incentive_amount: "",
};

const ProfileManagement = () => {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [deleteDialog, setDeleteDialog] = useState<string | null>(null);
  const [incentiveLocked, setIncentiveLocked] = useState(true);
  const [incentivePassword, setIncentivePassword] = useState("");
  const [form, setForm] = useState(defaultForm);

  const { data: items = [], isLoading } = useQuery({
    queryKey: ["billing_profiles"],
    queryFn: getBillingProfiles,
  });

  const { data: departments = [] } = useQuery({
    queryKey: ["departments"],
    queryFn: async () => {
      const { data } = await supabase.from("report_departments").select("*").order("display_order");
      return data || [];
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (values: typeof form) => {
      const payload = {
        profile_name: values.profile_name,
        display_name: values.display_name || null,
        price: parseFloat(values.price) || 0,
        department_id: values.department_id || null,
        fasting_required: values.fasting_required,
        discount_applicable: values.discount_applicable,
        is_outsourced: values.is_outsourced,
        bold_in_report: values.bold_in_report,
        show_in_report: values.show_in_report,
        instrument_name: values.instrument_name || null,
        method: values.method || null,
        sample_type: values.sample_type || null,
        interpretation: values.interpretation || null,
        description: values.description || null,
        incentive_allowed: values.incentive_allowed,
        incentive_amount: parseFloat(values.incentive_amount) || 0,
      };
      await saveBillingProfile(payload, editing?.id);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["billing_profiles"] }); setDialogOpen(false); resetForm(); toast.success("Profile saved"); },
    onError: (e: Error) => toast.error("Save failed: " + e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteBillingProfile,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["billing_profiles"] }); toast.success("Deleted"); },
    onError: (e: Error) => toast.error("Delete failed: " + e.message),
  });

  const resetForm = () => { setForm(defaultForm); setEditing(null); setIncentiveLocked(true); setIncentivePassword(""); };

  const openEdit = (t: BillingProfile) => {
    setEditing(t);
    setForm({
      profile_name: t.profile_name,
      display_name: t.display_name || "",
      price: String(t.price),
      department_id: t.department_id || "",
      fasting_required: t.fasting_required,
      discount_applicable: t.discount_applicable,
      is_outsourced: t.is_outsourced,
      bold_in_report: t.bold_in_report,
      show_in_report: t.show_in_report,
      instrument_name: t.instrument_name || "",
      method: t.method || "",
      sample_type: t.sample_type || "",
      interpretation: t.interpretation || "",
      description: t.description || "",
      incentive_allowed: t.incentive_allowed,
      incentive_amount: t.incentive_amount ? String(t.incentive_amount) : "",
    });
    setIncentiveLocked(true);
    setIncentivePassword("");
    setDialogOpen(true);
  };

  const filtered = items.filter((t) => t.profile_name.toLowerCase().includes(search.toLowerCase()));

  const unlockIncentive = () => {
    if (incentivePassword === INCENTIVE_PASSWORD) { setIncentiveLocked(false); setIncentivePassword(""); }
    else { toast.error("Incorrect password"); setIncentivePassword(""); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-lg font-bold">Profile Management</h2>
        <Dialog open={dialogOpen} onOpenChange={(o) => { setDialogOpen(o); if (!o) resetForm(); }}>
          <DialogTrigger asChild><Button size="sm"><Plus className="h-4 w-4 mr-1" />Add Profile</Button></DialogTrigger>
          <DialogContent className="max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editing ? "Edit Profile" : "Add Profile"}</DialogTitle>
              <DialogDescription>{editing ? "Update the details below." : "Fill in the details below."}</DialogDescription>
            </DialogHeader>
            <form onSubmit={(e) => { e.preventDefault(); saveMutation.mutate(form); }} className="space-y-4">
              {editing?.profile_code && (
                <div><Label className="text-xs text-muted-foreground">Code</Label><Input value={editing.profile_code} disabled className="bg-muted font-mono text-sm" /></div>
              )}
              <div><Label>Profile Name *</Label><Input value={form.profile_name} onChange={(e) => setForm(p => ({ ...p, profile_name: e.target.value }))} required /></div>
              <div><Label>Display Name</Label><Input value={form.display_name} onChange={(e) => setForm(p => ({ ...p, display_name: e.target.value }))} placeholder="Optional" /></div>
              <div><Label>Price (₹) *</Label><Input type="number" value={form.price} onChange={(e) => setForm(p => ({ ...p, price: e.target.value }))} required /></div>

              <div>
                <Label>Department</Label>
                <Select value={form.department_id} onValueChange={(v) => setForm(p => ({ ...p, department_id: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select department" /></SelectTrigger>
                  <SelectContent>
                    {departments.map((d: any) => (
                      <SelectItem key={d.id} value={d.id}>{d.department_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="flex items-center gap-3"><Switch checked={form.fasting_required} onCheckedChange={(v) => setForm(p => ({ ...p, fasting_required: v }))} /><Label className="text-sm">Fasting Required</Label></div>
                <div className="flex items-center gap-3"><Switch checked={form.discount_applicable} onCheckedChange={(v) => setForm(p => ({ ...p, discount_applicable: v }))} /><Label className="text-sm">Discount Applicable</Label></div>
                <div className="flex items-center gap-3"><Switch checked={form.is_outsourced} onCheckedChange={(v) => setForm(p => ({ ...p, is_outsourced: v }))} /><Label className="text-sm">Mark as Outsourced</Label></div>
              </div>

              <div className="border rounded-md p-3 space-y-3 bg-muted/30">
                <Label className="font-semibold text-sm">Report Settings</Label>
                <div className="grid grid-cols-1 gap-2">
                  <div className="flex items-center gap-3"><Switch checked={form.bold_in_report} onCheckedChange={(v) => setForm(p => ({ ...p, bold_in_report: v }))} /><Label className="text-sm">Bold in Report</Label></div>
                  <div className="flex items-center gap-3"><Switch checked={form.show_in_report} onCheckedChange={(v) => setForm(p => ({ ...p, show_in_report: v }))} /><Label className="text-sm">Show Display Name in Report</Label></div>
                </div>
              </div>

              <div className="border rounded-md p-3 space-y-3 bg-muted/30">
                <Label className="font-semibold text-sm">Lab Details</Label>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label className="text-sm">Instrument Name</Label><Input value={form.instrument_name} onChange={(e) => setForm(p => ({ ...p, instrument_name: e.target.value }))} /></div>
                  <div><Label className="text-sm">Method</Label><Input value={form.method} onChange={(e) => setForm(p => ({ ...p, method: e.target.value }))} /></div>
                  <div><Label className="text-sm">Sample Type</Label><Input value={form.sample_type} onChange={(e) => setForm(p => ({ ...p, sample_type: e.target.value }))} /></div>
                </div>
                <div><Label className="text-sm">Interpretation</Label><Textarea value={form.interpretation} onChange={(e) => setForm(p => ({ ...p, interpretation: e.target.value }))} rows={3} /></div>
              </div>

              <div><Label>Description</Label><Textarea value={form.description} onChange={(e) => setForm(p => ({ ...p, description: e.target.value }))} /></div>

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
                parentLabel="Profile"
                fetchLinks={getBillingProfileTests}
                linkTest={linkTestToProfile}
                unlinkTest={unlinkTestFromProfile}
              />
            )}
          </DialogContent>
        </Dialog>
      </div>

      <div className="relative"><Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" /><Input className="pl-9" placeholder="Search profiles..." value={search} onChange={(e) => setSearch(e.target.value)} /></div>

      {isLoading ? <p className="text-muted-foreground text-sm">Loading...</p> : (
        <div className="grid gap-2">
          {filtered.map((t) => (
            <Card key={t.id} className="glass-card">
              <CardContent className="flex items-center justify-between p-3 gap-3">
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate">{t.profile_name}</p>
                  <div className="flex flex-wrap gap-2 mt-1 text-xs text-muted-foreground">
                    <span className="font-mono">{t.profile_code}</span>
                    <span>₹{t.price}</span>
                    {t.fasting_required && <span className="text-warning">Fasting</span>}
                    {t.is_outsourced && <span className="text-orange-500">Outsourced</span>}
                    {t.incentive_allowed && <span className="text-primary">Incentive: ₹{t.incentive_amount}</span>}
                    <span className="text-purple-500">Profile</span>
                  </div>
                </div>
                <div className="flex gap-1">
                  <Button size="icon" variant="ghost" onClick={() => openEdit(t)}><Pencil className="h-3.5 w-3.5" /></Button>
                  <Button size="icon" variant="ghost" onClick={() => setDeleteDialog(t.id)}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
                </div>
              </CardContent>
            </Card>
          ))}
          {filtered.length === 0 && <p className="text-sm text-muted-foreground text-center py-8">No profiles found.</p>}
        </div>
      )}
      <DeletePasswordDialog
        open={!!deleteDialog}
        onOpenChange={(o) => !o && setDeleteDialog(null)}
        onSuccess={() => { if (deleteDialog) deleteMutation.mutate(deleteDialog); }}
        description="Delete this profile?"
      />
    </div>
  );
};

export default ProfileManagement;
