-- Scale & cloud-cost optimization:
-- 1) Outsourced queue candidate RPC
-- 2) Tiny lims_result_notify for live machine updates (Realtime)
-- 3) Indexes for queue RPCs / outsource_status / filter-sort
-- 4) Prune notify rows + optional messaging log retention

-- ---------------------------------------------------------------------------
-- 1. lims_outsourced_candidate_ids
--    Active snips OR accepted tubes containing naturally-outsourced tests
--    that are not yet in a terminal snip status.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lims_outsourced_candidate_ids()
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH active_snip_regs AS (
    SELECT DISTINCT registration_id
    FROM public.outsourced_test_snips
    WHERE outsource_status IN ('pending', 'sent', 'results_saved', 'entered', 'results_entered')
      AND registration_id IS NOT NULL
  ),
  outsourced_tests AS (
    SELECT id::text AS test_id
    FROM public.tests
    WHERE COALESCE(is_outsourced, false) = true
  ),
  terminal_snip AS (
    SELECT DISTINCT registration_id, test_id::text AS test_id
    FROM public.outsourced_test_snips
    WHERE outsource_status IN ('verified', 'approved', 'dispatched')
  ),
  accepted_natural AS (
    SELECT DISTINCT st.registration_id
    FROM public.sample_tubes st
    CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(st.test_ids, '[]'::jsonb)) AS tid
    INNER JOIN outsourced_tests ot ON ot.test_id = tid
    LEFT JOIN terminal_snip ts
      ON ts.registration_id = st.registration_id
     AND ts.test_id = tid
    WHERE st.status = 'accepted'
      AND tid IS NOT NULL
      AND tid <> ''
      AND ts.test_id IS NULL
      AND st.registration_id IS NOT NULL
  )
  SELECT COALESCE(array_agg(DISTINCT registration_id), ARRAY[]::uuid[])
  FROM (
    SELECT registration_id FROM active_snip_regs
    UNION
    SELECT registration_id FROM accepted_natural
  ) s;
$$;

REVOKE ALL ON FUNCTION public.lims_outsourced_candidate_ids() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lims_outsourced_candidate_ids() TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. lims_result_notify — tiny Realtime table for machine → UI live updates
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.lims_result_notify (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_id uuid NOT NULL REFERENCES public.patient_registrations(id) ON DELETE CASCADE,
  source text NOT NULL DEFAULT 'interface',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lims_result_notify_reg
  ON public.lims_result_notify (registration_id);

CREATE INDEX IF NOT EXISTS idx_lims_result_notify_created
  ON public.lims_result_notify (created_at DESC);

ALTER TABLE public.lims_result_notify ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS staff_all_lims_result_notify ON public.lims_result_notify;
CREATE POLICY staff_all_lims_result_notify ON public.lims_result_notify
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS service_all_lims_result_notify ON public.lims_result_notify;
CREATE POLICY service_all_lims_result_notify ON public.lims_result_notify
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Add to Realtime publication (ignore if already present)
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.lims_result_notify;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- WhatsApp chat needs live webhook_messages (was dropped earlier for cost).
-- Re-add carefully; prune keeps table bounded (90d).
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.webhook_messages;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.prune_lims_result_notify()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.lims_result_notify
  WHERE created_at < now() - interval '2 hours';
$$;

REVOKE ALL ON FUNCTION public.prune_lims_result_notify() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.prune_lims_result_notify() TO service_role;

-- Schedule prune every 30 minutes if pg_cron is available
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN
      PERFORM cron.unschedule('prune-lims-result-notify');
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    PERFORM cron.schedule(
      'prune-lims-result-notify',
      '*/30 * * * *',
      $cron$SELECT public.prune_lims_result_notify()$cron$
    );
  END IF;
EXCEPTION
  WHEN OTHERS THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 3. Indexes for queue RPCs / filter-sort
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_ots_outsource_status_reg
  ON public.outsourced_test_snips (outsource_status, registration_id);

CREATE INDEX IF NOT EXISTS idx_patient_results_status_reg
  ON public.patient_results (status, registration_id);

CREATE INDEX IF NOT EXISTS idx_pr_bill_cancelled_created
  ON public.patient_registrations (bill_cancelled, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pr_bill_cancelled_stat_invoice
  ON public.patient_registrations (bill_cancelled, is_stat DESC NULLS LAST, invoice_number DESC);

CREATE INDEX IF NOT EXISTS idx_pr_due_amount_open
  ON public.patient_registrations (created_at DESC)
  WHERE due_amount > 0 AND COALESCE(is_bad_debt, false) = false AND COALESCE(bill_cancelled, false) = false;

CREATE INDEX IF NOT EXISTS idx_sample_tubes_status_created
  ON public.sample_tubes (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sample_tubes_status_accepted_at
  ON public.sample_tubes (status, accepted_at DESC NULLS LAST);

-- ---------------------------------------------------------------------------
-- 4. Messaging / drip log retention (90 days) — non-clinical
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prune_messaging_logs_90d()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF to_regclass('public.message_send_log') IS NOT NULL THEN
    DELETE FROM public.message_send_log WHERE created_at < now() - interval '90 days';
  END IF;
  IF to_regclass('public.drip_campaign_log') IS NOT NULL THEN
    DELETE FROM public.drip_campaign_log WHERE created_at < now() - interval '90 days';
  END IF;
  IF to_regclass('public.webhook_messages') IS NOT NULL THEN
    DELETE FROM public.webhook_messages WHERE created_at < now() - interval '90 days';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.prune_messaging_logs_90d() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.prune_messaging_logs_90d() TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN
      PERFORM cron.unschedule('prune-messaging-logs-90d');
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    PERFORM cron.schedule(
      'prune-messaging-logs-90d',
      '15 3 * * *',
      $cron$SELECT public.prune_messaging_logs_90d()$cron$
    );
  END IF;
EXCEPTION
  WHEN OTHERS THEN NULL;
END $$;
