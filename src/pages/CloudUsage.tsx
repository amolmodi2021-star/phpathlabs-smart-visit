import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw, Database, HardDrive, Cloud, Calendar } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { fetchCloudUsageStats, CloudUsageStats } from "@/lib/cloudUsage";
import StorageBreakdown from "@/components/cloud/StorageBreakdown";
import DatabaseTables from "@/components/cloud/DatabaseTables";
import CronJobs from "@/components/cloud/CronJobs";

const CloudUsage = () => {
  const [stats, setStats] = useState<CloudUsageStats | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchCloudUsageStats();
      setStats(data);
    } catch (e: any) {
      toast.error("Failed to load stats", { description: e.message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading && !stats) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!stats) return null;

  const totalStorageBytes = stats.buckets.reduce((s, b) => s + (b.total_bytes || 0), 0);
  const totalFiles = stats.buckets.reduce((s, b) => s + (b.file_count || 0), 0);
  const activeCrons = stats.cron_jobs.filter((c) => c.active).length;

  const overviewCards = [
    { label: "Database Size", value: stats.db_size_pretty, icon: Database, sub: `Public: ${stats.public_size_pretty}` },
    { label: "Storage Used", value: prettyBytes(totalStorageBytes), icon: HardDrive, sub: `${totalFiles.toLocaleString()} files · ${stats.buckets.length} buckets` },
    { label: "Active Cron Jobs", value: String(activeCrons), icon: Calendar, sub: `${stats.cron_jobs.length} total` },
    { label: "Last Refreshed", value: format(new Date(stats.generated_at), "HH:mm:ss"), icon: Cloud, sub: format(new Date(stats.generated_at), "dd-MM-yyyy") },
  ];

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Cloud className="h-6 w-6" /> Cloud Usage
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Live breakdown of database, storage, and edge function consumption — with one-click cleanup actions.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <RefreshCw className="h-4 w-4 mr-1" />}
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {overviewCards.map((c) => (
          <Card key={c.label}>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-xs font-medium text-muted-foreground uppercase">{c.label}</CardTitle>
                <c.icon className="h-4 w-4 text-muted-foreground" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{c.value}</div>
              <p className="text-xs text-muted-foreground mt-1">{c.sub}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <StorageBreakdown buckets={stats.buckets} onRefetch={load} />
      <DatabaseTables tables={stats.tables} onRefetch={load} />
      <CronJobs cronJobs={stats.cron_jobs} lastRuns={stats.last_runs} onRefetch={load} />

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Recent Cleanup Runs</CardTitle>
        </CardHeader>
        <CardContent>
          {Object.keys(stats.last_runs).length === 0 ? (
            <p className="text-sm text-muted-foreground">No cleanup runs recorded yet. Trigger one above to populate this section.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {Object.entries(stats.last_runs).map(([fn, r]) => (
                <li key={fn} className="flex items-center justify-between border-b pb-2">
                  <span className="font-mono text-xs">{fn}</span>
                  <span className="text-xs text-muted-foreground">
                    {format(new Date(r.ran_at), "dd-MM-yyyy HH:mm:ss")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

function prettyBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} kB`;
  if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
  return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export default CloudUsage;
