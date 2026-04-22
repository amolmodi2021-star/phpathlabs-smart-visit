DROP FUNCTION IF EXISTS public.get_drip_pending_summary(uuid[], boolean);

CREATE OR REPLACE FUNCTION public.get_drip_pending_summary(
  p_filter_ids uuid[],
  p_exclude_blacklist boolean DEFAULT true
)
RETURNS TABLE(
  pending_abc bigint,
  pending_abnormal bigint,
  pending_abc_records jsonb,
  pending_abnormal_records jsonb
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_now timestamptz := now();
  v_abc_filter_id uuid;
  v_abc_priority int;
  v_abn_filter_id uuid;
  v_abn_priority int;
BEGIN
  -- Pick the (single) ABC and Abnormal filters from the supplied set.
  SELECT f.id, f.priority
    INTO v_abc_filter_id, v_abc_priority
  FROM public.drip_campaign_filters f
  WHERE f.id = ANY(p_filter_ids)
    AND f.enabled = true
    AND f.message_type = 'abc_card'
  ORDER BY f.priority ASC, f.created_at ASC
  LIMIT 1;

  SELECT f.id, f.priority
    INTO v_abn_filter_id, v_abn_priority
  FROM public.drip_campaign_filters f
  WHERE f.id = ANY(p_filter_ids)
    AND f.enabled = true
    AND f.message_type = 'abnormal_card'
  ORDER BY f.priority ASC, f.created_at ASC
  LIMIT 1;

  RETURN QUERY
  WITH
  -- Blacklist normalized to last-10-digit
  bl AS (
    SELECT DISTINCT RIGHT(REGEXP_REPLACE(COALESCE(b.mobile_number, ''), '\D', '', 'g'), 10) AS mob10
    FROM public.crm_blacklist b
    WHERE LENGTH(RIGHT(REGEXP_REPLACE(COALESCE(b.mobile_number, ''), '\D', '', 'g'), 10)) = 10
  ),

  -- ABC-eligible contacts: filter EARLY (must have UMR + valid 10-digit mobile + not blacklisted)
  abc_eligible AS (
    SELECT
      c.primary_key,
      c.umr_number,
      c.patient_name,
      c.mobile_number,
      c.last_sent_type,
      c.last_sent_date,
      RIGHT(REGEXP_REPLACE(c.mobile_number, '\D', '', 'g'), 10) AS mob10
    FROM public.crm_contacts c
    WHERE c.umr_number IS NOT NULL
      AND btrim(c.umr_number) <> ''
      AND c.mobile_number IS NOT NULL
      AND LENGTH(RIGHT(REGEXP_REPLACE(c.mobile_number, '\D', '', 'g'), 10)) = 10
      AND (
        NOT p_exclude_blacklist
        OR RIGHT(REGEXP_REPLACE(c.mobile_number, '\D', '', 'g'), 10) NOT IN (SELECT mob10 FROM bl)
      )
  ),

  -- Abnormal-eligible: INNER JOIN through small abnormal table
  abn_eligible AS (
    SELECT DISTINCT
      c.primary_key,
      c.umr_number,
      c.patient_name,
      c.mobile_number,
      c.last_sent_type,
      c.last_sent_date,
      RIGHT(REGEXP_REPLACE(c.mobile_number, '\D', '', 'g'), 10) AS mob10
    FROM public.crm_abnormal_tests a
    JOIN public.crm_contacts c ON c.primary_key = a.contact_primary_key
    WHERE c.mobile_number IS NOT NULL
      AND LENGTH(RIGHT(REGEXP_REPLACE(c.mobile_number, '\D', '', 'g'), 10)) = 10
      AND (
        NOT p_exclude_blacklist
        OR RIGHT(REGEXP_REPLACE(c.mobile_number, '\D', '', 'g'), 10) NOT IN (SELECT mob10 FROM bl)
      )
  ),

  -- Distinct mobiles across both eligibility sets — used to look up cycle
  all_mobs AS (
    SELECT mob10 FROM abc_eligible
    UNION
    SELECT mob10 FROM abn_eligible
  ),
  mob_cycle AS (
    SELECT
      am.mob10,
      COALESCE(mc.current_cycle, 1) AS cycle
    FROM all_mobs am
    LEFT JOIN public.drip_mobile_cycles mc ON mc.mobile_number = am.mob10
  ),

  -- Already-sent (this filter, this cycle) — anti-join target for ABC
  abc_sent AS (
    SELECT DISTINCT l.contact_primary_key, l.mobile_number AS mob10
    FROM public.drip_campaign_log l
    JOIN mob_cycle mcy ON mcy.mob10 = l.mobile_number
    WHERE v_abc_filter_id IS NOT NULL
      AND l.filter_id = v_abc_filter_id
      AND l.status = 'sent'
      AND COALESCE(l.cycle_number, 1) = mcy.cycle
      AND l.contact_primary_key IS NOT NULL
  ),
  abc_pending_raw AS (
    SELECT e.*
    FROM abc_eligible e
    LEFT JOIN abc_sent s
      ON s.mob10 = e.mob10 AND s.contact_primary_key = e.primary_key
    WHERE v_abc_filter_id IS NOT NULL
      AND s.contact_primary_key IS NULL
      -- Mirror JS sentPks union: contacts whose CRM row already records last_sent_type='ABC' are excluded
      AND NOT (e.last_sent_type = 'ABC')
  ),

  -- Already-sent for Abnormal
  abn_sent AS (
    SELECT DISTINCT l.contact_primary_key, l.mobile_number AS mob10
    FROM public.drip_campaign_log l
    JOIN mob_cycle mcy ON mcy.mob10 = l.mobile_number
    WHERE v_abn_filter_id IS NOT NULL
      AND l.filter_id = v_abn_filter_id
      AND l.status = 'sent'
      AND COALESCE(l.cycle_number, 1) = mcy.cycle
      AND l.contact_primary_key IS NOT NULL
  ),
  abn_pending_raw AS (
    SELECT e.*
    FROM abn_eligible e
    LEFT JOIN abn_sent s
      ON s.mob10 = e.mob10 AND s.contact_primary_key = e.primary_key
    WHERE v_abn_filter_id IS NOT NULL
      AND s.contact_primary_key IS NULL
  ),

  -- Cross-filter priority lock: for each mobile that appears in BOTH pending sets,
  -- only the lower-priority (numerically smaller) filter "owns" it.
  abc_locked AS (
    SELECT p.*
    FROM abc_pending_raw p
    WHERE
      v_abn_filter_id IS NULL
      OR v_abc_priority <= v_abn_priority
      OR p.mob10 NOT IN (SELECT mob10 FROM abn_pending_raw)
  ),
  abn_locked AS (
    SELECT p.*
    FROM abn_pending_raw p
    WHERE
      v_abc_filter_id IS NULL
      OR v_abn_priority <= v_abc_priority
      OR p.mob10 NOT IN (SELECT mob10 FROM abc_pending_raw)
  ),

  abc_final AS (
    SELECT p.*, mcy.cycle
    FROM abc_locked p
    JOIN mob_cycle mcy ON mcy.mob10 = p.mob10
  ),
  abn_final AS (
    SELECT p.*, mcy.cycle
    FROM abn_locked p
    JOIN mob_cycle mcy ON mcy.mob10 = p.mob10
  )
  SELECT
    (SELECT COUNT(*) FROM abc_final)::bigint,
    (SELECT COUNT(*) FROM abn_final)::bigint,
    COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'Primary Key', primary_key,
      'UMR Number', COALESCE(umr_number, ''),
      'Patient Name', COALESCE(patient_name, ''),
      'Mobile Number', COALESCE(mobile_number, ''),
      'Cycle Number', cycle,
      'Last Sent Type', COALESCE(last_sent_type, ''),
      'Last Sent Date', CASE WHEN last_sent_date IS NULL THEN ''
        ELSE to_char(last_sent_date AT TIME ZONE 'UTC', 'DD-MM-YYYY') END,
      'Days Ago', CASE WHEN last_sent_date IS NULL THEN ''::text
        ELSE FLOOR(EXTRACT(EPOCH FROM (v_now - last_sent_date)) / 86400)::text END
    )) FROM abc_final), '[]'::jsonb),
    COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'Primary Key', primary_key,
      'UMR Number', COALESCE(umr_number, ''),
      'Patient Name', COALESCE(patient_name, ''),
      'Mobile Number', COALESCE(mobile_number, ''),
      'Cycle Number', cycle,
      'Last Sent Type', COALESCE(last_sent_type, ''),
      'Last Sent Date', CASE WHEN last_sent_date IS NULL THEN ''
        ELSE to_char(last_sent_date AT TIME ZONE 'UTC', 'DD-MM-YYYY') END,
      'Days Ago', CASE WHEN last_sent_date IS NULL THEN ''::text
        ELSE FLOOR(EXTRACT(EPOCH FROM (v_now - last_sent_date)) / 86400)::text END
    )) FROM abn_final), '[]'::jsonb);
END;
$function$;