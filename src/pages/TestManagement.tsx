import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRealtimeSync } from "@/hooks/useRealtimeSync";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Search, Download, Upload, Trash2, Pencil, Loader2, Lock, Unlock, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { exportToExcel, parseExcelFile, downloadTemplate } from "@/lib/excel";
import { getTests, saveTest, deleteTest, bulkInsertTests, getTestSampleTubes, saveTestSampleTubes, type TestSampleTube } from "@/lib/tests";
import TestParameterManager from "@/components/TestParameterManager";
import ExportPasswordDialog from "@/components/ExportPasswordDialog";
import DeletePasswordDialog from "@/components/DeletePasswordDialog";
import HealthCheckUpManagement from "@/components/HealthCheckUpManagement";
import ProfileManagement from "@/components/ProfileManagement";
import ReportParameters from "@/pages/ReportParameters";
import ReportDepartments from "@/pages/ReportDepartments";
import MasterLookupSettings from "@/components/MasterLookupSettings";
import MasterLookupSelect from "@/components/MasterLookupSelect";

const INCENTIVE_PASSWORD = "9819111107";

const defaultForm = {
  test_name: "", price: "", fasting_required: false, discount_applicable: true,
  description: "", incentive_allowed: false, incentive_amount: "",
  display_name: "", bold_in_report: false, show_in_report: true, is_single_parameter: false,
  instrument_name: "", method: "", sample_type: "", sample_tube: "", tube_color: "", interpretation: "",
  is_outsourced: false, outsourced_caption: "", department_id: "",
  is_active: true, fit_to_page: false, dedicated_page: false,
};

const TUBE_COLOR_MAP: Record<string, string> = {
  red: "#e53e3e", purple: "#9f7aea", lavender: "#b794f4", yellow: "#ecc94b",
  green: "#48bb78", blue: "#4299e1", gray: "#a0aec0", grey: "#a0aec0",
  gold: "#d69e2e", orange: "#ed8936", pink: "#ed64a6", black: "#1a202c",
  white: "#ffffff", "light blue": "#63b3ed",
};

function TubeColorDot({ color }: { color: string }) {
  const c = color.toLowerCase().trim();
  const hex = TUBE_COLOR_MAP[c] || c;
  const isValid = hex.startsWith("#") || hex.startsWith("rgb") || TUBE_COLOR_MAP[c];
  if (!isValid) return null;
  return (
    <span
      className="inline-block w-6 h-6 rounded-full border-2 border-muted-foreground/30 flex-shrink-0"
      style={{ backgroundColor: hex }}
      title={color}
    />
  );
}

const TestManagement = () => {
  useRealtimeSync("tests", ["tests"]);
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [exportDialog, setExportDialog] = useState(false);
  const [deleteDialog, setDeleteDialog] = useState<string | null>(null);
  const [incentiveLocked, setIncentiveLocked] = useState(true);
  const [incentivePassword, setIncentivePassword] = useState("");
  const [form, setForm] = useState(defaultForm);
  const [sampleTubes, setSampleTubes] = useState<TestSampleTube[]>([]);

  // Load multi-tubes when editing
  useEffect(() => {
    if (editing?.id) {
      getTestSampleTubes(editing.id).then((tubes) => {
        if (tubes.length > 0) {
          setSampleTubes(tubes);
        } else if (editing.sample_tube) {
          // Seed from legacy single-tube column so user sees current value
          setSampleTubes([{
            tube_value: editing.sample_tube,
            sample_type: editing.sample_type || "",
            tube_color: editing.tube_color || "",
            display_order: 0,
          }]);
        } else {
          setSampleTubes([]);
        }
      }).catch(() => setSampleTubes([]));
    } else {
      setSampleTubes([]);
    }
  }, [editing?.id]);

  const { data: tests = [], isLoading, isError, error: queryError, refetch } = useQuery({
    queryKey: ["tests"],
    queryFn: getTests,
    retry: 2,
    retryDelay: 3000,
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
      // Sync legacy single columns from first multi-tube row (backward compat)
      const firstTube = sampleTubes.find(t => t.tube_value && t.tube_value.trim() !== "");
      const legacyTube = firstTube?.tube_value || values.sample_tube || null;
      const legacyType = firstTube?.sample_type || values.sample_type || null;
      const legacyColor = firstTube?.tube_color || values.tube_color || null;

      const payload = {
        test_name: values.test_name,
        price: parseFloat(values.price) || 0,
        fasting_required: values.fasting_required,
        discount_applicable: values.discount_applicable,
        description: values.description,
        incentive_allowed: values.incentive_allowed,
        incentive_amount: parseFloat(values.incentive_amount) || 0,
        display_name: values.display_name || null,
        bold_in_report: values.bold_in_report,
        show_in_report: values.show_in_report,
        is_single_parameter: values.is_single_parameter,
        instrument_name: values.instrument_name || null,
        method: values.method || null,
        sample_type: legacyType,
        sample_tube: legacyTube,
        tube_color: legacyColor,
        interpretation: values.interpretation || null,
        is_outsourced: values.is_outsourced,
        outsourced_caption: values.outsourced_caption || null,
        department_id: values.department_id || null,
        is_active: values.is_active,
        fit_to_page: values.fit_to_page,
        dedicated_page: values.dedicated_page,
      };
      await saveTest(payload, editing?.id);

      // Save multi-tubes — need test id; for new tests fetch the just-inserted row by name
      let testId: string | undefined = editing?.id;
      if (!testId) {
        const { data: latest } = await supabase
          .from("tests")
          .select("id")
          .eq("test_name", values.test_name)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        testId = latest?.id;
      }
      if (testId) {
        await saveTestSampleTubes(testId, sampleTubes);
      }
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

  const resetForm = () => { setForm(defaultForm); setEditing(null); setIncentiveLocked(true); setIncentivePassword(""); setSampleTubes([]); };

  const openEdit = (t: any) => {
    setEditing(t);
    setForm({
      test_name: t.test_name, price: String(t.price),
      fasting_required: t.fasting_required, discount_applicable: t.discount_applicable,
      description: t.description || "", incentive_allowed: t.incentive_allowed || false,
      incentive_amount: t.incentive_amount ? String(t.incentive_amount) : "",
      display_name: t.display_name || "", bold_in_report: t.bold_in_report ?? false,
      show_in_report: t.show_in_report ?? true, is_single_parameter: t.is_single_parameter ?? false,
      instrument_name: t.instrument_name || "", method: t.method || "",
      sample_type: t.sample_type || "", sample_tube: t.sample_tube || "",
      tube_color: (t as any).tube_color || "",
      interpretation: t.interpretation || "",
      is_outsourced: t.is_outsourced ?? false, outsourced_caption: t.outsourced_caption || "",
      department_id: t.department_id || "",
      is_active: t.is_active !== false,
      fit_to_page: t.fit_to_page ?? false, dedicated_page: t.dedicated_page ?? false,
    });
    setIncentiveLocked(true);
    setIncentivePassword("");
    setDialogOpen(true);
  };

  const filtered = tests.filter((t: any) => {
    const matchesSearch = t.test_name.toLowerCase().includes(search.toLowerCase());
    const matchesActive = showInactive || t.is_active !== false;
    return matchesSearch && matchesActive;
  });

  const unlockIncentive = () => {
    if (incentivePassword === INCENTIVE_PASSWORD) { setIncentiveLocked(false); setIncentivePassword(""); }
    else { toast.error("Incorrect password"); setIncentivePassword(""); }
  };

  return (
    <div className="space-y-4 animate-fade-in">
      <h1 className="text-xl font-bold">Test Management</h1>
      <Tabs defaultValue="tests" className="w-full">
        <TabsList className="grid w-full grid-cols-6">
          <TabsTrigger value="tests">Tests</TabsTrigger>
          <TabsTrigger value="health_checkups">Health Check-Ups</TabsTrigger>
          <TabsTrigger value="profiles">Profiles</TabsTrigger>
          <TabsTrigger value="parameters">Parameters</TabsTrigger>
          <TabsTrigger value="departments">Departments</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>
        <TabsContent value="tests">
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-lg font-bold">Tests</h2>
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
            <DialogContent className="max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>{editing ? "Edit Test" : "Add Test"}</DialogTitle>
                <DialogDescription>{editing ? "Update the test details below." : "Fill in the test details below."}</DialogDescription>
              </DialogHeader>
              <form onSubmit={(e) => { e.preventDefault(); saveMutation.mutate(form); }} className="space-y-4">
                {/* Test Code - read only */}
                {editing?.test_code && (
                  <div>
                    <Label className="text-xs text-muted-foreground">Test Code</Label>
                    <Input value={editing.test_code} disabled className="bg-muted font-mono text-sm" />
                  </div>
                )}

                <div><Label>Test Name *</Label><Input value={form.test_name} onChange={(e) => setForm(p => ({ ...p, test_name: e.target.value }))} required /></div>
                <div><Label>Display Name</Label><Input value={form.display_name} onChange={(e) => setForm(p => ({ ...p, display_name: e.target.value }))} placeholder="Name shown in reports (optional)" /></div>
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
                <div className="flex items-center gap-3"><Switch checked={form.is_outsourced} onCheckedChange={(v) => setForm(p => ({ ...p, is_outsourced: v, outsourced_caption: v ? p.outsourced_caption : "" }))} /><Label className="text-sm">Mark as Outsourced</Label></div>
                  <div className="flex items-center gap-3"><Switch checked={form.is_active} onCheckedChange={(v) => setForm(p => ({ ...p, is_active: v }))} /><Label className="text-sm">Active</Label></div>
                </div>
                {form.is_outsourced && (
                  <div><Label>Outsourced Caption</Label><Input value={form.outsourced_caption} onChange={(e) => setForm(p => ({ ...p, outsourced_caption: e.target.value }))} placeholder="e.g. This test was outsourced to XYZ Lab" /></div>
                )}

                {/* Report display settings */}
                <div className="border rounded-md p-3 space-y-3 bg-muted/30">
                  <Label className="font-semibold text-sm">Report Settings</Label>
                  <div className="grid grid-cols-1 gap-2">
                    <div className="flex items-center gap-3"><Switch checked={form.bold_in_report} onCheckedChange={(v) => setForm(p => ({ ...p, bold_in_report: v }))} /><Label className="text-sm">Bold in Report</Label></div>
                    <div className="flex items-center gap-3"><Switch checked={form.show_in_report} onCheckedChange={(v) => setForm(p => ({ ...p, show_in_report: v }))} /><Label className="text-sm">Show Display Name in Report</Label></div>
                    <div className="flex items-center gap-3"><Switch checked={form.is_single_parameter} onCheckedChange={(v) => setForm(p => ({ ...p, is_single_parameter: v }))} /><Label className="text-sm">Test = Parameter (Single Parameter Test)</Label></div>
                    <div className="flex items-center gap-3"><Switch checked={form.fit_to_page} onCheckedChange={(v) => setForm(p => ({ ...p, fit_to_page: v }))} /><Label className="text-sm">Fit to Page</Label></div>
                    <div className="flex items-center gap-3"><Switch checked={form.dedicated_page} onCheckedChange={(v) => setForm(p => ({ ...p, dedicated_page: v }))} /><Label className="text-sm">Dedicated Page</Label></div>
                  </div>
                </div>

                {/* Lab details */}
                <div className="border rounded-md p-3 space-y-3 bg-muted/30">
                  <Label className="font-semibold text-sm">Lab Details</Label>
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label className="text-sm">Instrument Name</Label><MasterLookupSelect category="machine_name" value={form.instrument_name} onChange={(v) => setForm(p => ({ ...p, instrument_name: v }))} placeholder="Select machine" /></div>
                    <div><Label className="text-sm">Method</Label><MasterLookupSelect category="method" value={form.method} onChange={(v) => setForm(p => ({ ...p, method: v }))} placeholder="Select method" /></div>
                    <div><Label className="text-sm">Sample Tube</Label><MasterLookupSelect category="sample_tube" value={form.sample_tube} onChange={(v) => setForm(p => ({ ...p, sample_tube: v }))} onMappedValue={(v) => setForm(p => ({ ...p, sample_type: v }))} onMappedValue2={(v) => setForm(p => ({ ...p, tube_color: v }))} placeholder="Select sample tube" /></div>
                    <div><Label className="text-sm">Sample Type</Label><Input value={form.sample_type} onChange={(e) => setForm(p => ({ ...p, sample_type: e.target.value }))} placeholder="Auto-filled from mapping" /></div>
                    <div><Label className="text-sm">Tube Color</Label><div className="flex items-center gap-2"><Input value={form.tube_color} onChange={(e) => setForm(p => ({ ...p, tube_color: e.target.value }))} placeholder="Auto-filled from mapping" />{form.tube_color && <TubeColorDot color={form.tube_color} />}</div></div>
                  </div>
                  <div><Label className="text-sm">Interpretation</Label><Textarea value={form.interpretation} onChange={(e) => setForm(p => ({ ...p, interpretation: e.target.value }))} placeholder="Clinical interpretation notes" rows={3} /></div>
                </div>


                <div><Label>Description</Label><Textarea value={form.description} onChange={(e) => setForm(p => ({ ...p, description: e.target.value }))} /></div>

                {/* Incentive fields - password protected */}
                <div className="border rounded-md p-3 space-y-3 bg-muted/30">
                  <div className="flex items-center justify-between">
                    <Label className="font-semibold text-sm">Incentive Settings</Label>
                    {incentiveLocked ? (
                      <div className="flex items-center gap-2"><Lock className="h-4 w-4 text-muted-foreground" /><span className="text-xs text-muted-foreground">Locked</span></div>
                    ) : (
                      <div className="flex items-center gap-2"><Unlock className="h-4 w-4 text-emerald-600 dark:text-emerald-400" /><span className="text-xs text-emerald-600 dark:text-emerald-400">Unlocked</span></div>
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
                        <div><Label>Incentive Amount (₹)</Label><Input type="number" value={form.incentive_amount} onChange={(e) => setForm(p => ({ ...p, incentive_amount: e.target.value }))} placeholder="Enter incentive amount" /></div>
                      )}
                    </>
                  )}
                </div>

                <Button type="submit" className="w-full" disabled={saveMutation.isPending}>
                  {saveMutation.isPending ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" />Saving...</> : "Save"}
                </Button>
              </form>

                {/* Parameters section - outside form to prevent accidental submit */}
                {editing?.id && (
                  <TestParameterManager testId={editing.id} testName={editing.test_name} />
                )}

            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <div className="relative flex-1"><Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" /><Input className="pl-9" placeholder="Search tests..." value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        <div className="flex items-center gap-2"><Switch checked={showInactive} onCheckedChange={setShowInactive} /><Label className="text-sm whitespace-nowrap">Show Inactive</Label></div>
      </div>

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
            <Card key={t.id} className={`glass-card ${t.is_active === false ? "opacity-60" : ""}`}>
              <CardContent className="flex items-center justify-between p-3 gap-3">
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate">{t.test_name}</p>
                  <div className="flex flex-wrap gap-2 mt-1 text-xs text-muted-foreground">
                    <span className="font-mono">{t.test_code}</span>
                    <span>₹{t.price}</span>
                    {t.fasting_required && <span className="text-warning">Fasting</span>}
                    {!t.discount_applicable && <span className="text-destructive">No Discount</span>}
                    {t.incentive_allowed && <span className="text-primary">Incentive: ₹{t.incentive_amount}</span>}
                    {t.is_single_parameter && <span className="text-blue-500">Single Param</span>}
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
          {filtered.length === 0 && <p className="text-sm text-muted-foreground text-center py-8">No tests found.</p>}
        </div>
      )}
      <ExportPasswordDialog open={exportDialog} onOpenChange={setExportDialog} onSuccess={() => exportToExcel(tests.map((t: any) => ({ "Test Code": t.test_code, "Test Name": t.test_name, "Display Name": t.display_name || "", Price: t.price, "Fasting Required": t.fasting_required ? "Yes" : "No", "Discount Applicable": t.discount_applicable ? "Yes" : "No", Description: t.description, "Bold in Report": t.bold_in_report ? "Yes" : "No", "Show in Report": t.show_in_report ? "Yes" : "No", "Single Parameter": t.is_single_parameter ? "Yes" : "No", "Incentive Allowed": t.incentive_allowed ? "Yes" : "No", "Incentive Amount": t.incentive_amount || 0 })), "tests_export")} />
      <DeletePasswordDialog
        open={!!deleteDialog}
        onOpenChange={(o) => !o && setDeleteDialog(null)}
        onSuccess={() => { if (deleteDialog) deleteMutation.mutate(deleteDialog); }}
        description="Delete this test?"
      />
    </div>
        </TabsContent>
        <TabsContent value="health_checkups">
          <HealthCheckUpManagement />
        </TabsContent>
        <TabsContent value="profiles">
          <ProfileManagement />
        </TabsContent>
        <TabsContent value="parameters">
          <ReportParameters embedded />
        </TabsContent>
        <TabsContent value="departments">
          <ReportDepartments embedded />
        </TabsContent>
        <TabsContent value="settings">
          <MasterLookupSettings />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default TestManagement;
