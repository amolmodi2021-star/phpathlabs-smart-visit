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
import { Eye, EyeOff, Settings, Plus, Trash2, Edit2, Search } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import PasswordGate from "@/components/PasswordGate";

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
        if (m[`${PREFIX}delayMs`]) setDelayMs(Number(m[`${PREFIX}delayMs`]));
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
  }, [baseUrl, apiKey, authHeaderName, authHeaderPrefix, fromNumber, queueEnabled, delayMs, loaded]);

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
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Settings are auto-saved. The delay applies to all marketing campaigns (Send Messages, Automated/Drip, Retry). Set to <span className="font-mono">0</span> for back-to-back sends.
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

/* ─── Unified History ─── */
const UnifiedHistory = () => {
  const [search, setSearch] = useState("");

  // CRM sent history (source of truth for all modules)
  const { data: crmRecords = [], isLoading: crmLoading } = useQuery({
    queryKey: ["unified-history-crm"],
    queryFn: async () => {
      const BATCH = 900;
      let all: any[] = [];
      let from = 0;
      while (true) {
        const { data } = await supabase
          .from("crm_contacts")
          .select("primary_key, patient_name, mobile_number, last_sent_type, last_sent_date, location")
          .not("last_sent_date", "is", null)
          .order("last_sent_date", { ascending: false })
          .range(from, from + BATCH - 1);
        if (!data || data.length === 0) break;
        all.push(...data);
        if (data.length < BATCH) break;
        from += BATCH;
      }
      return all;
    },
  });

  // Marketing campaigns history
  const { data: campaigns = [] } = useQuery({
    queryKey: ["unified-history-campaigns"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("marketing_campaigns")
        .select("*, marketing_templates(template_name)")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data;
    },
  });

  // Drip campaign log
  const { data: dripLogs = [] } = useQuery({
    queryKey: ["unified-history-drip"],
    queryFn: async () => {
      const { data } = await supabase
        .from("drip_campaign_log")
        .select("*")
        .eq("status", "sent")
        .order("created_at", { ascending: false })
        .limit(500);
      return data || [];
    },
  });

  const filtered = crmRecords.filter((r: any) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      (r.patient_name || "").toLowerCase().includes(s) ||
      (r.mobile_number || "").includes(s) ||
      (r.last_sent_type || "").toLowerCase().includes(s) ||
      (r.location || "").toLowerCase().includes(s)
    );
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">All Sent Messages ({filtered.length} records)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2 items-center">
            <Search className="h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by name, mobile, type, or location..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-sm"
            />
          </div>

          {crmLoading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground">No sent records found.</p>
          ) : (
            <div className="overflow-auto max-h-[60vh] border rounded">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">#</TableHead>
                    <TableHead>Patient Name</TableHead>
                    <TableHead>Mobile</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>Sent Type</TableHead>
                    <TableHead>Sent Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((r: any, i: number) => (
                    <TableRow key={`${r.primary_key}-${i}`}>
                      <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                      <TableCell>{r.patient_name || "—"}</TableCell>
                      <TableCell className="font-mono text-sm">{r.mobile_number || "—"}</TableCell>
                      <TableCell className="text-xs">{r.location || "—"}</TableCell>
                      <TableCell>
                        <Badge variant="secondary">{r.last_sent_type || "—"}</Badge>
                      </TableCell>
                      <TableCell className="text-sm">
                        {r.last_sent_date ? format(new Date(r.last_sent_date), "dd-MM-yyyy hh:mm a") : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Campaign-level history */}
      {campaigns.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Marketing Campaign History</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Template</TableHead>
                  <TableHead>Total</TableHead>
                  <TableHead>Sent</TableHead>
                  <TableHead>Failed</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {campaigns.map((c: any) => (
                  <TableRow key={c.id}>
                    <TableCell className="text-sm">{format(new Date(c.created_at), "dd-MM-yyyy hh:mm a")}</TableCell>
                    <TableCell className="font-medium">{c.marketing_templates?.template_name || "—"}</TableCell>
                    <TableCell>{c.total_messages}</TableCell>
                    <TableCell className="text-primary">{c.sent_count}</TableCell>
                    <TableCell className="text-destructive">{c.failed_count}</TableCell>
                    <TableCell><Badge variant={c.status === "completed" ? "default" : "secondary"}>{c.status}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
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
            <TabsTrigger value="templates">Templates</TabsTrigger>
            <TabsTrigger value="history">Sent History</TabsTrigger>
          </TabsList>
          <TabsContent value="api">
            <GlobalApiSettings />
          </TabsContent>
          <TabsContent value="templates">
            <TemplatesManager />
          </TabsContent>
          <TabsContent value="history">
            <UnifiedHistory />
          </TabsContent>
        </Tabs>
      </div>
    </PasswordGate>
  );
};

export default WhatsAppSettingsPage;
