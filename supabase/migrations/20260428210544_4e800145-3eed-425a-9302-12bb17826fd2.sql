-- pg_cron is already enabled by earlier migrations on local Supabase.
-- Guard CREATE EXTENSION for environments where it may already exist / restricted.
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
EXCEPTION
  WHEN insufficient_privilege THEN
    NULL;
  WHEN OTHERS THEN
    NULL;
END $$;

-- ============================================================
-- One-time backlog purge (matches the rules below)
-- ============================================================

-- Estimates: drop abandoned estimates older than 30 days that were never
-- converted to a registration / home visit. Tests cleared first since there
-- is no FK cascade between estimates and estimate_tests in the current schema.
DELETE FROM public.estimate_tests
WHERE estimate_id IN (
  SELECT id FROM public.estimates
  WHERE created_at < now() - interval '30 days'
    AND status = 'Estimate Created'
);

DELETE FROM public.estimates
WHERE created_at < now() - interval '30 days'
  AND status = 'Estimate Created';

-- LIMS test orders: machine-interface scratch, no clinical value beyond 7 days
DELETE FROM public.lims_test_orders
WHERE created_at < now() - interval '7 days';

-- ============================================================
-- Daily cron: estimates abandoned cleanup (02:30 IST = 21:00 UTC prev day)
-- ============================================================
SELECT cron.schedule(
  'estimates-abandoned-cleanup',
  '0 21 * * *',
  $cron$
    DELETE FROM public.estimate_tests
    WHERE estimate_id IN (
      SELECT id FROM public.estimates
      WHERE created_at < now() - interval '30 days'
        AND status = 'Estimate Created'
    );
    DELETE FROM public.estimates
    WHERE created_at < now() - interval '30 days'
      AND status = 'Estimate Created';
  $cron$
);

-- ============================================================
-- Daily cron: lims_test_orders 7-day retention (02:35 IST = 21:05 UTC prev day)
-- ============================================================
SELECT cron.schedule(
  'lims-test-orders-retention',
  '5 21 * * *',
  $cron$
    DELETE FROM public.lims_test_orders
    WHERE created_at < now() - interval '7 days';
  $cron$
);