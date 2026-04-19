import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

const MAX_RETRIES_KEY = "marketing_max_retries";
const DEFAULT_MAX_RETRIES = 1;

const MarketingRetry = () => {
  const queryClient = useQueryClient();
  const [retrying, setRetrying] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [delayMs, setDelayMs] = useState<number>(3000);
  const [maxRetries, setMaxRetries] = useState<number>(DEFAULT_MAX_RETRIES);
  const [maxRetriesInput, setMaxRetriesInput] = useState<string>(String(DEFAULT_MAX_RETRIES));
  const [savingMax, setSavingMax] = useState(false);

  // Load global delay + persisted max-retries setting
  useEffect(() => {
    getMarketingSendDelayMs().then(setDelayMs);
    (async () => {
      const { data } = await supabase
        .from("app_settings")
        .select("setting_value")
        .eq("setting_key", MAX_RETRIES_KEY)
        .maybeSingle();
      const n = data?.setting_value ? parseInt(data.setting_value, 10) : DEFAULT_MAX_RETRIES;
      const safe = Number.isFinite(n) && n >= 1 ? n : DEFAULT_MAX_RETRIES;
      setMaxRetries(safe);
      setMaxRetriesInput(String(safe));
    })();
  }, []);

  const saveMaxRetries = async () => {
    const n = parseInt(maxRetriesInput, 10);
    if (!Number.isFinite(n) || n < 1) {
      toast.error("Max retries must be at least 1");
      return;
    }
    setSavingMax(true);
    const { error } = await supabase
      .from("app_settings")
      .upsert({ setting_key: MAX_RETRIES_KEY, setting_value: String(n) }, { onConflict: "setting_key" });
    setSavingMax(false);
    if (error) {
      toast.error("Failed to save: " + error.message);
      return;
    }
    setMaxRetries(n);
    toast.success(`Max retries set to ${n}`);
    queryClient.invalidateQueries({ queryKey: ["marketing_failed_messages"] });
  };

  const { data: failed = [], isLoading } = useQuery({
    queryKey: ["marketing_failed_messages", maxRetries],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("message_send_log")
        .select("id, patient_name, mobile_number, sent_at, failed_at, retry_count, retry_payload, message_type, umr_number, primary_key")
        .in("message_type", ["Marketing", "ABC", "Abnormal History", "Promotion"])
        .eq("delivery_status", "failed")
        .lt("retry_count", maxRetries)
        .order("failed_at", { ascending: false, nullsFirst: false })
        .limit(1000);
      if (error) throw error;
      return (data || []) as FailedRow[];
    },
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["marketing_failed_messages"] });

  const fmt = (iso: string | null) => iso ? format(new Date(iso), "dd-MM-yyyy hh:mm a") : "—";

  // Count rows that cannot be retried because no payload was captured (legacy failures
  // logged before the retry-payload snapshot fix).
  const missingPayloadCount = failed.filter((r) => !r.retry_payload).length;

  // Dispatch one retry. Returns true if WhatsApp API accepted the message.
  const retryOne = async (row: FailedRow): Promise<"sent" | "failed" | "skipped"> => {
    const rp = row.retry_payload;
    if (!rp) return "skipped";

    // Drip-originated rows (ABC, Abnormal History, Promotion) — call whatsapp-proxy directly
    // with the snapshotted payload. This is the same code path the original drip used.
    if (rp.kind === "drip-proxy") {
      try {
        const proxyRes = await supabase.functions.invoke("whatsapp-proxy", {
          body: {
            apiBaseUrl: rp.apiBaseUrl,
            apiKey: rp.apiKey,
            authHeaderName: rp.authHeaderName,
            authHeaderPrefix: rp.authHeaderPrefix,
            payload: rp.payload,
          },
        });
        return !proxyRes.error && (proxyRes.data?.status ?? 500) < 400 ? "sent" : "failed";
      } catch {
        return "failed";
      }
    }

    // Legacy Marketing-tab rows: send-marketing-message edge function with apiUrl shape.
    if (rp.apiUrl) {
      try {
        const { data: resp, error } = await supabase.functions.invoke("send-marketing-message", {
          body: rp,
        });
        return !error && resp && resp.status >= 200 && resp.status < 300 ? "sent" : "failed";
      } catch {
        return "failed";
      }
    }

    return "skipped";
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

    for (let i = 0; i < failed.length; i++) {
      const row = failed[i];

      const result = await retryOne(row);
      const nextCount = (row.retry_count || 0) + 1;

      if (result === "sent") {
        succeeded++;
        await supabase
          .from("message_send_log")
          .update({ delivery_status: "sent", failed_at: null, retry_count: nextCount })
          .eq("id", row.id);
      } else if (result === "failed") {
        stillFailed++;
        // Increment retry_count; row stays visible until retry_count >= maxRetries.
        await supabase
          .from("message_send_log")
          .update({ retry_count: nextCount })
          .eq("id", row.id);
      } else {
        // "skipped" — no payload to retry from. Mark as retried so it doesn't
        // keep showing in the queue forever.
        skipped++;
        await supabase
          .from("message_send_log")
          .update({ retry_count: maxRetries })
          .eq("id", row.id);
      }

      setProgress({ current: i + 1, total: failed.length });
      // Only delay between actual API calls (not skipped rows)
      if (result !== "skipped" && activeDelay > 0 && i < failed.length - 1) {
        await new Promise((r) => setTimeout(r, activeDelay));
      }
    }

    setRetrying(false);
    refresh();
    const skippedNote = skipped ? `, ${skipped} skipped (no payload)` : "";
    toast.success(
      `Retried ${failed.length} — ${succeeded} succeeded, ${stillFailed} still failed${skippedNote}`
    );
  };

  const typeBadge = (type: string) => {
    const variant =
      type === "Marketing" ? "default" :
      type === "ABC" ? "secondary" :
      type === "Promotion" ? "default" :
      "outline";
    return <Badge variant={variant} className="text-[10px]">{type}</Badge>;
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 gap-4 flex-wrap">
        <CardTitle className="text-base">Failed Messages — Retry Queue</CardTitle>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <Label htmlFor="max-retries" className="text-xs whitespace-nowrap">Max retries / row:</Label>
            <Input
              id="max-retries"
              type="number"
              min={1}
              value={maxRetriesInput}
              onChange={(e) => setMaxRetriesInput(e.target.value)}
              className="h-8 w-20"
              disabled={retrying || savingMax}
            />
            <Button
              variant="outline"
              size="sm"
              onClick={saveMaxRetries}
              disabled={retrying || savingMax || maxRetriesInput === String(maxRetries)}
            >
              {savingMax ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
            </Button>
          </div>
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
                  Each message will be re-sent {activeDelayCopy(delayMs)} (configured in WhatsApp Settings).
                  Rows stay in this queue until they reach <strong>{maxRetries}</strong> retr{maxRetries === 1 ? "y" : "ies"}.
                  {missingPayloadCount > 0 && (
                    <>
                      {" "}<strong>{missingPayloadCount} of {failed.length}</strong> rows are legacy failures with no captured payload and will be skipped — new failures going forward are fully retryable.
                    </>
                  )}
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
                  <TableHead>Retries</TableHead>
                  <TableHead>Retryable</TableHead>
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
                    <TableCell className="text-xs font-mono">{r.retry_count} / {maxRetries}</TableCell>
                    <TableCell>
                      {r.retry_payload ? (
                        <Badge variant="secondary" className="text-[10px]">Yes</Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px]">No payload</Badge>
                      )}
                    </TableCell>
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

const activeDelayCopy = (ms: number) =>
  ms === 0 ? "with no delay between sends" : `with a ${(ms / 1000).toString()}-second delay`;

export default MarketingRetry;
