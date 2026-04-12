
-- Index for faster normalization lookups
CREATE INDEX IF NOT EXISTS idx_message_send_log_mobile_last10
  ON public.message_send_log (RIGHT(REGEXP_REPLACE(mobile_number, '\D', '', 'g'), 10));

CREATE INDEX IF NOT EXISTS idx_crm_contacts_mobile_last10
  ON public.crm_contacts (RIGHT(REGEXP_REPLACE(mobile_number, '\D', '', 'g'), 10));

CREATE INDEX IF NOT EXISTS idx_crm_blacklist_mobile_last10
  ON public.crm_blacklist (RIGHT(REGEXP_REPLACE(mobile_number, '\D', '', 'g'), 10));

CREATE OR REPLACE FUNCTION public.get_new_numbers_paginated(
  p_search text DEFAULT '',
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0
)
RETURNS TABLE(
  mobile text,
  patient_name text,
  last_message_type text,
  last_sent_at timestamptz,
  message_count bigint,
  total_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH log_mobiles AS (
    SELECT
      RIGHT(REGEXP_REPLACE(sl.mobile_number, '\D', '', 'g'), 10) AS mob10,
      sl.patient_name,
      sl.message_type,
      sl.sent_at
    FROM message_send_log sl
    WHERE LENGTH(RIGHT(REGEXP_REPLACE(sl.mobile_number, '\D', '', 'g'), 10)) = 10
  ),
  crm_mobiles AS (
    SELECT DISTINCT RIGHT(REGEXP_REPLACE(c.mobile_number, '\D', '', 'g'), 10) AS mob10
    FROM crm_contacts c
    WHERE c.mobile_number IS NOT NULL
      AND LENGTH(RIGHT(REGEXP_REPLACE(c.mobile_number, '\D', '', 'g'), 10)) = 10
  ),
  bl_mobiles AS (
    SELECT DISTINCT RIGHT(REGEXP_REPLACE(b.mobile_number, '\D', '', 'g'), 10) AS mob10
    FROM crm_blacklist b
    WHERE LENGTH(RIGHT(REGEXP_REPLACE(b.mobile_number, '\D', '', 'g'), 10)) = 10
  ),
  grouped AS (
    SELECT
      lm.mob10 AS mobile,
      (ARRAY_AGG(lm.patient_name ORDER BY lm.sent_at DESC))[1] AS patient_name,
      (ARRAY_AGG(lm.message_type ORDER BY lm.sent_at DESC))[1] AS last_message_type,
      MAX(lm.sent_at) AS last_sent_at,
      COUNT(*)::bigint AS message_count
    FROM log_mobiles lm
    WHERE lm.mob10 NOT IN (SELECT mob10 FROM crm_mobiles)
      AND lm.mob10 NOT IN (SELECT mob10 FROM bl_mobiles)
    GROUP BY lm.mob10
  ),
  filtered AS (
    SELECT *
    FROM grouped g
    WHERE p_search = ''
      OR g.mobile ILIKE '%' || p_search || '%'
      OR g.patient_name ILIKE '%' || p_search || '%'
      OR g.last_message_type ILIKE '%' || p_search || '%'
  )
  SELECT
    f.mobile,
    f.patient_name,
    f.last_message_type,
    f.last_sent_at,
    f.message_count,
    COUNT(*) OVER()::bigint AS total_count
  FROM filtered f
  ORDER BY f.last_sent_at DESC
  LIMIT p_limit
  OFFSET p_offset;
$$;
