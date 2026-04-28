-- 1. Drop unused CRM/drip RPCs
DROP FUNCTION IF EXISTS public.get_crm_contacts_paginated(integer, integer, text, text, text);
DROP FUNCTION IF EXISTS public.get_crm_contacts_count(text, text, text);
DROP FUNCTION IF EXISTS public.get_drip_contact_slice();
DROP FUNCTION IF EXISTS public.get_abnormal_pks();
DROP FUNCTION IF EXISTS public.get_abnormal_patients(text, integer, integer);
DROP FUNCTION IF EXISTS public.get_abnormal_patients_count(text);
DROP FUNCTION IF EXISTS public.cleanup_blacklisted_contacts();
DROP FUNCTION IF EXISTS public.cleanup_non_phpl_duplicates();
DROP FUNCTION IF EXISTS public.cleanup_non_phpl_mobile_duplicates();
DROP FUNCTION IF EXISTS public.get_abnormal_history_counts();

-- 2. Replace WhatsApp RPCs to NOT join crm_contacts
DROP FUNCTION IF EXISTS public.get_wa_chat_messages(text, integer, integer);
CREATE OR REPLACE FUNCTION public.get_wa_chat_messages(p_mobile_10 text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS TABLE(id uuid, source text, direction text, message text, message_type text, media_url text, location_lat numeric, location_lng numeric, delivery_status text, error_info jsonb, message_id text, ts timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH webhook AS (
    SELECT
      wm.id,
      'webhook'::text AS source,
      wm.direction,
      wm.message,
      wm.message_type,
      wm.media_url,
      wm.location_lat,
      wm.location_lng,
      wm.delivery_status,
      wm.error_info,
      wm.message_id,
      wm.created_at AS ts
    FROM webhook_messages wm
    WHERE RIGHT(REGEXP_REPLACE(wm.sender_number, '\D', '', 'g'), 10) = p_mobile_10
  ),
  sendlog AS (
    SELECT
      sl.id,
      'log'::text AS source,
      'outbound'::text AS direction,
      COALESCE(sl.message_content, sl.message_type || ' Sent') AS message,
      sl.message_type,
      NULL::text AS media_url,
      NULL::numeric AS location_lat,
      NULL::numeric AS location_lng,
      sl.delivery_status,
      NULL::jsonb AS error_info,
      sl.message_id,
      sl.sent_at AS ts
    FROM message_send_log sl
    WHERE RIGHT(REGEXP_REPLACE(sl.mobile_number, '\D', '', 'g'), 10) = p_mobile_10
      AND (sl.message_id IS NULL OR sl.message_id NOT IN (
        SELECT wm2.message_id FROM webhook_messages wm2
        WHERE wm2.message_id IS NOT NULL
          AND RIGHT(REGEXP_REPLACE(wm2.sender_number, '\D', '', 'g'), 10) = p_mobile_10
      ))
  )
  SELECT * FROM (SELECT * FROM webhook UNION ALL SELECT * FROM sendlog) c
  ORDER BY ts DESC
  LIMIT p_limit OFFSET p_offset;
$function$;

DROP FUNCTION IF EXISTS public.get_wa_contacts_paginated(text, integer, integer, boolean);
CREATE OR REPLACE FUNCTION public.get_wa_contacts_paginated(p_search text DEFAULT ''::text, p_offset integer DEFAULT 0, p_limit integer DEFAULT 30, p_unread_only boolean DEFAULT false)
 RETURNS TABLE(mobile text, contact_name text, profile_name text, last_message text, last_time timestamp with time zone, unread_count bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH all_mobiles AS (
    SELECT DISTINCT RIGHT(REGEXP_REPLACE(sender_number, '\D', '', 'g'), 10) AS mobile10
    FROM webhook_messages
    WHERE RIGHT(REGEXP_REPLACE(sender_number, '\D', '', 'g'), 10) != ''
    UNION
    SELECT DISTINCT RIGHT(REGEXP_REPLACE(mobile_number, '\D', '', 'g'), 10) AS mobile10
    FROM message_send_log
    WHERE RIGHT(REGEXP_REPLACE(mobile_number, '\D', '', 'g'), 10) != ''
  ),
  unread_counts AS (
    SELECT RIGHT(REGEXP_REPLACE(sender_number, '\D', '', 'g'), 10) AS mobile10,
           COUNT(*) AS cnt
    FROM webhook_messages
    WHERE direction = 'inbound' AND is_read = false
    GROUP BY 1
  ),
  latest_webhook AS (
    SELECT DISTINCT ON (RIGHT(REGEXP_REPLACE(sender_number, '\D', '', 'g'), 10))
      RIGHT(REGEXP_REPLACE(sender_number, '\D', '', 'g'), 10) AS mobile10,
      CASE WHEN direction = 'inbound' THEN message ELSE 'You: ' || COALESCE(message, '') END AS msg,
      created_at AS ts,
      sender_name
    FROM webhook_messages
    ORDER BY RIGHT(REGEXP_REPLACE(sender_number, '\D', '', 'g'), 10), created_at DESC
  ),
  latest_sendlog AS (
    SELECT DISTINCT ON (RIGHT(REGEXP_REPLACE(mobile_number, '\D', '', 'g'), 10))
      RIGHT(REGEXP_REPLACE(mobile_number, '\D', '', 'g'), 10) AS mobile10,
      'You: ' || COALESCE(message_type, 'Message') || ' Sent' AS msg,
      sent_at AS ts,
      patient_name
    FROM message_send_log
    ORDER BY RIGHT(REGEXP_REPLACE(mobile_number, '\D', '', 'g'), 10), sent_at DESC
  ),
  est_names AS (
    SELECT DISTINCT ON (RIGHT(REGEXP_REPLACE(whatsapp_number, '\D', '', 'g'), 10))
      RIGHT(REGEXP_REPLACE(whatsapp_number, '\D', '', 'g'), 10) AS mobile10,
      patient_name
    FROM estimates
    WHERE patient_name IS NOT NULL AND patient_name != ''
    ORDER BY RIGHT(REGEXP_REPLACE(whatsapp_number, '\D', '', 'g'), 10), created_at DESC
  ),
  combined AS (
    SELECT
      am.mobile10 AS mobile,
      COALESCE(en.patient_name, ls.patient_name, '') AS contact_name,
      COALESCE(lw.sender_name, '') AS profile_name,
      CASE
        WHEN lw.ts IS NOT NULL AND (ls.ts IS NULL OR lw.ts >= ls.ts) THEN lw.msg
        WHEN ls.ts IS NOT NULL THEN ls.msg
        ELSE ''
      END AS last_message,
      GREATEST(lw.ts, ls.ts) AS last_time,
      COALESCE(uc.cnt, 0)::bigint AS unread_count
    FROM all_mobiles am
    LEFT JOIN unread_counts uc ON uc.mobile10 = am.mobile10
    LEFT JOIN latest_webhook lw ON lw.mobile10 = am.mobile10
    LEFT JOIN latest_sendlog ls ON ls.mobile10 = am.mobile10
    LEFT JOIN est_names en ON en.mobile10 = am.mobile10
  )
  SELECT c.mobile, c.contact_name, c.profile_name, c.last_message, c.last_time, c.unread_count
  FROM combined c
  WHERE
    (NOT p_unread_only OR c.unread_count > 0)
    AND (
      p_search = ''
      OR c.mobile ILIKE '%' || p_search || '%'
      OR c.contact_name ILIKE '%' || p_search || '%'
      OR c.profile_name ILIKE '%' || p_search || '%'
    )
  ORDER BY c.last_time DESC NULLS LAST
  LIMIT p_limit OFFSET p_offset;
$function$;

-- 3. Trim realtime publication
DO $$
DECLARE
  t text;
  tables_to_drop text[] := ARRAY[
    'patient_results','sample_tubes','lims_test_orders','outsourced_test_snips',
    'webhook_messages','estimate_tests','phlebotomists','phlebotomist_leaves',
    'abnormal_history','crm_contacts','crm_abnormal_tests','crm_blacklist',
    'crm_import_staging','crm_sequence_rules'
  ];
BEGIN
  FOREACH t IN ARRAY tables_to_drop LOOP
    BEGIN
      EXECUTE format('ALTER PUBLICATION supabase_realtime DROP TABLE public.%I', t);
    EXCEPTION WHEN OTHERS THEN
      NULL; -- table not in publication, skip
    END;
  END LOOP;
END $$;

-- 4. Add patient_results indexes
CREATE INDEX IF NOT EXISTS idx_patient_results_reg_status
  ON public.patient_results (registration_id, status);
CREATE INDEX IF NOT EXISTS idx_patient_results_updated
  ON public.patient_results (updated_at DESC);