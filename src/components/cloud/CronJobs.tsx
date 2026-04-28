import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Play } from "lucide-react";
import { toast } from "sonner";
import { CronJob, LastRun, invokeFunction } from "@/lib/cloudUsage";
import { format } from "date-fns";

interface Props {
  cronJobs: CronJob[];
  lastRuns: Record<string, LastRun>;
  onRefetch: () => void;
}

// Map from cron job name → edge function name
const CRON_TO_FN: Record<string, string> = {
  "cleanup-outsourced-snips-daily": "cleanup-outsourced-snips",
};

const CronJobs = ({ cronJobs, lastRuns, onRefetch }: Props) => {
  const [busy, setBusy] = useState<string | null>(null);

  const runNow = async (fnName: string) => {
    setBusy(fnName);
    try {
      await invokeFunction(fnName);
      toast.success(`${fnName} executed`);
      onRefetch();
    } catch (e: any) {
      toast.error(`${fnName} failed`, { description: e.message });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Scheduled Cron Jobs</CardTitle>
      </CardHeader>
      <CardContent>
        {cronJobs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No cron jobs found.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Job</TableHead>
                <TableHead>Schedule</TableHead>
                <TableHead>Active</TableHead>
                <TableHead>Last Run</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {cronJobs.map((j) => {
                const fnName = CRON_TO_FN[j.jobname];
                const last = fnName ? lastRuns[fnName] : undefined;
                return (
                  <TableRow key={j.jobid}>
                    <TableCell className="font-mono text-xs">{j.jobname}</TableCell>
                    <TableCell className="font-mono text-xs">{j.schedule}</TableCell>
                    <TableCell>
                      <Badge variant={j.active ? "default" : "secondary"} className="text-[10px]">
                        {j.active ? "Active" : "Paused"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {last ? format(new Date(last.ran_at), "dd-MM-yyyy HH:mm") : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      {fnName ? (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busy !== null}
                          onClick={() => runNow(fnName)}
                        >
                          {busy === fnName ? <Loader2 className="h-3 w-3 animate-spin" /> : <><Play className="h-3 w-3 mr-1" />Run Now</>}
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
};

export default CronJobs;
