-- Point 1: Auto-delete abandoned estimates >30 days (status = 'Estimate Created' = never converted)
SELECT cron.schedule(
  'prune-abandoned-estimates-daily',
  '0 21 * * *',  -- 02:30 IST
  $$
    WITH stale AS (
      SELECT id FROM public.estimates
      WHERE created_at < now() - interval '30 days'
        AND status = 'Estimate Created'
    )
    , del_tests AS (
      DELETE FROM public.estimate_tests WHERE estimate_id IN (SELECT id FROM stale)
    )
    DELETE FROM public.estimates WHERE id IN (SELECT id FROM stale);
  $$
);

-- Point 4: Auto-delete lims_test_orders >7 days
SELECT cron.schedule(
  'prune-lims-test-orders-daily',
  '5 21 * * *',  -- 02:35 IST
  $$DELETE FROM public.lims_test_orders WHERE created_at < now() - interval '7 days';$$
);

-- One-time purge for estimates
DELETE FROM public.estimate_tests
 WHERE estimate_id IN (
   SELECT id FROM public.estimates
   WHERE created_at < now() - interval '30 days'
     AND status = 'Estimate Created'
 );
DELETE FROM public.estimates
 WHERE created_at < now() - interval '30 days'
   AND status = 'Estimate Created';