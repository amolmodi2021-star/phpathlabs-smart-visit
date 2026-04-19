-- Remove drip_runs from realtime publication if present, then drop the table.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'drip_runs'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime DROP TABLE public.drip_runs';
  END IF;
END $$;

DROP TABLE IF EXISTS public.drip_runs;