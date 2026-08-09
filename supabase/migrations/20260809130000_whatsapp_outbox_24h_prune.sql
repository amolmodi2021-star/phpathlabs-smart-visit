-- 24h retention for WhatsApp Console invoice outbox rows (media cleaned by desktop-api).
CREATE OR REPLACE FUNCTION public.prune_whatsapp_console_outbox_24h()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_count integer := 0;
BEGIN
  DELETE FROM public.whatsapp_console_outbox
  WHERE created_at < now() - interval '24 hours';
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

REVOKE ALL ON FUNCTION public.prune_whatsapp_console_outbox_24h() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.prune_whatsapp_console_outbox_24h() TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN
      PERFORM cron.unschedule('prune-whatsapp-console-outbox-24h');
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    PERFORM cron.schedule(
      'prune-whatsapp-console-outbox-24h',
      '35 * * * *',
      $cron$SELECT public.prune_whatsapp_console_outbox_24h()$cron$
    );
  END IF;
EXCEPTION
  WHEN OTHERS THEN NULL;
END $$;
