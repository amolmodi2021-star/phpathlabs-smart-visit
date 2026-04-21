import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Trash2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { BucketStat, ORPHAN_BUCKETS, invokeFunction, purgeBucket } from "@/lib/cloudUsage";
import DeletePasswordDialog from "@/components/DeletePasswordDialog";

interface Props {
  buckets: BucketStat[];
  onRefetch: () => void;
}

const StorageBreakdown = ({ buckets, onRefetch }: Props) => {
  const [busy, setBusy] = useState<string | null>(null);
  const [purgeOpen, setPurgeOpen] = useState(false);
  const [purgeTarget, setPurgeTarget] = useState<string | null>(null);

  const runCleanup = async (fn: string, label: string, body?: any) => {
    setBusy(fn);
    try {
      const data = await invokeFunction(fn, body);
      toast.success(`${label} complete`, {
        description: `Removed ${data?.deleted ?? data?.files_removed ?? 0} file(s).`,
      });
      onRefetch();
    } catch (e: any) {
      toast.error(`${label} failed`, { description: e.message });
    } finally {
      setBusy(null);
    }
  };

  const handlePurge = async () => {
    if (!purgeTarget) return;
    setBusy(`purge-${purgeTarget}`);
    try {
      const data = await purgeBucket(purgeTarget, "9819111107");
      toast.success("Bucket purged", {
        description: `Removed ${data.files_removed} file(s) from ${purgeTarget}.`,
      });
      onRefetch();
    } catch (e: any) {
      toast.error("Purge failed", { description: e.message });
    } finally {
      setBusy(null);
      setPurgeTarget(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Storage Breakdown</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Bucket</TableHead>
              <TableHead className="text-right">Files</TableHead>
              <TableHead className="text-right">Size</TableHead>
              <TableHead className="text-right">&gt;7d</TableHead>
              <TableHead className="text-right">&gt;30d</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {buckets.map((b) => {
              const isOrphan = ORPHAN_BUCKETS.has(b.bucket);
              let actionFn: string | null = null;
              let actionLabel = "";
              let actionBody: any = undefined;
              if (b.bucket === "loyalty-cards") { actionFn = "cleanup-card-images"; actionLabel = "Run Cleanup"; }
              if (b.bucket === "outsourced-snips") { actionFn = "cleanup-outsourced-snips"; actionLabel = "Run Cleanup"; actionBody = { max_age_days: 0 }; }
              if (b.bucket === "prescriptions") { actionFn = "cleanup-prescriptions"; actionLabel = "Run Cleanup"; actionBody = { max_age_days: 0 }; }
              return (
                <TableRow key={b.bucket}>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      {b.bucket}
                      {isOrphan && <Badge variant="destructive" className="text-[10px]"><AlertTriangle className="h-3 w-3 mr-1" />Orphan</Badge>}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">{b.file_count.toLocaleString()}</TableCell>
                  <TableCell className="text-right">{b.size_pretty}</TableCell>
                  <TableCell className="text-right text-muted-foreground">{b.older_7d}</TableCell>
                  <TableCell className="text-right text-muted-foreground">{b.older_30d}</TableCell>
                  <TableCell className="text-right">
                    {isOrphan ? (
                      <Button
                        variant="destructive"
                        size="sm"
                        disabled={busy !== null || b.file_count === 0}
                        onClick={() => { setPurgeTarget(b.bucket); setPurgeOpen(true); }}
                      >
                        {busy === `purge-${b.bucket}` ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3 mr-1" />}
                        Purge
                      </Button>
                    ) : actionFn ? (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy !== null}
                        onClick={() => runCleanup(actionFn!, actionLabel, actionBody)}
                      >
                        {busy === actionFn ? <Loader2 className="h-3 w-3 animate-spin" /> : actionLabel}
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
      </CardContent>

      <DeletePasswordDialog
        open={purgeOpen}
        onOpenChange={setPurgeOpen}
        onSuccess={handlePurge}
        description={`This will permanently delete EVERY file in the "${purgeTarget}" bucket. This action cannot be undone.`}
      />
    </Card>
  );
};

export default StorageBreakdown;
