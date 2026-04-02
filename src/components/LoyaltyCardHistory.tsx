import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ChevronDown, ChevronUp, ExternalLink, Trash2, Send, Loader2, Eye, EyeOff, Settings, FileText } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import DeletePasswordDialog from "@/components/DeletePasswordDialog";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

const LoyaltyCardHistory = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [expandedJob, setExpandedJob] = useState<string | null>(null);
  const [selectedJobs, setSelectedJobs] = useState<Set<string>>(new Set());
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteMode, setDeleteMode] = useState<"selected" | "all">("selected");
  const [sendingJobId, setSendingJobId] = useState<string | null>(null);
  const [apiLogs, setApiLogs] = useState<{ timestamp: string; direction: string; data: unknown }[]>([]);

  // WhatsApp API Settings (persisted in app_settings)
  const [waSettingsOpen, setWaSettingsOpen] = useState(false);
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

  // Load WA settings from DB
  useEffect(() => {
    const loadSettings = async () => {
      const { data } = await supabase.from("app_settings").select("setting_key, setting_value");
      if (!data) return;
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

  const sendViaWhatsApp = async (jobId: string) => {
    if (!waBaseUrl || !waApiKey || !waTemplateName) {
      return toast({ title: "Configure WhatsApp API settings first (expand settings below)", variant: "destructive" });
    }
    setSendingJobId(jobId);
    try {
      const payload = {
        jobId,
        apiBaseUrl: waBaseUrl,
        apiKey: "***hidden***",
        authHeaderName: waAuthHeaderName,
        authHeaderPrefix: waAuthHeaderPrefix,
        fromNumber: waFromNumber,
        campaignName: waCampaignName,
        templateName: waTemplateName,
        variablesMapping: waBodyMapping ? JSON.parse(waBodyMapping) : {},
        includeMediaHeader: waMediaHeader,
        queueEnabled,
        delayMs,
      };
      setApiLogs(prev => [...prev, { timestamp: new Date().toLocaleTimeString(), direction: "REQUEST → Edge Function", data: payload }]);

      const res = await supabase.functions.invoke("send-loyalty-whatsapp", {
        body: { ...payload, apiKey: waApiKey },
      });
      if (res.error) throw res.error;
      const result = res.data;
      setApiLogs(prev => [...prev, { timestamp: new Date().toLocaleTimeString(), direction: "RESPONSE ← Edge Function", data: result }]);
      toast({ title: `Sent ${result.sentCount}/${result.total} messages` });
      queryClient.invalidateQueries({ queryKey: ["loyalty_card_jobs"] });
      queryClient.invalidateQueries({ queryKey: ["loyalty_cards"] });
    } catch (err: any) {
      setApiLogs(prev => [...prev, { timestamp: new Date().toLocaleTimeString(), direction: "ERROR", data: err.message }]);
      toast({ title: "WhatsApp send failed", description: err.message, variant: "destructive" });
    } finally {
      setSendingJobId(null);
    }
  };

  const { data: jobs = [] } = useQuery({
    queryKey: ["loyalty_card_jobs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("loyalty_card_jobs")
        .select("*, loyalty_card_templates(name)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: cards = [] } = useQuery({
    queryKey: ["loyalty_cards", expandedJob],
    queryFn: async () => {
      if (!expandedJob) return [];
      const { data, error } = await supabase
        .from("loyalty_cards")
        .select("*")
        .eq("job_id", expandedJob)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data;
    },
    enabled: !!expandedJob,
  });

  const toggleJob = (id: string) => {
    setSelectedJobs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedJobs.size === jobs.length) {
      setSelectedJobs(new Set());
    } else {
      setSelectedJobs(new Set(jobs.map((j: any) => j.id)));
    }
  };

  const handleDeleteConfirmed = async () => {
    const idsToDelete = deleteMode === "all" ? jobs.map((j: any) => j.id) : Array.from(selectedJobs);
    if (idsToDelete.length === 0) return;

    try {
      // Delete cards first, then jobs
      for (const jobId of idsToDelete) {
        await supabase.from("loyalty_cards").delete().eq("job_id", jobId);
      }
      await supabase.from("loyalty_card_jobs").delete().in("id", idsToDelete);

      setSelectedJobs(new Set());
      setExpandedJob(null);
      queryClient.invalidateQueries({ queryKey: ["loyalty_card_jobs"] });
      queryClient.invalidateQueries({ queryKey: ["loyalty_cards"] });
      toast({ title: `${idsToDelete.length} job(s) deleted` });
    } catch (err: any) {
      toast({ title: "Delete failed", description: err.message, variant: "destructive" });
    }
  };

  const statusColor = (s: string) => {
    switch (s) {
      case "completed": return "default";
      case "processing": return "secondary";
      case "failed": return "destructive";
      default: return "outline";
    }
  };

  const whatsappStatusColor = (s: string) => {
    switch (s) {
      case "sent": return "default";
      case "failed": return "destructive";
      default: return "outline";
    }
  };

  return (
    <div className="space-y-4">
      {jobs.length > 0 && (
        <div className="flex items-center gap-2">
          <Checkbox
            checked={jobs.length > 0 && selectedJobs.size === jobs.length}
            onCheckedChange={toggleAll}
          />
          <span className="text-xs text-muted-foreground">Select All</span>
          <div className="flex-1" />
          {selectedJobs.size > 0 && (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => { setDeleteMode("selected"); setDeleteDialogOpen(true); }}
            >
              <Trash2 className="h-4 w-4 mr-1" />
              Delete Selected ({selectedJobs.size})
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => { setDeleteMode("all"); setDeleteDialogOpen(true); }}
          >
            <Trash2 className="h-4 w-4 mr-1" />
            Delete All
          </Button>
        </div>
      )}

      {jobs.length === 0 && <p className="text-sm text-muted-foreground">No jobs yet. Generate cards from the Send Cards tab.</p>}

      {jobs.map((job: any) => (
        <Card key={job.id}>
          <CardHeader className="py-3">
            <div className="flex items-center gap-2">
              <Checkbox
                checked={selectedJobs.has(job.id)}
                onCheckedChange={() => toggleJob(job.id)}
                onClick={(e) => e.stopPropagation()}
              />
              <div
                className="flex items-center justify-between flex-1 cursor-pointer"
                onClick={() => setExpandedJob(expandedJob === job.id ? null : job.id)}
              >
                <CardTitle className="text-sm flex items-center gap-2">
                  {job.loyalty_card_templates?.name || "Unknown Template"}
                  <Badge variant={statusColor(job.status)}>{job.status}</Badge>
                  <span className="text-xs text-muted-foreground">{job.total_cards} cards</span>
                </CardTitle>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={sendingJobId === job.id}
                    onClick={(e) => { e.stopPropagation(); sendViaWhatsApp(job.id); }}
                  >
                    {sendingJobId === job.id ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Send className="h-3.5 w-3.5 mr-1" />}
                    Send WhatsApp
                  </Button>
                  <span className="text-xs text-muted-foreground">{format(new Date(job.created_at), "dd-MM-yyyy HH:mm")}</span>
                  {expandedJob === job.id ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </div>
              </div>
            </div>
          </CardHeader>
          {expandedJob === job.id && (
            <CardContent>
              <div className="overflow-auto max-h-64">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Name</TableHead>
                      <TableHead className="text-xs">Mobile</TableHead>
                      <TableHead className="text-xs">UMR</TableHead>
                      <TableHead className="text-xs">Discount</TableHead>
                      <TableHead className="text-xs">Expiry</TableHead>
                      <TableHead className="text-xs">Image</TableHead>
                      <TableHead className="text-xs">WhatsApp</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {cards.map((c: any) => (
                      <TableRow key={c.id}>
                        <TableCell className="text-xs">{c.patient_name}</TableCell>
                        <TableCell className="text-xs">{c.mobile}</TableCell>
                        <TableCell className="text-xs">{c.umr}</TableCell>
                        <TableCell className="text-xs">{c.discount}</TableCell>
                        <TableCell className="text-xs">{c.expiry_date}</TableCell>
                        <TableCell className="text-xs">
                          {c.image_url ? (
                            <a href={c.image_url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline flex items-center gap-1">
                              View <ExternalLink className="h-3 w-3" />
                            </a>
                          ) : "—"}
                        </TableCell>
                        <TableCell><Badge variant={whatsappStatusColor(c.whatsapp_status)} className="text-xs">{c.whatsapp_status}</Badge></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          )}
        </Card>
      ))}

      {/* WhatsApp API Settings */}
      <Collapsible open={waSettingsOpen} onOpenChange={setWaSettingsOpen}>
        <Card>
          <CollapsibleTrigger asChild>
            <CardHeader className="py-3 cursor-pointer hover:bg-muted/50">
              <CardTitle className="text-sm flex items-center gap-2">
                <Settings className="h-4 w-4" />
                WhatsApp API Settings
              </CardTitle>
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
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
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      {/* API Payload Logs */}
      {apiLogs.length > 0 && (
        <Card>
          <CardHeader className="py-3 flex flex-row items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2"><FileText className="h-4 w-4" /> WhatsApp API Payload Logs</CardTitle>
            <Button variant="outline" size="sm" onClick={() => setApiLogs([])}>Clear Logs</Button>
          </CardHeader>
          <CardContent className="space-y-2 max-h-[400px] overflow-y-auto">
            {apiLogs.map((log, idx) => (
              <div key={idx} className="border rounded p-2 text-xs">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`font-bold ${log.direction.includes("ERROR") ? "text-red-600" : log.direction.includes("RESPONSE") ? "text-green-600" : "text-blue-600"}`}>
                    {log.direction}
                  </span>
                  <span className="text-muted-foreground">{log.timestamp}</span>
                </div>
                <pre className="whitespace-pre-wrap bg-muted rounded p-2 font-mono text-xs overflow-x-auto">
                  {typeof log.data === "string" ? log.data : JSON.stringify(log.data, null, 2)}
                </pre>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <DeletePasswordDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        onSuccess={handleDeleteConfirmed}
        description={deleteMode === "all" ? "Delete all jobs and associated cards permanently." : `Delete ${selectedJobs.size} selected job(s) and associated cards permanently.`}
      />
    </div>
  );
};

export default LoyaltyCardHistory;
