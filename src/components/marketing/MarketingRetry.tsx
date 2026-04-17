import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { RefreshCw, Send, Loader2 } from "lucide-react";
import { toast } from "sonner";
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
  retry_count: number;
  retry_payload: any;
}

const MarketingRetry = () => {
  const queryClient = useQueryClient();
  const [retrying, setRetrying] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });

  const { data: failed = [], isLoading } = useQuery({
    queryKey: ["marketing_failed_messages"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("message_send_log")
        .select("id, patient_name, mobile_number, sent_at, retry_count, retry_payload")
        .eq("message_type", "Marketing")
        .eq("delivery_status", "failed")
        .lt("retry_count", 1)
        .order("sent_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data || []) as FailedRow[];
    },
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["marketing_failed_messages"] });

  const daysAgo = (iso: string) => {
    const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
    return d === 0 ? "Today" : `${d}d ago`;
  };

  const retryAll = async () => {
    if (failed.length === 0) return;
    setRetrying(true);
    setProgress({ current: 0, total: failed.length });
    let succeeded = 0;
    let stillFailed = 0;

    for (let i = 0; i < failed.length; i++) {
      const row = failed[i];
      const payload = row.retry_payload;

      // Mark as retried first (so even on hard error, it's not retried again)
      await supabase
        .from("message_send_log")
        .update({ retry_count: 1 })
        .eq("id", row.id);

      if (!payload || !payload.apiUrl) {
        stillFailed++;
      } else {
        try {
          const { data: resp, error } = await supabase.functions.invoke("send-marketing-message", {
            body: payload,
          });
          const ok = !error && resp && resp.status >= 200 && resp.status < 300;
          if (ok) {
            succeeded++;
            await supabase
              .from("message_send_log")
              .update({ delivery_status: "sent" })
              .eq("id", row.id);
          } else {
            stillFailed++;
          }
        } catch {
          stillFailed++;
        }
      }

      setProgress({ current: i + 1, total: failed.length });
      if (i < failed.length - 1) await new Promise((r) => setTimeout(r, 3000));
    }

    setRetrying(false);
    refresh();
    toast.success(`Retried ${failed.length} messages — ${succeeded} succeeded, ${stillFailed} still failed and removed from list`);
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Failed Marketing Messages</CardTitle>
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
                  Each message will be re-sent with a 3-second delay. If a message fails again, it will be removed from this list.
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
          <p className="text-sm text-muted-foreground text-center py-8">No failed marketing messages to retry.</p>
        ) : (
          <div className="border rounded">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">#</TableHead>
                  <TableHead>Patient Name</TableHead>
                  <TableHead>Mobile</TableHead>
                  <TableHead>Failed At</TableHead>
                  <TableHead>Days Ago</TableHead>
                  <TableHead>Retry Count</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {failed.map((r, idx) => (
                  <TableRow key={r.id}>
                    <TableCell className="text-muted-foreground">{idx + 1}</TableCell>
                    <TableCell>{r.patient_name || "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{r.mobile_number}</TableCell>
                    <TableCell className="text-xs">{new Date(r.sent_at).toLocaleString()}</TableCell>
                    <TableCell className="text-xs">{daysAgo(r.sent_at)}</TableCell>
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
