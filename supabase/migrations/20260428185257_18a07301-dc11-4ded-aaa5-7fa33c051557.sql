
-- 1. Drop cleanup_runs
DROP TABLE IF EXISTS public.cleanup_runs CASCADE;

-- 2. Update get_cloud_usage_stats to skip cleanup_runs
CREATE OR REPLACE FUNCTION public.get_cloud_usage_stats()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_db_size bigint;
  v_public_size bigint;
  v_tables jsonb;
  v_buckets jsonb;
  v_crons jsonb;
BEGIN
  SELECT pg_database_size(current_database()) INTO v_db_size;

  SELECT COALESCE(SUM(pg_total_relation_size(format('%I.%I', schemaname, tablename)::regclass)), 0)
  INTO v_public_size
  FROM pg_tables WHERE schemaname = 'public';

  SELECT COALESCE(jsonb_agg(t ORDER BY (t->>'size_bytes')::bigint DESC), '[]'::jsonb)
  INTO v_tables
  FROM (
    SELECT jsonb_build_object(
      'table_name', tablename,
      'size_bytes', pg_total_relation_size(format('%I.%I', schemaname, tablename)::regclass),
      'size_pretty', pg_size_pretty(pg_total_relation_size(format('%I.%I', schemaname, tablename)::regclass)),
      'row_estimate', (SELECT n_live_tup FROM pg_stat_user_tables WHERE relname = tablename AND schemaname = 'public')
    ) AS t
    FROM pg_tables
    WHERE schemaname = 'public'
    ORDER BY pg_total_relation_size(format('%I.%I', schemaname, tablename)::regclass) DESC
    LIMIT 20
  ) sub;

  SELECT COALESCE(jsonb_agg(b), '[]'::jsonb)
  INTO v_buckets
  FROM (
    SELECT
      bk.id AS bucket,
      bk.public AS is_public,
      COALESCE(stats.file_count, 0) AS file_count,
      COALESCE(stats.total_bytes, 0) AS total_bytes,
      pg_size_pretty(COALESCE(stats.total_bytes, 0)) AS size_pretty,
      COALESCE(stats.older_7d, 0) AS older_7d,
      COALESCE(stats.older_30d, 0) AS older_30d
    FROM storage.buckets bk
    LEFT JOIN (
      SELECT
        bucket_id,
        COUNT(*) AS file_count,
        COALESCE(SUM((metadata->>'size')::bigint), 0) AS total_bytes,
        COUNT(*) FILTER (WHERE created_at < now() - interval '7 days') AS older_7d,
        COUNT(*) FILTER (WHERE created_at < now() - interval '30 days') AS older_30d
      FROM storage.objects
      GROUP BY bucket_id
    ) stats ON stats.bucket_id = bk.id
    ORDER BY COALESCE(stats.total_bytes, 0) DESC
  ) b;

  BEGIN
    SELECT COALESCE(jsonb_agg(c), '[]'::jsonb)
    INTO v_crons
    FROM (
      SELECT jobid, jobname, schedule, active, command
      FROM cron.job ORDER BY jobname
    ) c;
  EXCEPTION WHEN OTHERS THEN
    v_crons := '[]'::jsonb;
  END;

  RETURN jsonb_build_object(
    'db_size_bytes', v_db_size,
    'db_size_pretty', pg_size_pretty(v_db_size),
    'public_size_bytes', v_public_size,
    'public_size_pretty', pg_size_pretty(v_public_size),
    'tables', v_tables,
    'buckets', v_buckets,
    'cron_jobs', v_crons,
    'last_runs', '{}'::jsonb,
    'generated_at', now()
  );
END;
$function$;

-- 3. One-time purge
DELETE FROM public.lims_unmapped_results WHERE received_at < now() - interval '7 days';
DELETE FROM public.report_link_events WHERE occurred_at < now() - interval '7 days';
DELETE FROM public.report_link_sessions WHERE started_at < now() - interval '7 days';
DELETE FROM public.app_user_login_history WHERE login_at < now() - interval '7 days';

-- 4. Schedule daily cleanup crons (02:30 IST = 21:00 UTC)
SELECT cron.unschedule(jobname) FROM cron.job
WHERE jobname IN (
  'prune-lims-unmapped-results-daily',
  'prune-report-link-events-daily',
  'prune-report-link-sessions-daily',
  'prune-app-user-login-history-daily'
);

SELECT cron.schedule(
  'prune-lims-unmapped-results-daily',
  '0 21 * * *',
  $$DELETE FROM public.lims_unmapped_results WHERE received_at < now() - interval '7 days';$$
);

SELECT cron.schedule(
  'prune-report-link-events-daily',
  '5 21 * * *',
  $$DELETE FROM public.report_link_events WHERE occurred_at < now() - interval '7 days';$$
);

SELECT cron.schedule(
  'prune-report-link-sessions-daily',
  '10 21 * * *',
  $$DELETE FROM public.report_link_sessions WHERE started_at < now() - interval '7 days';$$
);

SELECT cron.schedule(
  'prune-app-user-login-history-daily',
  '15 21 * * *',
  $$DELETE FROM public.app_user_login_history WHERE login_at < now() - interval '7 days';$$
);
