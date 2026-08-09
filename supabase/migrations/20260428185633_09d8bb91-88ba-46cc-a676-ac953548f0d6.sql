DO $$
BEGIN
  PERFORM cron.unschedule('prune-lims-interface-logs-daily');
EXCEPTION
  WHEN OTHERS THEN
    NULL; -- job may not exist on a fresh local DB
END $$;

SELECT cron.schedule(
  'prune-lims-interface-logs-daily',
  '20 21 * * *',
  $$DELETE FROM public.lims_interface_logs WHERE created_at < now() - interval '7 days';$$
);

DELETE FROM public.lims_interface_logs WHERE created_at < now() - interval '7 days';
