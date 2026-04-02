import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ChevronDown, ChevronUp, ExternalLink, Trash2, Send, Loader2, FileText } from "lucide-react";
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

  const sendViaWhatsApp = async (jobId: string) => {
    // Load settings from DB at send time
    const { data: settingsData } = await supabase.from("app_settings").select("setting_key, setting_value").like("setting_key", "loyalty_wa_%");
    const map: Record<string, string> = {};
    settingsData?.forEach((r: any) => { map[r.setting_key] = r.setting_value; });

    const waBaseUrl = map["loyalty_wa_baseUrl"] || "";
    const waApiKey = map["loyalty_wa_apiKey"] || "";
    const waTemplateName = map["loyalty_wa_templateName"] || "";

    if (!waBaseUrl || !waApiKey || !waTemplateName) {
      return toast({ title: "Configure WhatsApp API settings first (WhatsApp API Settings tab)", variant: "destructive" });
    }

    setSendingJobId(jobId);
    try {
      const payload = {
        jobId,
        apiBaseUrl: waBaseUrl,
        apiKey: "***hidden***",
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
      

      const res = await supabase.functions.invoke("send-loyalty-whatsapp", {
        body: { ...payload, apiKey: waApiKey },
      });
      if (res.error) throw res.error;
      const result = res.data;
      
      toast({ title: `Sent ${result.sentCount}/${result.total} messages` });
      queryClient.invalidateQueries({ queryKey: ["loyalty_card_jobs"] });
      queryClient.invalidateQueries({ queryKey: ["loyalty_cards"] });
    } catch (err: any) {
      
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
