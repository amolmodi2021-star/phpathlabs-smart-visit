-- Auto-clear non-clinical message / webhook logs older than 7 days.
-- Replaces the previous 90-day messaging prune.

CREATE OR REPLACE FUNCTION public.prune_messaging_logs_7d()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS 
BEGIN
  IF to_regclass('public.message_send_log') IS NOT NULL THEN
    DELETE FROM public.message_send_log WHERE created_at < now() - interval '7 days';
  END IF;
  IF to_regclass('public.drip_campaign_log') IS NOT NULL THEN
    DELETE FROM public.drip_campaign_log WHERE created_at < now() - interval '7 days';
  END IF;
  IF to_regclass('public.webhook_messages') IS NOT NULL THEN
    DELETE FROM public.webhook_messages WHERE created_at < now() - interval '7 days';
  END IF;
  IF to_regclass('public.report_link_events') IS NOT NULL THEN
    DELETE FROM public.report_link_events WHERE created_at < now() - interval '7 days';
  END IF;
  IF to_regclass('public.report_link_sessions') IS NOT NULL THEN
    DELETE FROM public.report_link_sessions WHERE created_at < now() - interval '7 days';
  END IF;
END;
;

REVOKE ALL ON FUNCTION public.prune_messaging_logs_7d() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.prune_messaging_logs_7d() TO service_role;

DO 
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN
      PERFORM cron.unschedule('prune-messaging-logs-90d');
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    BEGIN
      PERFORM cron.unschedule('prune-messaging-logs-7d');
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    PERFORM cron.schedule(
      'prune-messaging-logs-7d',
      '20 3 * * *',
      \\ public.prune_messaging_logs_7d()$
    );

    BEGIN
      PERFORM cron.unschedule('prune-lims-interface-logs-daily');
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    PERFORM cron.schedule(
      'prune-lims-interface-logs-daily',
      '25 3 * * *',
      \\ FROM public.lims_interface_logs WHERE created_at < now() - interval '7 days'$
    );

    BEGIN
      PERFORM cron.unschedule('prune-app-user-login-history-daily');
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    PERFORM cron.schedule(
      'prune-app-user-login-history-daily',
      '30 3 * * *',
      \\ FROM public.app_user_login_history WHERE login_at < now() - interval '7 days'$
    );
  END IF;
EXCEPTION
  WHEN OTHERS THEN NULL;
END ;

SELECT public.prune_messaging_logs_7d();
DELETE FROM public.lims_interface_logs WHERE created_at < now() - interval '7 days';
DELETE FROM public.app_user_login_history WHERE login_at < now() - interval '7 days';
