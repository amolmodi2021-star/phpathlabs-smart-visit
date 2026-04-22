CREATE OR REPLACE FUNCTION public.get_drip_pending_counts(
  p_filter_ids uuid[],
  p_exclude_blacklist boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb;
  v_pending_abc bigint := 0;
  v_pending_abnormal bigint := 0;
  v_abc_records jsonb := '[]'::jsonb;
  v_abnormal_records jsonb := '[]'::jsonb;
BEGIN
  -- Build the same data structure the JS preflight builds, fully server-side.
  -- Mirrors AutomatedMarketing.tsx pendingCounts logic exactly:
  --  1) load enabled filters (passed in), sorted by priority
  --  2) group contacts by 10-digit mobile, exclude blacklisted mobiles
  --  3) for each mobile, find lowest-priority filter that still has unsent eligible contacts
  --  4) within that priority, count unsent contacts per filter (ABC vs Abnormal)
  --  5) hybrid sent detection for ABC: union of drip-log sends and CRM last_sent_type='ABC'

  WITH
  enabled_filters AS (
    SELECT f.id, f.message_type, f.priority
    FROM drip_campaign_filters f
    WHERE f.id = ANY(p_filter_ids) AND f.enabled = true
    ORDER BY f.priority
  ),
  blacklist AS (
    SELECT DISTINCT RIGHT(REGEXP_REPLACE(mobile_number, '\D', '', 'g'), 10) AS mob10
    FROM crm_blacklist
    WHERE p_exclude_blacklist = true
  ),
  contacts_normalized AS (
    SELECT
      c.primary_key,
      c.umr_number,
      c.patient_name,
      c.mobile_number,
      c.last_sent_type,
      c.last_sent_date,
      RIGHT(REGEXP_REPLACE(c.mobile_number, '\D', '', 'g'), 10) AS mob10
    FROM crm_contacts c
    WHERE c.mobile_number IS NOT NULL
      AND LENGTH(RIGHT(REGEXP_REPLACE(c.mobile_number, '\D', '', 'g'), 10)) = 10
      AND (NOT p_exclude_blacklist OR RIGHT(REGEXP_REPLACE(c.mobile_number, '\D', '', 'g'), 10) NOT IN (SELECT mob10 FROM blacklist))
  ),
  abnormal_pks AS (
    SELECT DISTINCT contact_primary_key FROM crm_abnormal_tests
  ),
  mobile_cycles AS (
    SELECT mobile_number, current_cycle FROM drip_mobile_cycles
  ),
  -- Drip-log sent records joined with current cycle filter
  drip_sent AS (
    SELECT l.mobile_number, l.filter_id, l.contact_primary_key
    FROM drip_campaign_log l
    LEFT JOIN mobile_cycles mc ON mc.mobile_number = l.mobile_number
    WHERE l.status = 'sent'
      AND COALESCE(l.cycle_number, 1) = COALESCE(mc.current_cycle, 1)
      AND l.contact_primary_key IS NOT NULL
      AND l.filter_id = ANY(p_filter_ids)
  ),
  -- For each (mobile, filter) compute eligible_pks and sent_pks, then unsent
  per_mobile_filter AS (
    SELECT
      cn.mob10,
      ef.id AS filter_id,
      ef.message_type,
      ef.priority,
      ARRAY_AGG(cn.primary_key) FILTER (WHERE
        (ef.message_type = 'abc_card' AND cn.umr_number IS NOT NULL AND TRIM(cn.umr_number) <> '')
        OR (ef.message_type = 'abnormal_card' AND cn.primary_key IN (SELECT contact_primary_key FROM abnormal_pks))
        OR (ef.message_type NOT IN ('abc_card', 'abnormal_card'))
      ) AS eligible_pks
    FROM contacts_normalized cn
    CROSS JOIN enabled_filters ef
    GROUP BY cn.mob10, ef.id, ef.message_type, ef.priority
  ),
  per_mobile_filter_sent AS (
    SELECT
      pmf.mob10,
      pmf.filter_id,
      pmf.message_type,
      pmf.priority,
      pmf.eligible_pks,
      -- drip-log sent PKs for this mobile+filter
      COALESCE((
        SELECT ARRAY_AGG(DISTINCT ds.contact_primary_key)
        FROM drip_sent ds
        WHERE ds.mobile_number = pmf.mob10 AND ds.filter_id = pmf.filter_id
      ), ARRAY[]::text[]) AS drip_sent_pks,
      -- CRM-sent PKs (only for ABC): contacts on this mobile with last_sent_type='ABC' + valid UMR
      CASE WHEN pmf.message_type = 'abc_card' THEN COALESCE((
        SELECT ARRAY_AGG(cn.primary_key)
        FROM contacts_normalized cn
        WHERE cn.mob10 = pmf.mob10
          AND cn.last_sent_type = 'ABC'
          AND cn.umr_number IS NOT NULL AND TRIM(cn.umr_number) <> ''
      ), ARRAY[]::text[]) ELSE ARRAY[]::text[] END AS crm_sent_pks
    FROM per_mobile_filter pmf
  ),
  per_mobile_filter_unsent AS (
    SELECT
      s.mob10,
      s.filter_id,
      s.message_type,
      s.priority,
      s.eligible_pks,
      -- union of drip+crm sent
      (SELECT ARRAY(SELECT UNNEST(s.drip_sent_pks) UNION SELECT UNNEST(s.crm_sent_pks))) AS sent_union,
      ARRAY(
        SELECT pk FROM UNNEST(s.eligible_pks) pk
        WHERE pk IS NOT NULL
          AND pk NOT IN (SELECT UNNEST(s.drip_sent_pks))
          AND pk NOT IN (SELECT UNNEST(s.crm_sent_pks))
      ) AS unsent_pks
    FROM per_mobile_filter_sent s
    WHERE s.eligible_pks IS NOT NULL AND array_length(s.eligible_pks, 1) > 0
  ),
  -- Determine the "locked" lowest-priority filter for each mobile that still has unsent items
  mobile_lock AS (
    SELECT mob10, MIN(priority) AS locked_priority
    FROM per_mobile_filter_unsent
    WHERE array_length(unsent_pks, 1) > 0
    GROUP BY mob10
  ),
  -- Only count filters at the locked priority for each mobile
  active_unsent AS (
    SELECT u.*
    FROM per_mobile_filter_unsent u
    JOIN mobile_lock ml ON ml.mob10 = u.mob10 AND ml.locked_priority = u.priority
    WHERE array_length(u.unsent_pks, 1) > 0
  ),
  unsent_with_contact AS (
    SELECT
      a.mob10,
      a.filter_id,
      a.message_type,
      cn.primary_key,
      cn.umr_number,
      cn.patient_name,
      cn.mobile_number,
      cn.last_sent_type,
      cn.last_sent_date,
      COALESCE(mc.current_cycle, 1) AS cycle
    FROM active_unsent a
    JOIN contacts_normalized cn ON cn.mob10 = a.mob10 AND cn.primary_key = ANY(a.unsent_pks)
    LEFT JOIN mobile_cycles mc ON mc.mobile_number = a.mob10
  )
  SELECT
    COALESCE(SUM(CASE WHEN message_type = 'abc_card' THEN 1 ELSE 0 END), 0)::bigint,
    COALESCE(SUM(CASE WHEN message_type = 'abnormal_card' THEN 1 ELSE 0 END), 0)::bigint,
    COALESCE(jsonb_agg(jsonb_build_object(
      'Primary Key', primary_key,
      'UMR Number', COALESCE(umr_number, ''),
      'Patient Name', COALESCE(patient_name, ''),
      'Mobile Number', COALESCE(mobile_number, ''),
      'Cycle Number', cycle,
      'Last Sent Type', COALESCE(last_sent_type, ''),
      'Last Sent Date', CASE WHEN last_sent_date IS NOT NULL
        THEN to_char(last_sent_date, 'DD-MM-YYYY') ELSE '' END,
      'Days Ago', CASE WHEN last_sent_date IS NOT NULL
        THEN FLOOR(EXTRACT(EPOCH FROM (now() - last_sent_date)) / 86400)::int ELSE NULL END
    )) FILTER (WHERE message_type = 'abc_card'), '[]'::jsonb),
    COALESCE(jsonb_agg(jsonb_build_object(
      'Primary Key', primary_key,
      'UMR Number', COALESCE(umr_number, ''),
      'Patient Name', COALESCE(patient_name, ''),
      'Mobile Number', COALESCE(mobile_number, ''),
      'Cycle Number', cycle,
      'Last Sent Type', COALESCE(last_sent_type, ''),
      'Last Sent Date', CASE WHEN last_sent_date IS NOT NULL
        THEN to_char(last_sent_date, 'DD-MM-YYYY') ELSE '' END,
      'Days Ago', CASE WHEN last_sent_date IS NOT NULL
        THEN FLOOR(EXTRACT(EPOCH FROM (now() - last_sent_date)) / 86400)::int ELSE NULL END
    )) FILTER (WHERE message_type = 'abnormal_card'), '[]'::jsonb)
  INTO v_pending_abc, v_pending_abnormal, v_abc_records, v_abnormal_records
  FROM unsent_with_contact;

  v_result := jsonb_build_object(
    'pendingAbc', v_pending_abc,
    'pendingAbnormal', v_pending_abnormal,
    'pendingAbcRecords', v_abc_records,
    'pendingAbnormalRecords', v_abnormal_records
  );

  RETURN v_result;
END;
$function$;
