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
    const { data: settingsData } = await supabase.from("app_settings").select("setting_key, setting_value").like("setting_key", "wa_global_%");
    const map: Record<string, string> = {};
    settingsData?.forEach((r: any) => { map[r.setting_key] = r.setting_value; });
    // Also load template name from marketing_templates for ABC Card
    const { data: tmpl } = await supabase.from("marketing_templates").select("whatsapp_template_name, body_mapping, api_base_url, from_number").eq("template_name", "ABC Card").maybeSingle();
    if (tmpl) {
      map["_templateName"] = tmpl.whatsapp_template_name || "";
      map["_bodyMapping"] = tmpl.body_mapping || "";
      map["_campaignName"] = tmpl.api_base_url || "";
      map["_mediaHeader"] = tmpl.from_number === "media_header_enabled" ? "true" : "false";
    }
    return map;
  };

  const buildPayload = (map: Record<string, string>, jobId: string) => {
    const waBaseUrl = map["wa_global_baseUrl"] || "";
    const waApiKey = map["wa_global_apiKey"] || "";
    const waTemplateName = map["_templateName"] || "";
    if (!waBaseUrl || !waApiKey || !waTemplateName) return null;
    return {
      jobId,
      apiBaseUrl: waBaseUrl,
      apiKey: waApiKey,
      authHeaderName: map["wa_global_authHeaderName"] || "apikey",
      authHeaderPrefix: map["wa_global_authHeaderPrefix"] || "",
      fromNumber: map["wa_global_fromNumber"] || "",
      campaignName: map["_campaignName"] || "",
      templateName: waTemplateName,
      variablesMapping: map["_bodyMapping"] ? JSON.parse(map["_bodyMapping"]) : {},
      includeMediaHeader: map["_mediaHeader"] !== "false",
      queueEnabled: map["wa_global_queueEnabled"] !== "false",
      delayMs: Number(map["wa_global_delayMs"] ?? 1000),
    };
  };

  const invokeChunkLoop = async (jobId: string, payload: any, label: string) => {
    // The edge function processes one chunk per call (capped to stay under
    // the platform timeout). Loop here until no pending cards remain.
    let totalSent = 0;
    let calls = 0;
    const MAX_CALLS = 200; // safety cap (200 chunks * ~40 msgs ≈ 8k cards per click)
    let startingPending = 0;

    while (calls < MAX_CALLS) {
      const res = await supabase.functions.invoke("send-loyalty-whatsapp", { body: payload });
      if (res.error) throw res.error;
      const data = res.data || {};
      totalSent += data.sentCount || 0;
      if (calls === 0) startingPending = data.startingPending || 0;
      calls++;

      // Refresh UI counts after each chunk so progress is visible
      queryClient.invalidateQueries({ queryKey: ["loyalty_card_jobs"] });
      queryClient.invalidateQueries({ queryKey: ["loyalty_cards_counts"] });

      if (!data.hasMore) break;
    }

    toast({
      title: `${label}: Sent ${totalSent}${startingPending ? ` / ${startingPending}` : ""} messages`,
      description: calls > 1 ? `Processed in ${calls} batches.` : undefined,
    });
    queryClient.invalidateQueries({ queryKey: ["loyalty_cards"] });
  };

  const sendViaWhatsApp = async (jobId: string) => {
    const map = await loadWaSettings();
    const payload = buildPayload(map, jobId);
    if (!payload) return toast({ title: "Configure WhatsApp API settings first (WhatsApp API Settings tab)", variant: "destructive" });

    setSendingJobId(jobId);
    try {
      await invokeChunkLoop(jobId, payload, "Send");
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
      await invokeChunkLoop(jobId, payload, "Retry");
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

  // Fetch exact status counts for all jobs. Reading raw rows was being capped by
  // the backend's default 1000-row limit, which made large completed jobs show
  // partial totals like 998/1653 even after refresh.
  const jobIds = useMemo(() => jobs.map((j: any) => j.id), [jobs]);
  const { data: countsMap = {} } = useQuery<Record<string, { sent: number; failed: number; pending: number }>>({
    queryKey: ["loyalty_cards_counts", jobIds],
    queryFn: async () => {
      if (jobIds.length === 0) return {};

      const entries = await Promise.all(
        jobIds.map(async (jobId) => {
          const [sentRes, failedRes, pendingRes] = await Promise.all([
            supabase
              .from("loyalty_cards")
              .select("id", { count: "exact", head: true })
              .eq("job_id", jobId)
              .eq("whatsapp_status", "sent"),
            supabase
              .from("loyalty_cards")
              .select("id", { count: "exact", head: true })
              .eq("job_id", jobId)
              .eq("whatsapp_status", "failed"),
            supabase
              .from("loyalty_cards")
              .select("id", { count: "exact", head: true })
              .eq("job_id", jobId)
              .eq("whatsapp_status", "pending"),
          ]);

          const error = sentRes.error || failedRes.error || pendingRes.error;
          if (error) throw error;

          return [
            jobId,
            {
              sent: sentRes.count ?? 0,
              failed: failedRes.count ?? 0,
              pending: pendingRes.count ?? 0,
            },
          ] as const;
        }),
      );

      return Object.fromEntries(entries);
    },
    enabled: jobIds.length > 0,
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

  // Extract Cloudinary public IDs from secure_url like
  // `https://res.cloudinary.com/<cloud>/image/upload/v123/loyalty-cards/abc.jpg`
  // → `loyalty-cards/abc`. Returns null for non-Cloudinary or malformed URLs.
  const extractCloudinaryPublicId = (url: string | null | undefined): string | null => {
    if (!url || typeof url !== "string") return null;
    const m = url.match(/\/upload\/(?:v\d+\/)?(.+)\.[a-zA-Z0-9]+$/);
    return m ? m[1] : null;
  };

  const handleDeleteConfirmed = async () => {
    const idsToDelete = deleteMode === "all" ? jobs.map((j: any) => j.id) : Array.from(selectedJobs);
    if (idsToDelete.length === 0) return;
    try {
      // Step 1: collect Cloudinary public IDs for the cards we're about to drop.
      const { data: cardsToDelete } = await supabase
        .from("loyalty_cards")
        .select("image_url")
        .in("job_id", idsToDelete);
      const publicIds = (cardsToDelete || [])
        .map((c: any) => extractCloudinaryPublicId(c.image_url))
        .filter((x: string | null): x is string => !!x);

      // Step 2: fire Cloudinary cleanup. Failures are logged, not fatal —
      // 7-day Cloudinary auto-delete sweeps anything we miss.
      if (publicIds.length > 0) {
        try {
          await supabase.functions.invoke("delete-loyalty-cloudinary", { body: { publicIds } });
        } catch (cloudErr) {
          console.warn("Cloudinary cleanup failed; relying on 7-day auto-delete", cloudErr);
        }
      }

      // Step 3: drop DB rows.
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
