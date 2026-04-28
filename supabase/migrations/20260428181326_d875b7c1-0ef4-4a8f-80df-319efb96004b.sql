DO $$
DECLARE v_jobid bigint;
BEGIN
  FOR v_jobid IN
    SELECT jobid FROM cron.job
    WHERE jobname ILIKE '%cleanup-card-images%'
       OR jobname ILIKE '%send-loyalty-whatsapp%'
       OR jobname ILIKE '%prune-old-logs%'
  LOOP
    PERFORM cron.unschedule(v_jobid);
  END LOOP;
END $$;