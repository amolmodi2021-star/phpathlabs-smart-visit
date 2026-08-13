import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Eye, EyeOff, Settings, Plus, Trash2, Edit2, Cloud, Pencil, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import PasswordGate from "@/components/PasswordGate";
import { Dialog as UIDialog, DialogContent as UIDialogContent, DialogFooter as UIDialogFooter, DialogHeader as UIDialogHeader, DialogTitle as UIDialogTitle } from "@/components/ui/dialog";
import { invalidateCloudinaryAccountCache } from "@/lib/cardStorageCloudinary";

/* ─── Cloudinary Accounts ─── */
interface CloudinaryAccount {
  id: string;
  account_name: string;
  cloud_name: string;
  upload_preset: string;
  api_key: string | null;
  api_secret: string | null;
  is_active: boolean;
}

const CloudinaryAccountsManager = () => {
  const [accounts, setAccounts] = useState<CloudinaryAccount[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<CloudinaryAccount | null>(null);
  const [form, setForm] = useState({ account_name: "", cloud_name: "", upload_preset: "", api_key: "", api_secret: "" });
  const [showSecret, setShowSecret] = useState(false);

  const load = async () => {
    const { data, error } = await supabase.from("cloudinary_accounts").select("*").order("created_at", { ascending: true });
    if (error) { toast.error("Failed to load accounts: " + error.message); return; }
    setAccounts((data || []) as CloudinaryAccount[]);
  };
  useEffect(() => { load(); }, []);

  const openAdd = () => {
    setEditing(null);
    setForm({ account_name: "", cloud_name: "", upload_preset: "", api_key: "", api_secret: "" });
    setDialogOpen(true);
  };
  const openEdit = (a: CloudinaryAccount) => {
    setEditing(a);
    setForm({ account_name: a.account_name, cloud_name: a.cloud_name, upload_preset: a.upload_preset, api_key: a.api_key || "", api_secret: a.api_secret || "" });
    setDialogOpen(true);
  };
  const save = async () => {
    if (!form.account_name.trim() || !form.cloud_name.trim() || !form.upload_preset.trim()) {
      toast.error("Account name, cloud name and upload preset are required"); return;
    }
    const payload = {
      account_name: form.account_name.trim(),
      cloud_name: form.cloud_name.trim(),
      upload_preset: form.upload_preset.trim(),
      api_key: form.api_key.trim() || null,
      api_secret: form.api_secret.trim() || null,
    };
    const { error } = editing
      ? await supabase.from("cloudinary_accounts").update(payload).eq("id", editing.id)
      : await supabase.from("cloudinary_accounts").insert(payload);
    if (error) { toast.error("Save failed: " + error.message); return; }
    setDialogOpen(false);
    invalidateCloudinaryAccountCache();
    await load();
    toast.success(editing ? "Account updated" : "Account added");
  };
  const activate = async (id: string) => {
    const { error: e1 } = await supabase.from("cloudinary_accounts").update({ is_active: false }).neq("id", id);
    if (e1) { toast.error("Activate failed: " + e1.message); return; }
    const { error: e2 } = await supabase.from("cloudinary_accounts").update({ is_active: true }).eq("id", id);
    if (e2) { toast.error("Activate failed: " + e2.message); return; }
    invalidateCloudinaryAccountCache();
    await load();
    toast.success("Active account updated");
  };
  const remove = async (a: CloudinaryAccount) => {
    if (a.is_active) { toast.error("Activate a different account first"); return; }
    if (!confirm(`Delete "${a.account_name}"?`)) return;
    const { error } = await supabase.from("cloudinary_accounts").delete().eq("id", a.id);
    if (error) { toast.error("Delete failed: " + error.message); return; }
    invalidateCloudinaryAccountCache();
    await load();
    toast.success("Deleted");
  };
  const test = async (a: CloudinaryAccount) => {
    try {
      const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
      const bytes = Uint8Array.from(atob(png), (c) => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: "image/png" });
      const fd = new FormData();
      fd.append("file", blob);
      fd.append("upload_preset", a.upload_preset);
      const res = await fetch(`https://api.cloudinary.com/v1_1/${a.cloud_name}/image/upload`, { method: "POST", body: fd });
      if (!res.ok) { const j = await res.json().catch(() => ({} as any)); throw new Error(j?.error?.message || `HTTP ${res.status}`); }
      toast.success(`✓ ${a.account_name} works`);
    } catch (e: any) {
      toast.error(`Test failed: ${e?.message || "Unknown"}`);
    }
  };

  return (
    <Card>
      <CardHeader className="py-3 flex-row items-center justify-between space-y-0">
        <CardTitle className="text-sm flex items-center gap-2"><Cloud className="h-4 w-4" /> Cloudinary Accounts</CardTitle>
        <Button size="sm" onClick={openAdd} className="h-8"><Plus className="h-3.5 w-3.5 mr-1" /> Add Account</Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          All Loyalty/ABC and Abnormal History card images upload to the <b>active</b> account. Only one account can be active at a time. Switching the active account immediately routes new uploads (and the URLs sent via WhatsApp) to that account.
        </p>
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="h-9">Active</TableHead>
                <TableHead className="h-9">Name</TableHead>
                <TableHead className="h-9">Cloud Name</TableHead>
                <TableHead className="h-9">Upload Preset</TableHead>
                <TableHead className="h-9 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {accounts.length === 0 && (
                <TableRow><TableCell colSpan={5} className="text-center text-xs text-muted-foreground py-4">No accounts yet. Add one to get started.</TableCell></TableRow>
              )}
              {accounts.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="py-2">
                    {a.is_active ? (
                      <Badge variant="default" className="gap-1"><CheckCircle2 className="h-3 w-3" />Active</Badge>
                    ) : (
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => activate(a.id)}>Activate</Button>
                    )}
                  </TableCell>
                  <TableCell className="py-2 text-sm font-medium">{a.account_name}</TableCell>
                  <TableCell className="py-2 text-sm font-mono">{a.cloud_name}</TableCell>
                  <TableCell className="py-2 text-sm font-mono">{a.upload_preset}</TableCell>
                  <TableCell className="py-2 text-right">
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" className="h-7" onClick={() => test(a)}>Test</Button>
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => openEdit(a)}><Pencil className="h-3.5 w-3.5" /></Button>
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive" onClick={() => remove(a)} disabled={a.is_active}><Trash2 className="h-3.5 w-3.5" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <UIDialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <UIDialogContent>
            <UIDialogHeader>
              <UIDialogTitle>{editing ? "Edit Cloudinary Account" : "Add Cloudinary Account"}</UIDialogTitle>
            </UIDialogHeader>
            <div className="space-y-3">
              <div>
                <Label className="text-xs">Account Name</Label>
                <Input value={form.account_name} onChange={(e) => setForm({ ...form, account_name: e.target.value })} placeholder="e.g. PathLabs Primary" className="h-9" />
              </div>
              <div>
                <Label className="text-xs">Cloud Name</Label>
                <Input value={form.cloud_name} onChange={(e) => setForm({ ...form, cloud_name: e.target.value })} placeholder="e.g. dd7qn3t3d" className="h-9 font-mono" />
              </div>
              <div>
                <Label className="text-xs">Unsigned Upload Preset</Label>
                <Input value={form.upload_preset} onChange={(e) => setForm({ ...form, upload_preset: e.target.value })} placeholder="e.g. phpathlabs_cards" className="h-9 font-mono" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">API Key (optional, for deletion)</Label>
                  <Input value={form.api_key} onChange={(e) => setForm({ ...form, api_key: e.target.value })} className="h-9 font-mono" />
                </div>
                <div>
                  <Label className="text-xs">API Secret (optional, for deletion)</Label>
                  <div className="relative">
                    <Input type={showSecret ? "text" : "password"} value={form.api_secret} onChange={(e) => setForm({ ...form, api_secret: e.target.value })} className="h-9 font-mono pr-8" />
                    <button type="button" onClick={() => setShowSecret(!showSecret)} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground">
                      {showSecret ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Create the upload preset in Cloudinary with <b>Signing Mode = Unsigned</b> and folder <code>loyalty-cards</code>. API key/secret are only needed for automated cleanup. For lab report PDFs on WhatsApp: Settings → Security → enable <b>Allow delivery of PDF and ZIP files</b> (otherwise Media Library shows “Blocked for delivery” and WA gets HTTP 401).
              </p>
            </div>
            <UIDialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button onClick={save}>{editing ? "Update" : "Add"}</Button>
            </UIDialogFooter>
          </UIDialogContent>
        </UIDialog>
      </CardContent>
    </Card>
  );
};

const PREFIX = "wa_global_";

/* ─── Global API Settings ─── */
const GlobalApiSettings = () => {
  const [showApiKey, setShowApiKey] = useState(false);
  const [baseUrl, setBaseUrl] = useState("https://api.aoc-portal.com/v1/whatsapp");
  const [apiKey, setApiKey] = useState("");
  const [authHeaderName, setAuthHeaderName] = useState("apikey");
  const [authHeaderPrefix, setAuthHeaderPrefix] = useState("");
  const [fromNumber, setFromNumber] = useState("");
  const [queueEnabled, setQueueEnabled] = useState(true);
  const [delayMs, setDelayMs] = useState(3000);
  const [concurrency, setConcurrency] = useState(5);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("app_settings")
        .select("setting_key, setting_value")
        .like("setting_key", `${PREFIX}%`);
      if (data) {
        const m: Record<string, string> = {};
        data.forEach((r: any) => { m[r.setting_key] = r.setting_value; });
        if (m[`${PREFIX}baseUrl`]) setBaseUrl(m[`${PREFIX}baseUrl`]);
        if (m[`${PREFIX}apiKey`]) setApiKey(m[`${PREFIX}apiKey`]);
        if (m[`${PREFIX}authHeaderName`]) setAuthHeaderName(m[`${PREFIX}authHeaderName`]);
        if (m[`${PREFIX}authHeaderPrefix`]) setAuthHeaderPrefix(m[`${PREFIX}authHeaderPrefix`]);
        if (m[`${PREFIX}fromNumber`]) setFromNumber(m[`${PREFIX}fromNumber`]);
        if (m[`${PREFIX}queueEnabled`]) setQueueEnabled(m[`${PREFIX}queueEnabled`] === "true");
        if (m[`${PREFIX}delayMs`] !== undefined) {
          const d = Number(m[`${PREFIX}delayMs`]);
          if (Number.isFinite(d) && d >= 0) setDelayMs(d);
        }
        if (m[`${PREFIX}concurrency`]) {
          const c = Number(m[`${PREFIX}concurrency`]);
          if (Number.isFinite(c)) setConcurrency(Math.max(1, Math.min(10, Math.floor(c))));
        }
      }
      setLoaded(true);
    })();
  }, []);

  useEffect(() => {
    if (!loaded) return;
    const settings: Record<string, string> = {
      [`${PREFIX}baseUrl`]: baseUrl,
      [`${PREFIX}apiKey`]: apiKey,
      [`${PREFIX}authHeaderName`]: authHeaderName,
      [`${PREFIX}authHeaderPrefix`]: authHeaderPrefix,
      [`${PREFIX}fromNumber`]: fromNumber,
      [`${PREFIX}queueEnabled`]: String(queueEnabled),
      [`${PREFIX}delayMs`]: String(delayMs),
      [`${PREFIX}concurrency`]: String(concurrency),
    };
    const timer = setTimeout(() => {
      Object.entries(settings).forEach(async ([key, value]) => {
        await supabase.from("app_settings").upsert(
          { setting_key: key, setting_value: value, updated_at: new Date().toISOString() },
          { onConflict: "setting_key" }
        );
      });
    }, 500);
    return () => clearTimeout(timer);
  }, [baseUrl, apiKey, authHeaderName, authHeaderPrefix, fromNumber, queueEnabled, delayMs, concurrency, loaded]);

  return (
    <Card>
      <CardHeader className="py-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Settings className="h-4 w-4" />
          Global WhatsApp API Configuration
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          These credentials are shared across all modules (Loyalty Cards, CRM, Marketing, Automated Campaigns).
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">API Base URL</Label>
            <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.aoc-portal.com/v1/whatsapp" className="h-8" />
          </div>
          <div>
            <Label className="text-xs">API Key</Label>
            <div className="relative">
              <Input type={showApiKey ? "text" : "password"} value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="Your API key" className="h-8 pr-8" />
              <button type="button" onClick={() => setShowApiKey(!showApiKey)} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                {showApiKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            </div>
          </div>
          <div>
            <Label className="text-xs">Auth Header Name</Label>
            <Input value={authHeaderName} onChange={(e) => setAuthHeaderName(e.target.value)} placeholder="apikey" className="h-8" />
          </div>
          <div>
            <Label className="text-xs">Auth Header Prefix (optional)</Label>
            <Input value={authHeaderPrefix} onChange={(e) => setAuthHeaderPrefix(e.target.value)} placeholder="Bearer / Basic / empty" className="h-8" />
          </div>
          <div>
            <Label className="text-xs">From Number</Label>
            <Input value={fromNumber} onChange={(e) => setFromNumber(e.target.value)} placeholder="+91XXXXXXXXXX" className="h-8" />
          </div>
          <div className="flex items-center gap-4 flex-wrap pt-4">
            <div className="flex items-center gap-2">
              <Switch checked={queueEnabled} onCheckedChange={setQueueEnabled} />
              <Label className="text-xs">Queue Mode</Label>
            </div>
            <div className="flex items-center gap-2">
              <Label className="text-xs whitespace-nowrap">Delay between messages (ms)</Label>
              <Select value={[0, 1000, 3000, 5000, 10000].includes(delayMs) ? String(delayMs) : "custom"} onValueChange={(v) => { if (v !== "custom") setDelayMs(Number(v)); }}>
                <SelectTrigger className="w-36 h-8"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">No delay</SelectItem>
                  <SelectItem value="1000">1 second</SelectItem>
                  <SelectItem value="3000">3 seconds (default)</SelectItem>
                  <SelectItem value="5000">5 seconds</SelectItem>
                  <SelectItem value="10000">10 seconds</SelectItem>
                  <SelectItem value="custom">Custom…</SelectItem>
                </SelectContent>
              </Select>
              <Input type="number" value={delayMs} onChange={(e) => setDelayMs(Math.max(0, Number(e.target.value) || 0))} className="w-24 h-8" min={0} step={100} />
            </div>
            <div className="flex items-center gap-2">
              <Label className="text-xs whitespace-nowrap">Parallel sends</Label>
              <Input
                type="number"
                value={concurrency}
                onChange={(e) => {
                  const v = Math.max(1, Math.min(10, Math.floor(Number(e.target.value) || 1)));
                  setConcurrency(v);
                }}
                className="w-20 h-8"
                min={1}
                max={10}
                step={1}
              />
            </div>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Settings are auto-saved. The delay applies to all marketing campaigns (Send Messages, Automated/Drip, Retry). Set to <span className="font-mono">0</span> for back-to-back sends. <strong>Parallel sends</strong> (1–10, default 5) controls how many Automated Marketing records are processed in parallel — higher = faster, but the delay above still rate-limits the actual WhatsApp API calls globally. Set to <span className="font-mono">1</span> to reproduce strictly sequential sending.
        </p>
      </CardContent>
    </Card>
  );
};

/* ─── Templates ─── */
interface Variable { name: string; description: string; }

const TemplatesManager = () => {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [templateName, setTemplateName] = useState("");
  const [whatsappTemplateName, setWhatsappTemplateName] = useState("");
  const [variables, setVariables] = useState<Variable[]>([]);
  const [newVarName, setNewVarName] = useState("");
  const [newVarDesc, setNewVarDesc] = useState("");
  const [bodyMapping, setBodyMapping] = useState("");
  const [campaignName, setCampaignName] = useState("");
  const [mediaHeader, setMediaHeader] = useState(true);

  const { data: templates = [] } = useQuery({
    queryKey: ["marketing_templates"],
    queryFn: async () => {
      const { data, error } = await supabase.from("marketing_templates").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const resetForm = () => {
    setEditId(null);
    setTemplateName("");
    setWhatsappTemplateName("");
    setVariables([]);
    setNewVarName("");
    setNewVarDesc("");
    setBodyMapping("");
    setCampaignName("");
    setMediaHeader(true);
  };

  const addVariable = () => {
    if (!newVarName.trim()) return;
    setVariables([...variables, { name: newVarName.trim(), description: newVarDesc.trim() }]);
    setNewVarName("");
    setNewVarDesc("");
  };

  const removeVariable = (idx: number) => setVariables(variables.filter((_, i) => i !== idx));

  const handleSave = async () => {
    if (!templateName.trim() || !whatsappTemplateName.trim()) {
      toast.error("Template name and WhatsApp template name are required");
      return;
    }
    const payload = {
      template_name: templateName.trim(),
      whatsapp_template_name: whatsappTemplateName.trim(),
      variables: variables as any,
      body_mapping: bodyMapping.trim() || "",
      // Store campaignName and mediaHeader in body_mapping JSON alongside
      api_base_url: campaignName.trim() || null, // Reuse field for campaign name
      from_number: mediaHeader ? "media_header_enabled" : null, // Flag
    };

    if (editId) {
      const { error } = await supabase.from("marketing_templates").update(payload).eq("id", editId);
      if (error) { toast.error("Failed to update"); return; }
      toast.success("Template updated");
    } else {
      const { error } = await supabase.from("marketing_templates").insert(payload);
      if (error) { toast.error("Failed to save"); return; }
      toast.success("Template saved");
    }
    queryClient.invalidateQueries({ queryKey: ["marketing_templates"] });
    resetForm();
    setOpen(false);
  };

  const handleEdit = (t: any) => {
    setEditId(t.id);
    setTemplateName(t.template_name);
    setWhatsappTemplateName(t.whatsapp_template_name);
    setVariables(Array.isArray(t.variables) ? t.variables : []);
    setBodyMapping(t.body_mapping || "");
    setCampaignName(t.api_base_url || "");
    setMediaHeader(t.from_number === "media_header_enabled");
    setOpen(true);
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from("marketing_templates").delete().eq("id", id);
    if (error) { toast.error("Failed to delete"); return; }
    toast.success("Template deleted");
    queryClient.invalidateQueries({ queryKey: ["marketing_templates"] });
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">WhatsApp Templates</CardTitle>
        <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetForm(); }}>
          <DialogTrigger asChild>
            <Button size="sm"><Plus className="h-4 w-4 mr-1" /> Add Template</Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editId ? "Edit" : "Add"} Template</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Template Display Name</Label>
                <Input value={templateName} onChange={(e) => setTemplateName(e.target.value)} placeholder="e.g. ABC Card, Abnormal PNG, Festival Offer" />
              </div>
              <div>
                <Label>WhatsApp API Template Name</Label>
                <Input value={whatsappTemplateName} onChange={(e) => setWhatsappTemplateName(e.target.value)} placeholder="e.g. abc_loyalty_card_v1" />
              </div>
              <div>
                <Label>Campaign Name</Label>
                <Input value={campaignName} onChange={(e) => setCampaignName(e.target.value)} placeholder="e.g. loyalty-cards, abnormal-cards" />
              </div>
              <div>
                <Label>Body Variable Mapping</Label>
                <Input value={bodyMapping} onChange={(e) => setBodyMapping(e.target.value)} placeholder='e.g. {"1":"Name"}' />
                <p className="text-xs text-muted-foreground mt-1">JSON mapping of body variables to data fields</p>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={mediaHeader} onCheckedChange={setMediaHeader} />
                <Label className="text-xs">Include card image in media header</Label>
              </div>

              <div className="space-y-2">
                <Label>Template Variables</Label>
                {variables.map((v, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm bg-muted p-2 rounded">
                    <span className="font-medium">{`{{${i + 1}}}`}</span>
                    <span className="flex-1">{v.name}</span>
                    <span className="text-muted-foreground text-xs">{v.description}</span>
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => removeVariable(i)}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
                <div className="flex gap-2">
                  <Input value={newVarName} onChange={(e) => setNewVarName(e.target.value)} placeholder="Variable name" className="flex-1" />
                  <Input value={newVarDesc} onChange={(e) => setNewVarDesc(e.target.value)} placeholder="Description" className="flex-1" />
                  <Button variant="outline" size="sm" onClick={addVariable}>Add</Button>
                </div>
              </div>

              <Button className="w-full" onClick={handleSave}>
                {editId ? "Update" : "Save"} Template
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        {templates.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">No templates yet. Add one to get started.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>WhatsApp Template</TableHead>
                <TableHead>Campaign</TableHead>
                <TableHead>Variables</TableHead>
                <TableHead>Media</TableHead>
                <TableHead className="w-24">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {templates.map((t: any) => (
                <TableRow key={t.id}>
                  <TableCell className="font-medium">{t.template_name}</TableCell>
                  <TableCell className="text-muted-foreground">{t.whatsapp_template_name}</TableCell>
                  <TableCell className="text-xs">{t.api_base_url || "—"}</TableCell>
                  <TableCell>
                    {(Array.isArray(t.variables) ? t.variables : []).map((v: Variable, i: number) => (
                      <span key={i} className="inline-block bg-muted text-xs px-1.5 py-0.5 rounded mr-1 mb-1">{`{{${i + 1}}} ${v.name}`}</span>
                    ))}
                  </TableCell>
                  <TableCell>
                    {t.from_number === "media_header_enabled" ? (
                      <Badge variant="secondary" className="text-xs">Yes</Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">No</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleEdit(t)}>
                        <Edit2 className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleDelete(t.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
};

/* ─── Page ─── */
const WhatsAppSettingsPage = () => {
  return (
    <PasswordGate title="WhatsApp Settings">
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">WhatsApp Settings & Templates</h1>
        <Tabs defaultValue="api" className="w-full">
          <TabsList>
            <TabsTrigger value="api">API Settings</TabsTrigger>
            <TabsTrigger value="cloudinary">Cloudinary</TabsTrigger>
            <TabsTrigger value="templates">Templates</TabsTrigger>
          </TabsList>
          <TabsContent value="api">
            <GlobalApiSettings />
          </TabsContent>
          <TabsContent value="cloudinary">
            <CloudinaryAccountsManager />
          </TabsContent>
          <TabsContent value="templates">
            <TemplatesManager />
          </TabsContent>
        </Tabs>
      </div>
    </PasswordGate>
  );
};

export default WhatsAppSettingsPage;
