import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, Send, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { getMarketingSendDelayMs } from "@/lib/marketingDelay";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface FailedRow {
  id: string;
  patient_name: string | null;
  mobile_number: string;
  sent_at: string;
  failed_at: string | null;
  retry_count: number;
  retry_payload: any;
  message_type: string;
  umr_number: string | null;
  primary_key: string | null;
}

interface AbcConfig {
  apiBaseUrl: string;
  apiKey: string;
  authHeaderName: string;
  authHeaderPrefix: string;
  fromNumber: string;
  templateName: string;
  campaignName: string;
  mapping: Record<string, string>;
}

const MarketingRetry = () => {
  const queryClient = useQueryClient();
  const [retrying, setRetrying] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [delayMs, setDelayMs] = useState<number>(3000);

  // Load global delay for the confirmation dialog copy
  useEffect(() => { getMarketingSendDelayMs().then(setDelayMs); }, []);

  const { data: failed = [], isLoading } = useQuery({
    queryKey: ["marketing_failed_messages"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("message_send_log")
        .select("id, patient_name, mobile_number, sent_at, failed_at, retry_count, retry_payload, message_type, umr_number, primary_key")
        .in("message_type", ["Marketing", "ABC", "Abnormal History"])
        .eq("delivery_status", "failed")
        .lt("retry_count", 1)
        .order("failed_at", { ascending: false, nullsFirst: false })
        .limit(1000);
      if (error) throw error;
      return (data || []) as FailedRow[];
    },
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["marketing_failed_messages"] });

  const fmt = (iso: string | null) => iso ? format(new Date(iso), "dd-MM-yyyy hh:mm a") : "—";

  // Load ABC config once per retry batch
  const loadAbcConfig = async (): Promise<AbcConfig | null> => {
    const { data: settings } = await supabase
      .from("app_settings")
      .select("setting_key, setting_value")
      .like("setting_key", "wa_global_%");
    const cfg: Record<string, string> = {};
    (settings || []).forEach((r: any) => { cfg[r.setting_key] = r.setting_value; });

    const { data: tmpl } = await supabase
      .from("marketing_templates")
      .select("whatsapp_template_name, body_mapping, api_base_url")
      .eq("template_name", "ABC Card")
      .maybeSingle();

    const apiBaseUrl = cfg["wa_global_baseUrl"];
    const apiKey = cfg["wa_global_apiKey"];
    const templateName = tmpl?.whatsapp_template_name || "";
    if (!apiBaseUrl || !apiKey || !templateName) return null;

    let mapping: Record<string, string> = {};
    try { mapping = tmpl?.body_mapping ? JSON.parse(tmpl.body_mapping) : {}; } catch { mapping = {}; }

    return {
      apiBaseUrl,
      apiKey,
      authHeaderName: cfg["wa_global_authHeaderName"] || "apikey",
      authHeaderPrefix: cfg["wa_global_authHeaderPrefix"] || "",
      fromNumber: cfg["wa_global_fromNumber"] || "",
      templateName,
      campaignName: tmpl?.api_base_url || "",
      mapping,
    };
  };

  const retryAbc = async (row: FailedRow, abcCfg: AbcConfig): Promise<boolean> => {
    // Look up CRM contact for context
    let contact: any = null;
    if (row.primary_key) {
      const { data } = await supabase
        .from("crm_contacts")
        .select("patient_name, mobile_number, umr_number, default_discount_pct")
        .eq("primary_key", row.primary_key)
        .maybeSingle();
      contact = data;
    }
    const patientName = contact?.patient_name || row.patient_name || "";
    const umr = contact?.umr_number || row.umr_number || "";
    const discount = contact?.default_discount_pct ?? 20;
    const rawMobile = (contact?.mobile_number || row.mobile_number || "").replace(/\D/g, "");
    const normalizedMobile = rawMobile.length > 10 ? rawMobile.slice(-10) : rawMobile;
    const toNumber = normalizedMobile ? `+91${normalizedMobile}` : "";
    if (!toNumber) return false;

    const components: Record<string, unknown> = {};
    if (Object.keys(abcCfg.mapping).length > 0) {
      const sortedKeys = Object.keys(abcCfg.mapping).sort((a, b) => Number(a) - Number(b));
      const params: string[] = sortedKeys.map((key) => {
        const field = abcCfg.mapping[key];
        switch (field) {
          case "Name": return patientName;
          case "Mobile": return rawMobile;
          case "UMR": return umr;
          case "Discount %": return `${discount}%`;
          case "Expiry Date": return "";
          default: return "";
        }
      });
      components.body = { params };
    }

    const payload: Record<string, unknown> = {
      from: abcCfg.fromNumber,
      to: toNumber,
      templateName: abcCfg.templateName,
      campaignName: abcCfg.campaignName,
      type: "template",
    };
    if (Object.keys(components).length > 0) payload.components = components;

    try {
      const proxyRes = await supabase.functions.invoke("whatsapp-proxy", {
        body: {
          apiBaseUrl: abcCfg.apiBaseUrl,
          apiKey: abcCfg.apiKey,
          authHeaderName: abcCfg.authHeaderName,
          authHeaderPrefix: abcCfg.authHeaderPrefix,
          payload,
        },
      });
      return !proxyRes.error && (proxyRes.data?.status ?? 500) < 400;
    } catch {
      return false;
    }
  };

  const retryMarketing = async (row: FailedRow): Promise<boolean> => {
    if (!row.retry_payload || !row.retry_payload.apiUrl) return false;
    try {
      const { data: resp, error } = await supabase.functions.invoke("send-marketing-message", {
        body: row.retry_payload,
      });
      return !error && resp && resp.status >= 200 && resp.status < 300;
    } catch {
      return false;
    }
  };

  const retryAll = async () => {
    if (failed.length === 0) return;
    setRetrying(true);
    setProgress({ current: 0, total: failed.length });
    let succeeded = 0;
    let stillFailed = 0;
    let skipped = 0;

    // Refresh global delay just-in-time
    const activeDelay = await getMarketingSendDelayMs();
    setDelayMs(activeDelay);

    // Pre-load ABC config if any ABC rows present
    const hasAbc = failed.some((r) => r.message_type === "ABC");
    const abcCfg = hasAbc ? await loadAbcConfig() : null;
    if (hasAbc && !abcCfg) {
      setRetrying(false);
      return toast.error("WhatsApp API not configured for ABC retries. Configure in WhatsApp Settings.");
    }

    for (let i = 0; i < failed.length; i++) {
      const row = failed[i];

      // Mark as retried first (so even on hard error, it's not retried again)
      await supabase
        .from("message_send_log")
        .update({ retry_count: 1 })
        .eq("id", row.id);

      let ok = false;
      if (row.message_type === "Marketing") {
        ok = await retryMarketing(row);
      } else if (row.message_type === "ABC" && abcCfg) {
        ok = await retryAbc(row, abcCfg);
      } else {
        // Abnormal History (manual share via wa.me) — cannot auto-retry
        skipped++;
        setProgress({ current: i + 1, total: failed.length });
        if (i < failed.length - 1) await new Promise((r) => setTimeout(r, 100));
        continue;
      }

      if (ok) {
        succeeded++;
        await supabase
          .from("message_send_log")
          .update({ delivery_status: "sent", failed_at: null })
          .eq("id", row.id);
      } else {
        stillFailed++;
      }

      setProgress({ current: i + 1, total: failed.length });
      if (activeDelay > 0 && i < failed.length - 1) {
        await new Promise((r) => setTimeout(r, activeDelay));
      }
    }

    setRetrying(false);
    refresh();
    toast.success(
      `Retried ${failed.length} — ${succeeded} succeeded, ${stillFailed} still failed${skipped ? `, ${skipped} skipped (manual)` : ""}`
    );
  };

  const typeBadge = (type: string) => {
    const variant = type === "Marketing" ? "default" : type === "ABC" ? "secondary" : "outline";
    return <Badge variant={variant} className="text-[10px]">{type}</Badge>;
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Failed Messages — Retry Queue</CardTitle>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={refresh} disabled={retrying}>
            <RefreshCw className="h-4 w-4" />
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="sm" disabled={retrying || failed.length === 0}>
                {retrying ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Retrying...</>
                ) : (
                  <><Send className="h-4 w-4 mr-2" /> Retry All ({failed.length})</>
                )}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Retry {failed.length} failed messages?</AlertDialogTitle>
                <AlertDialogDescription>
                  Each message will be re-sent {delayMs === 0 ? "with no delay between sends" : `with a ${(delayMs / 1000).toString()}-second delay`} (configured in WhatsApp Settings). ABC cards rebuild the payload from CRM data; Marketing rows reuse the original payload. Abnormal History rows (manual shares) are skipped. Failed retries are removed from this list.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={retryAll}>Retry All</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {retrying && (
          <div className="space-y-2">
            <Progress value={(progress.current / progress.total) * 100} />
            <p className="text-sm text-center text-muted-foreground">{progress.current} / {progress.total}</p>
          </div>
        )}

        {isLoading ? (
          <p className="text-sm text-muted-foreground text-center py-8">Loading...</p>
        ) : failed.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">No failed messages to retry.</p>
        ) : (
          <div className="border rounded">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">#</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Patient Name</TableHead>
                  <TableHead>Mobile</TableHead>
                  <TableHead>UMR / Primary Key</TableHead>
                  <TableHead>Failed At</TableHead>
                  <TableHead>Retry Count</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {failed.map((r, idx) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-muted-foreground">{idx + 1}</TableCell>
                    <TableCell>{typeBadge(r.message_type)}</TableCell>
                    <TableCell>{r.patient_name || "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{r.mobile_number}</TableCell>
                    <TableCell className="font-mono text-xs">{r.primary_key || r.umr_number || "—"}</TableCell>
                    <TableCell className="text-xs">{fmt(r.failed_at || r.sent_at)}</TableCell>
                    <TableCell>{r.retry_count}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default MarketingRetry;
