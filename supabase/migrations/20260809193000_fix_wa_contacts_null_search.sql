CREATE OR REPLACE FUNCTION public.get_wa_contacts_paginated(
  p_search text DEFAULT ''::text,
  p_offset integer DEFAULT 0,
  p_limit integer DEFAULT 30,
  p_unread_only boolean DEFAULT false
)
RETURNS TABLE(
  mobile text,
  contact_name text,
  profile_name text,
  last_message text,
  last_time timestamp with time zone,
  unread_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH params AS (
    SELECT COALESCE(p_search, '') AS search
  ),
  all_mobiles AS (
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
  FROM combined c, params p
  WHERE
    (NOT p_unread_only OR c.unread_count > 0)
    AND (
      p.search = ''
      OR c.mobile ILIKE '%' || p.search || '%'
      OR c.contact_name ILIKE '%' || p.search || '%'
      OR c.profile_name ILIKE '%' || p.search || '%'
    )
  ORDER BY c.last_time DESC NULLS LAST
  LIMIT p_limit OFFSET p_offset;
$function$;