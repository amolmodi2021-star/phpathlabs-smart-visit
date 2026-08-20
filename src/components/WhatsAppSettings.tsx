import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Eye, EyeOff, Settings, Cloud, Plus, Trash2, Pencil, CheckCircle2 } from "lucide-react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/hooks/use-toast";
import { invalidateCloudinaryAccountCache } from "@/lib/cardStorageCloudinary";
import { Badge } from "@/components/ui/badge";

interface CloudinaryAccount {
  id: string;
  account_name: string;
  cloud_name: string;
  upload_preset: string;
  api_key: string | null;
  api_secret: string | null;
  is_active: boolean;
}

const WhatsAppSettings = () => {
  const [showApiKey, setShowApiKey] = useState(false);
  const [waBaseUrl, setWaBaseUrl] = useState("https://api.aoc-portal.com/v1/whatsapp");
  const [waApiKey, setWaApiKey] = useState("");
  const [waAuthHeaderName, setWaAuthHeaderName] = useState("apikey");
  const [waAuthHeaderPrefix, setWaAuthHeaderPrefix] = useState("");
  const [waFromNumber, setWaFromNumber] = useState("");
  const [waCampaignName, setWaCampaignName] = useState("");
  const [waTemplateName, setWaTemplateName] = useState("");
  const [waBodyMapping, setWaBodyMapping] = useState("");
  const [waMediaHeader, setWaMediaHeader] = useState(true);
  const [queueEnabled, setQueueEnabled] = useState(true);
  const [delayMs, setDelayMs] = useState(3000);
  const [waSettingsLoaded, setWaSettingsLoaded] = useState(false);

  // Cloudinary accounts
  const [accounts, setAccounts] = useState<CloudinaryAccount[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<CloudinaryAccount | null>(null);
  const [form, setForm] = useState({
    account_name: "",
    cloud_name: "",
    upload_preset: "",
    api_key: "",
    api_secret: "",
  });
  const [showSecret, setShowSecret] = useState(false);

  // Load WA settings from DB
  useEffect(() => {
    const loadSettings = async () => {
      const { data } = await supabase.from("app_settings").select("setting_key, setting_value").like("setting_key", "loyalty_wa_%");
      if (!data) { setWaSettingsLoaded(true); return; }
      const map: Record<string, string> = {};
      data.forEach((r: any) => { map[r.setting_key] = r.setting_value; });
      if (map["loyalty_wa_baseUrl"]) setWaBaseUrl(map["loyalty_wa_baseUrl"]);
      if (map["loyalty_wa_apiKey"]) setWaApiKey(map["loyalty_wa_apiKey"]);
      if (map["loyalty_wa_authHeaderName"]) setWaAuthHeaderName(map["loyalty_wa_authHeaderName"]);
      if (map["loyalty_wa_authHeaderPrefix"]) setWaAuthHeaderPrefix(map["loyalty_wa_authHeaderPrefix"]);
      if (map["loyalty_wa_fromNumber"]) setWaFromNumber(map["loyalty_wa_fromNumber"]);
      if (map["loyalty_wa_campaignName"]) setWaCampaignName(map["loyalty_wa_campaignName"]);
      if (map["loyalty_wa_templateName"]) setWaTemplateName(map["loyalty_wa_templateName"]);
      if (map["loyalty_wa_bodyMapping"]) setWaBodyMapping(map["loyalty_wa_bodyMapping"]);
      if (map["loyalty_wa_mediaHeader"]) setWaMediaHeader(map["loyalty_wa_mediaHeader"] === "true");
      if (map["loyalty_wa_queueEnabled"]) setQueueEnabled(map["loyalty_wa_queueEnabled"] === "true");
      if (map["loyalty_wa_delayMs"]) setDelayMs(Number(map["loyalty_wa_delayMs"]));
      setWaSettingsLoaded(true);
    };
    loadSettings();
  }, []);

  // Save WA settings to database (debounced after load)
  useEffect(() => {
    if (!waSettingsLoaded) return;
    const settings: Record<string, string> = {
      loyalty_wa_baseUrl: waBaseUrl,
      loyalty_wa_apiKey: waApiKey,
      loyalty_wa_authHeaderName: waAuthHeaderName,
      loyalty_wa_authHeaderPrefix: waAuthHeaderPrefix,
      loyalty_wa_fromNumber: waFromNumber,
      loyalty_wa_campaignName: waCampaignName,
      loyalty_wa_templateName: waTemplateName,
      loyalty_wa_bodyMapping: waBodyMapping,
      loyalty_wa_mediaHeader: String(waMediaHeader),
      loyalty_wa_queueEnabled: String(queueEnabled),
      loyalty_wa_delayMs: String(delayMs),
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
  }, [waBaseUrl, waApiKey, waAuthHeaderName, waAuthHeaderPrefix, waFromNumber, waCampaignName, waTemplateName, waBodyMapping, waMediaHeader, queueEnabled, delayMs, waSettingsLoaded]);

  const loadAccounts = useCallback(async () => {
    const { data, error } = await supabase
      .from("cloudinary_accounts")
      .select("*")
      .order("created_at", { ascending: true });
    if (error) {
      toast({ title: "Failed to load Cloudinary accounts", description: error.message, variant: "destructive" });
      return;
    }
    setAccounts((data || []) as CloudinaryAccount[]);
  }, []);

  useEffect(() => { loadAccounts(); }, [loadAccounts]);

  const openAdd = () => {
    setEditing(null);
    setForm({ account_name: "", cloud_name: "", upload_preset: "", api_key: "", api_secret: "" });
    setDialogOpen(true);
  };

  const openEdit = (a: CloudinaryAccount) => {
    setEditing(a);
    setForm({
      account_name: a.account_name,
      cloud_name: a.cloud_name,
      upload_preset: a.upload_preset,
      api_key: a.api_key || "",
      api_secret: a.api_secret || "",
    });
    setDialogOpen(true);
  };

  const saveAccount = async () => {
    if (!form.account_name.trim() || !form.cloud_name.trim() || !form.upload_preset.trim()) {
      toast({ title: "Account name, cloud name and upload preset are required", variant: "destructive" });
      return;
    }
    const payload = {
      account_name: form.account_name.trim(),
      cloud_name: form.cloud_name.trim(),
      upload_preset: form.upload_preset.trim(),
      api_key: form.api_key.trim() || null,
      api_secret: form.api_secret.trim() || null,
      purpose: "whatsapp",
    };
    const { error } = editing
      ? await supabase.from("cloudinary_accounts").update(payload).eq("id", editing.id)
      : await supabase.from("cloudinary_accounts").insert(payload);
    if (error) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
      return;
    }
    setDialogOpen(false);
    invalidateCloudinaryAccountCache();
    await loadAccounts();
    toast({ title: editing ? "Account updated" : "Account added" });
  };

  const activateAccount = async (id: string) => {
    // Deactivate other WhatsApp accounts only (do not touch outsourced_pdf purpose)
    const { error: e1 } = await supabase
      .from("cloudinary_accounts")
      .update({ is_active: false })
      .eq("purpose", "whatsapp")
      .neq("id", id);
    if (e1) { toast({ title: "Activate failed", description: e1.message, variant: "destructive" }); return; }
    const { error: e2 } = await supabase.from("cloudinary_accounts").update({ is_active: true }).eq("id", id);
    if (e2) { toast({ title: "Activate failed", description: e2.message, variant: "destructive" }); return; }
    invalidateCloudinaryAccountCache();
    await loadAccounts();
    toast({ title: "Active Cloudinary account updated" });
  };

  const deleteAccount = async (a: CloudinaryAccount) => {
    if (a.is_active) {
      toast({ title: "Cannot delete the active account", description: "Activate a different account first.", variant: "destructive" });
      return;
    }
    if (!confirm(`Delete Cloudinary account "${a.account_name}"?`)) return;
    const { error } = await supabase.from("cloudinary_accounts").delete().eq("id", a.id);
    if (error) { toast({ title: "Delete failed", description: error.message, variant: "destructive" }); return; }
    invalidateCloudinaryAccountCache();
    await loadAccounts();
    toast({ title: "Account deleted" });
  };

  const testAccount = async (a: CloudinaryAccount) => {
    try {
      // 1x1 transparent PNG
      const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
      const bytes = Uint8Array.from(atob(png), (c) => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: "image/png" });
      const fd = new FormData();
      fd.append("file", blob);
      fd.append("upload_preset", a.upload_preset);
      const res = await fetch(`https://api.cloudinary.com/v1_1/${a.cloud_name}/image/upload`, { method: "POST", body: fd });
      if (!res.ok) {
        const j = await res.json().catch(() => ({} as any));
        throw new Error(j?.error?.message || `HTTP ${res.status}`);
      }
      toast({ title: `✓ ${a.account_name} works` });
    } catch (e: any) {
      toast({ title: `Test failed for ${a.account_name}`, description: e?.message || "Unknown error", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Settings className="h-4 w-4" />
            WhatsApp API Configuration
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">API Base URL</Label>
              <Input value={waBaseUrl} onChange={(e) => setWaBaseUrl(e.target.value)} placeholder="https://api.aoc-portal.com/v1/whatsapp" className="h-8" />
            </div>
            <div>
              <Label className="text-xs">API Key</Label>
              <div className="relative">
                <Input type={showApiKey ? "text" : "password"} value={waApiKey} onChange={(e) => setWaApiKey(e.target.value)} placeholder="Your API key" className="h-8 pr-8" />
                <button type="button" onClick={() => setShowApiKey(!showApiKey)} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  {showApiKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              </div>
            </div>
            <div>
              <Label className="text-xs">Auth Header Name</Label>
              <Input value={waAuthHeaderName} onChange={(e) => setWaAuthHeaderName(e.target.value)} placeholder="apikey" className="h-8" />
            </div>
            <div>
              <Label className="text-xs">Auth Header Prefix (optional)</Label>
              <Input value={waAuthHeaderPrefix} onChange={(e) => setWaAuthHeaderPrefix(e.target.value)} placeholder="Bearer / Basic / empty" className="h-8" />
            </div>
            <div>
              <Label className="text-xs">From Number</Label>
              <Input value={waFromNumber} onChange={(e) => setWaFromNumber(e.target.value)} placeholder="+91XXXXXXXXXX" className="h-8" />
            </div>
            <div>
              <Label className="text-xs">Campaign Name</Label>
              <Input value={waCampaignName} onChange={(e) => setWaCampaignName(e.target.value)} placeholder="loyalty-cards" className="h-8" />
            </div>
            <div>
              <Label className="text-xs">Template Name</Label>
              <Input value={waTemplateName} onChange={(e) => setWaTemplateName(e.target.value)} placeholder="template_name" className="h-8" />
            </div>
            <div>
              <Label className="text-xs">Body Variables Mapping (JSON)</Label>
              <Input value={waBodyMapping} onChange={(e) => setWaBodyMapping(e.target.value)} placeholder='{"1":"Name"}' className="h-8" />
            </div>
          </div>
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <Switch checked={waMediaHeader} onCheckedChange={setWaMediaHeader} />
              <Label className="text-xs">Include card image in media header</Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={queueEnabled} onCheckedChange={setQueueEnabled} />
              <Label className="text-xs">Queue Mode</Label>
            </div>
            {queueEnabled && (
              <div className="flex items-center gap-2">
                <Label className="text-xs">Delay (ms)</Label>
                <Input type="number" value={delayMs} onChange={(e) => setDelayMs(Number(e.target.value))} className="w-24 h-8" min={500} step={500} />
              </div>
            )}
          </div>
          <p className="text-xs text-muted-foreground">Settings are auto-saved. Use the History tab to send WhatsApp messages.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="py-3 flex-row items-center justify-between space-y-0">
          <CardTitle className="text-sm flex items-center gap-2">
            <Cloud className="h-4 w-4" />
            Cloudinary Accounts
          </CardTitle>
          <Button size="sm" onClick={openAdd} className="h-8">
            <Plus className="h-3.5 w-3.5 mr-1" /> Add Account
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            All Loyalty/ABC and Abnormal History card images are uploaded to the <b>active</b> account. Only one account can be active at a time. Switching the active account immediately routes all new uploads (and the URLs sent via WhatsApp) to that account.
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
                        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => activateAccount(a.id)}>Activate</Button>
                      )}
                    </TableCell>
                    <TableCell className="py-2 text-sm font-medium">{a.account_name}</TableCell>
                    <TableCell className="py-2 text-sm font-mono">{a.cloud_name}</TableCell>
                    <TableCell className="py-2 text-sm font-mono">{a.upload_preset}</TableCell>
                    <TableCell className="py-2 text-right">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" className="h-7" onClick={() => testAccount(a)}>Test</Button>
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => openEdit(a)}><Pencil className="h-3.5 w-3.5" /></Button>
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive" onClick={() => deleteAccount(a)} disabled={a.is_active}><Trash2 className="h-3.5 w-3.5" /></Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Cloudinary Account" : "Add Cloudinary Account"}</DialogTitle>
          </DialogHeader>
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
              Create the upload preset in your Cloudinary dashboard with <b>Signing Mode = Unsigned</b> and folder <code>loyalty-cards</code>. API key/secret are only needed for automated cleanup of old images. For report PDFs: Security → enable <b>Allow delivery of PDF and ZIP files</b>.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={saveAccount}>{editing ? "Update" : "Add"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default WhatsAppSettings;
