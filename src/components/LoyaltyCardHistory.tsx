import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ChevronDown, ChevronUp, ExternalLink, Trash2, Send, Loader2, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import DeletePasswordDialog from "@/components/DeletePasswordDialog";

const LoyaltyCardHistory = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [expandedJob, setExpandedJob] = useState<string | null>(null);
  const [selectedJobs, setSelectedJobs] = useState<Set<string>>(new Set());
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteMode, setDeleteMode] = useState<"selected" | "all">("selected");
  const [sendingJobId, setSendingJobId] = useState<string | null>(null);
  const [retryingJobId, setRetryingJobId] = useState<string | null>(null);


  const loadWaSettings = async () => {
    const { data: settingsData } = await supabase.from("app_settings").select("setting_key, setting_value").like("setting_key", "loyalty_wa_%");
    const map: Record<string, string> = {};
    settingsData?.forEach((r: any) => { map[r.setting_key] = r.setting_value; });
    return map;
  };

  const buildPayload = (map: Record<string, string>, jobId: string) => {
    const waBaseUrl = map["loyalty_wa_baseUrl"] || "";
    const waApiKey = map["loyalty_wa_apiKey"] || "";
    const waTemplateName = map["loyalty_wa_templateName"] || "";
    if (!waBaseUrl || !waApiKey || !waTemplateName) return null;
    return {
      jobId,
      apiBaseUrl: waBaseUrl,
      apiKey: waApiKey,
      authHeaderName: map["loyalty_wa_authHeaderName"] || "apikey",
      authHeaderPrefix: map["loyalty_wa_authHeaderPrefix"] || "",
      fromNumber: map["loyalty_wa_fromNumber"] || "",
      campaignName: map["loyalty_wa_campaignName"] || "",
      templateName: waTemplateName,
      variablesMapping: map["loyalty_wa_bodyMapping"] ? JSON.parse(map["loyalty_wa_bodyMapping"]) : {},
      includeMediaHeader: map["loyalty_wa_mediaHeader"] !== "false",
      queueEnabled: map["loyalty_wa_queueEnabled"] !== "false",
      delayMs: Number(map["loyalty_wa_delayMs"] || 3000),
    };
  };

  const sendViaWhatsApp = async (jobId: string) => {
    const map = await loadWaSettings();
    const payload = buildPayload(map, jobId);
    if (!payload) return toast({ title: "Configure WhatsApp API settings first (WhatsApp API Settings tab)", variant: "destructive" });

    setSendingJobId(jobId);
    try {
      const res = await supabase.functions.invoke("send-loyalty-whatsapp", { body: payload });
      if (res.error) throw res.error;
      toast({ title: `Sent ${res.data.sentCount}/${res.data.total} messages` });
      queryClient.invalidateQueries({ queryKey: ["loyalty_card_jobs"] });
      queryClient.invalidateQueries({ queryKey: ["loyalty_cards"] });
      queryClient.invalidateQueries({ queryKey: ["loyalty_cards_counts"] });
    } catch (err: any) {
      toast({ title: "WhatsApp send failed", description: err.message, variant: "destructive" });
    } finally {
      setSendingJobId(null);
    }
  };

  const retryFailed = async (jobId: string) => {
    const map = await loadWaSettings();
    const payload = buildPayload(map, jobId);
    if (!payload) return toast({ title: "Configure WhatsApp API settings first (WhatsApp API Settings tab)", variant: "destructive" });

    setRetryingJobId(jobId);
    try {
      // Reset failed cards to pending so the edge function picks them up
      await supabase.from("loyalty_cards").update({ whatsapp_status: "pending" }).eq("job_id", jobId).eq("whatsapp_status", "failed");

      const res = await supabase.functions.invoke("send-loyalty-whatsapp", { body: payload });
      if (res.error) throw res.error;
      toast({ title: `Retry: Sent ${res.data.sentCount}/${res.data.total} messages` });
      queryClient.invalidateQueries({ queryKey: ["loyalty_card_jobs"] });
      queryClient.invalidateQueries({ queryKey: ["loyalty_cards"] });
      queryClient.invalidateQueries({ queryKey: ["loyalty_cards_counts"] });
    } catch (err: any) {
      toast({ title: "Retry failed", description: err.message, variant: "destructive" });
    } finally {
      setRetryingJobId(null);
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

  // Fetch counts for all jobs
  const jobIds = useMemo(() => jobs.map((j: any) => j.id), [jobs]);
  const { data: allCardsCounts = [] } = useQuery({
    queryKey: ["loyalty_cards_counts", jobIds],
    queryFn: async () => {
      if (jobIds.length === 0) return [];
      const { data, error } = await supabase
        .from("loyalty_cards")
        .select("job_id, whatsapp_status")
        .in("job_id", jobIds);
      if (error) throw error;
      return data;
    },
    enabled: jobIds.length > 0,
  });

  const countsMap = useMemo(() => {
    const m: Record<string, { sent: number; failed: number; pending: number }> = {};
    for (const c of allCardsCounts) {
      if (!c.job_id) continue;
      if (!m[c.job_id]) m[c.job_id] = { sent: 0, failed: 0, pending: 0 };
      if (c.whatsapp_status === "sent") m[c.job_id].sent++;
      else if (c.whatsapp_status === "failed") m[c.job_id].failed++;
      else m[c.job_id].pending++;
    }
    return m;
  }, [allCardsCounts]);

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
      for (const jobId of idsToDelete) {
        await supabase.from("loyalty_cards").delete().eq("job_id", jobId);
      }
      await supabase.from("loyalty_card_jobs").delete().in("id", idsToDelete);
      setSelectedJobs(new Set());
      setExpandedJob(null);
      queryClient.invalidateQueries({ queryKey: ["loyalty_card_jobs"] });
      queryClient.invalidateQueries({ queryKey: ["loyalty_cards"] });
      queryClient.invalidateQueries({ queryKey: ["loyalty_cards_counts"] });
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

      {jobs.map((job: any) => {
        const counts = countsMap[job.id] || { sent: 0, failed: 0, pending: 0 };
        const hasFailed = counts.failed > 0;
        const hasPending = counts.pending > 0;

        return (
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
                  <div className="flex flex-col gap-1">
                    <CardTitle className="text-sm flex items-center gap-2">
                      {job.loyalty_card_templates?.name || "Unknown Template"}
                      <Badge variant={statusColor(job.status)}>{job.status}</Badge>
                      <span className="text-xs text-muted-foreground">{job.total_cards} cards</span>
                    </CardTitle>
                    <div className="flex items-center gap-3 text-xs">
                      <span className="text-green-600 font-medium">✓ Sent: {counts.sent}</span>
                      <span className="text-destructive font-medium">✗ Failed: {counts.failed}</span>
                      <span className="text-muted-foreground font-medium">⏳ Pending: {counts.pending}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {hasFailed && (
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={retryingJobId === job.id}
                        onClick={(e) => { e.stopPropagation(); retryFailed(job.id); }}
                      >
                        {retryingJobId === job.id ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 mr-1" />}
                        Retry Failed ({counts.failed})
                      </Button>
                    )}
                    {hasPending && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={sendingJobId === job.id}
                        onClick={(e) => { e.stopPropagation(); sendViaWhatsApp(job.id); }}
                      >
                        {sendingJobId === job.id ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Send className="h-3.5 w-3.5 mr-1" />}
                        Send WhatsApp
                      </Button>
                    )}
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
        );
      })}

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
