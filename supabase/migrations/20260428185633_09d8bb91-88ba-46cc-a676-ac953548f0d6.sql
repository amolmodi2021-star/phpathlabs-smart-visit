
SELECT cron.unschedule('prune-lims-interface-logs-daily');

SELECT cron.schedule(
  'prune-lims-interface-logs-daily',
  '20 21 * * *',
  $$DELETE FROM public.lims_interface_logs WHERE created_at < now() - interval '7 days';$$
);

DELETE FROM public.lims_interface_logs WHERE created_at < now() - interval '7 days';
