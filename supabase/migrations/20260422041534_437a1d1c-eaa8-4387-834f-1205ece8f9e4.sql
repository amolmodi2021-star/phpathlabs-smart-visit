DO $$
DECLARE
  jid bigint;
BEGIN
  SELECT jobid INTO jid FROM cron.job WHERE jobname = 'cleanup-card-images-midnight' LIMIT 1;
  IF jid IS NOT NULL THEN
    PERFORM cron.alter_job(job_id := jid, active := false);
  END IF;
END $$;