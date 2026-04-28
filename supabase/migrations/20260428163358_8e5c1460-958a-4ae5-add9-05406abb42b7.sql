-- Rewrite WhatsApp chat RPCs to:
--  1) Read ONLY from webhook_messages (no more message_send_log UNION)
--  2) Drop the estimates-name lookup (use only webhook sender_name)
-- This cuts the chat to inbound + manually-typed outbound replies, and
-- removes loyalty/estimate/home-visit log entries from appearing in the chat.

CREATE OR REPLACE FUNCTION public.get_wa_chat_messages(
  p_mobile_10 text,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS TABLE(
  id uuid, source text, direction text, message text, message_type text,
  media_url text, location_lat numeric, location_lng numeric,
  delivery_status text, error_info jsonb, message_id text,
  ts timestamp with time zone
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
  ORDER BY wm.created_at DESC
  LIMIT p_limit OFFSET p_offset;
$function$;

CREATE OR REPLACE FUNCTION public.get_wa_contacts_paginated(
  p_search text DEFAULT ''::text,
  p_offset integer DEFAULT 0,
  p_limit integer DEFAULT 30,
  p_unread_only boolean DEFAULT false
)
RETURNS TABLE(
  mobile text, contact_name text, profile_name text,
  last_message text, last_time timestamp with time zone,
  unread_count bigint
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH all_mobiles AS (
    SELECT DISTINCT RIGHT(REGEXP_REPLACE(sender_number, '\D', '', 'g'), 10) AS mobile10
    FROM webhook_messages
    WHERE RIGHT(REGEXP_REPLACE(sender_number, '\D', '', 'g'), 10) <> ''
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
  combined AS (
    SELECT
      am.mobile10 AS mobile,
      COALESCE(lw.sender_name, '') AS contact_name,
      COALESCE(lw.sender_name, '') AS profile_name,
      COALESCE(lw.msg, '') AS last_message,
      lw.ts AS last_time,
      COALESCE(uc.cnt, 0)::bigint AS unread_count
    FROM all_mobiles am
    LEFT JOIN unread_counts uc ON uc.mobile10 = am.mobile10
    LEFT JOIN latest_webhook lw ON lw.mobile10 = am.mobile10
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

-- Convenience function: delete ALL chat history (called from UI behind a password gate)
CREATE OR REPLACE FUNCTION public.delete_all_whatsapp_chats()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_count bigint;
BEGIN
  SELECT COUNT(*) INTO v_count FROM webhook_messages;
  TRUNCATE TABLE webhook_messages;
  RETURN v_count;
END;
$$;