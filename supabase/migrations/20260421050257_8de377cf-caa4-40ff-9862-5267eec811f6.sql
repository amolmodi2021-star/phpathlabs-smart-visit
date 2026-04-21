-- 1. cleanup_runs: log of cleanup invocations
CREATE TABLE IF NOT EXISTS public.cleanup_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  function_name text NOT NULL,
  ran_at timestamptz NOT NULL DEFAULT now(),
  summary jsonb DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_cleanup_runs_fn_ran ON public.cleanup_runs (function_name, ran_at DESC);

ALTER TABLE public.cleanup_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all on cleanup_runs"
  ON public.cleanup_runs
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- 2. get_cloud_usage_stats: bundles everything for the dashboard
CREATE OR REPLACE FUNCTION public.get_cloud_usage_stats()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_db_size bigint;
  v_public_size bigint;
  v_tables jsonb;
  v_buckets jsonb;
  v_crons jsonb;
  v_last_runs jsonb;
BEGIN
  -- DB size
  SELECT pg_database_size(current_database()) INTO v_db_size;

  -- Public schema size (sum of tables)
  SELECT COALESCE(SUM(pg_total_relation_size(format('%I.%I', schemaname, tablename)::regclass)), 0)
  INTO v_public_size
  FROM pg_tables WHERE schemaname = 'public';

  -- Top 20 tables in public
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

  -- Storage buckets summary
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

  -- Cron jobs
  BEGIN
    SELECT COALESCE(jsonb_agg(c), '[]'::jsonb)
    INTO v_crons
    FROM (
      SELECT
        jobid,
        jobname,
        schedule,
        active,
        command
      FROM cron.job
      ORDER BY jobname
    ) c;
  EXCEPTION WHEN OTHERS THEN
    v_crons := '[]'::jsonb;
  END;

  -- Last cleanup run timestamps grouped by function_name
  SELECT COALESCE(jsonb_object_agg(function_name, last_summary), '{}'::jsonb)
  INTO v_last_runs
  FROM (
    SELECT DISTINCT ON (function_name)
      function_name,
      jsonb_build_object('ran_at', ran_at, 'summary', summary) AS last_summary
    FROM public.cleanup_runs
    ORDER BY function_name, ran_at DESC
  ) lr;

  RETURN jsonb_build_object(
    'db_size_bytes', v_db_size,
    'db_size_pretty', pg_size_pretty(v_db_size),
    'public_size_bytes', v_public_size,
    'public_size_pretty', pg_size_pretty(v_public_size),
    'tables', v_tables,
    'buckets', v_buckets,
    'cron_jobs', v_crons,
    'last_runs', v_last_runs,
    'generated_at', now()
  );
END;
$$;

-- 3. purge_bucket: empties a bucket after password check
CREATE OR REPLACE FUNCTION public.purge_bucket(p_bucket text, p_password text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_count int;
BEGIN
  IF p_password IS NULL OR p_password <> '9819111107' THEN
    RAISE EXCEPTION 'Invalid password';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = p_bucket) THEN
    RAISE EXCEPTION 'Bucket % does not exist', p_bucket;
  END IF;

  WITH del AS (
    DELETE FROM storage.objects WHERE bucket_id = p_bucket RETURNING 1
  )
  SELECT COUNT(*) INTO v_count FROM del;

  INSERT INTO public.cleanup_runs (function_name, summary)
  VALUES ('purge_bucket', jsonb_build_object('bucket', p_bucket, 'files_removed', v_count));

  RETURN jsonb_build_object('bucket', p_bucket, 'files_removed', v_count);
END;
$$;