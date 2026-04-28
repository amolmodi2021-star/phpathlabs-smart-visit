-- Drop messaging log tables entirely
DROP TABLE IF EXISTS public.message_send_log CASCADE;
DROP TABLE IF EXISTS public.drip_campaign_log CASCADE;
DROP TABLE IF EXISTS public.drip_mobile_cycles CASCADE;
DROP TABLE IF EXISTS public.loyalty_cards CASCADE;
DROP TABLE IF EXISTS public.loyalty_card_jobs CASCADE;

-- Drop RPC that depended on message_send_log
DROP FUNCTION IF EXISTS public.get_new_numbers_paginated(text, integer, integer) CASCADE;

-- Wipe existing WhatsApp chat history (table itself stays for future messages)
TRUNCATE TABLE public.webhook_messages;

-- Unschedule the prescription cleanup cron (prescriptions now deleted on scan)
DO $$
DECLARE
  v_jobid bigint;
BEGIN
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname ILIKE '%cleanup-prescriptions%' LIMIT 1;
  IF v_jobid IS NOT NULL THEN
    PERFORM cron.unschedule(v_jobid);
  END IF;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;