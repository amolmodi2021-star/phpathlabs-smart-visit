import { supabase } from "@/integrations/supabase/client";

export interface BucketStat {
  bucket: string;
  is_public: boolean;
  file_count: number;
  total_bytes: number;
  size_pretty: string;
  older_7d: number;
  older_30d: number;
}

export interface TableStat {
  table_name: string;
  size_bytes: number;
  size_pretty: string;
  row_estimate: number | null;
}

export interface CronJob {
  jobid: number;
  jobname: string;
  schedule: string;
  active: boolean;
  command: string;
}

export interface LastRun {
  ran_at: string;
  summary: any;
}

export interface CloudUsageStats {
  db_size_bytes: number;
  db_size_pretty: string;
  public_size_bytes: number;
  public_size_pretty: string;
  tables: TableStat[];
  buckets: BucketStat[];
  cron_jobs: CronJob[];
  last_runs: Record<string, LastRun>;
  generated_at: string;
}

// Retention windows shown in the Cloud Usage UI for reference only
export const RETENTION_RULES: Record<string, { days: number; column: string }> = {
  lims_interface_logs: { days: 90, column: "created_at" },
  app_user_login_history: { days: 365, column: "login_at" },
  webhook_messages: { days: 90, column: "created_at" },
};

// Tables that are intentionally retained forever (clinical data)
export const FOREVER_TABLES = new Set([
  "approved_reports",
  "patient_registrations",
  "estimates",
  "estimate_tests",
  "home_visits",
]);

export const ORPHAN_BUCKETS = new Set(["report-uploads", "loyalty-cards"]);

export async function fetchCloudUsageStats(): Promise<CloudUsageStats> {
  const { data, error } = await supabase.rpc("get_cloud_usage_stats" as any);
  if (error) throw error;
  return data as unknown as CloudUsageStats;
}

export async function invokeFunction(name: string, body?: any) {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) throw error;
  return data;
}

export async function purgeBucket(bucket: string, password: string) {
  const { data, error } = await supabase.functions.invoke("purge-bucket", {
    body: { bucket, password },
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data as { bucket: string; files_removed: number };
}
