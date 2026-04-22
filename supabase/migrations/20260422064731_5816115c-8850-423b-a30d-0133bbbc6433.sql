DROP FUNCTION IF EXISTS public.get_drip_pending_summary(uuid[], boolean);
DROP FUNCTION IF EXISTS public.get_drip_pending_summary(uuid[], boolean, int, int);

CREATE OR REPLACE FUNCTION public.get_drip_pending_summary(
  p_filter_ids uuid[],
  p_exclude_blacklist boolean DEFAULT true,
  p_min_interval_days int DEFAULT 0,
  p_max_per_day int DEFAULT 200
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
  v_cutoff timestamptz := now() - make_interval(days => GREATEST(p_min_interval_days, 0));
  v_filter_count int;
  v_fair_share int;
BEGIN
  -- Count enabled filters in the supplied set (used for fair share)
  SELECT COUNT(*) INTO v_filter_count
  FROM public.drip_campaign_filters
  WHERE id = ANY(p_filter_ids) AND enabled = true;

  IF v_filter_count = 0 THEN
    RETURN QUERY SELECT 0::bigint, 0::bigint, '[]'::jsonb, '[]'::jsonb;
    RETURN;
  END IF;

  v_fair_share := CEIL(p_max_per_day::numeric / v_filter_count)::int;

  RETURN QUERY
  WITH
  -- Step 0: filter rows in priority order, with row_number for assignment
  enabled_filters AS (
    SELECT
      f.id,
      f.message_type,
      f.location_filter,
      f.last_sent_type_filter,
      f.record_limit,
      f.priority,
      f.once_per_mobile,
      ROW_NUMBER() OVER (ORDER BY f.priority ASC, f.created_at ASC) AS prio_rank
    FROM public.drip_campaign_filters f
    WHERE f.id = ANY(p_filter_ids)
      AND f.enabled = true
  ),

  -- Blacklist normalized to last-10 digits
  bl AS (
    SELECT DISTINCT RIGHT(REGEXP_REPLACE(COALESCE(b.mobile_number, ''), '\D', '', 'g'), 10) AS mob10
    FROM public.crm_blacklist b
    WHERE LENGTH(RIGHT(REGEXP_REPLACE(COALESCE(b.mobile_number, ''), '\D', '', 'g'), 10)) = 10
  ),

  -- Mobiles seen in message_send_log within the recent window (universal interval guard)
  recent_log_mobiles AS (
    SELECT DISTINCT RIGHT(REGEXP_REPLACE(COALESCE(l.mobile_number, ''), '\D', '', 'g'), 10) AS mob10
    FROM public.message_send_log l
    WHERE l.sent_at >= v_cutoff
      AND LENGTH(RIGHT(REGEXP_REPLACE(COALESCE(l.mobile_number, ''), '\D', '', 'g'), 10)) = 10
  ),

  -- All contacts with valid 10-digit mobiles, normalized once
  contacts_norm AS (
    SELECT
      c.primary_key,
      c.umr_number,
      c.patient_name,
      c.mobile_number,
      c.location,
      c.last_sent_type,
      c.last_sent_date,
      c.visit_date,
      c.default_discount_pct,
      RIGHT(REGEXP_REPLACE(c.mobile_number, '\D', '', 'g'), 10) AS mob10
    FROM public.crm_contacts c
    WHERE c.mobile_number IS NOT NULL
      AND LENGTH(RIGHT(REGEXP_REPLACE(c.mobile_number, '\D', '', 'g'), 10)) = 10
  ),

  -- Mobile cycle lookup
  mob_cycle AS (
    SELECT
      cn.mob10,
      COALESCE(mc.current_cycle, 1) AS cycle
    FROM (SELECT DISTINCT mob10 FROM contacts_norm) cn
    LEFT JOIN public.drip_mobile_cycles mc ON mc.mobile_number = cn.mob10
  ),

  -- Cross product of every filter X every contact eligible under that filter's rules
  -- Steps 1-5: location + last_sent_type + min_interval + blacklist + abnormal join
  filter_candidates AS (
    SELECT
      ef.id           AS filter_id,
      ef.message_type,
      ef.location_filter,
      ef.last_sent_type_filter,
      ef.record_limit,
      ef.priority,
      ef.prio_rank,
      ef.once_per_mobile,
      cn.primary_key,
      cn.umr_number,
      cn.patient_name,
      cn.mobile_number,
      cn.location,
      cn.last_sent_type,
      cn.last_sent_date,
      cn.visit_date,
      cn.default_discount_pct,
      cn.mob10,
      mcy.cycle
    FROM enabled_filters ef
    JOIN contacts_norm cn ON TRUE
    JOIN mob_cycle mcy ON mcy.mob10 = cn.mob10
    WHERE
      -- Step 1: location filter
      (
        ef.location_filter = 'ALL'
        OR UPPER(BTRIM(COALESCE(cn.location, ''))) = UPPER(ef.location_filter)
      )
      -- Step 2: last_sent_type filter
      AND (
        ef.last_sent_type_filter IS NULL
        OR (ef.last_sent_type_filter = '__null__' AND cn.last_sent_type IS NULL)
        OR (ef.last_sent_type_filter NOT IN ('__null__') AND cn.last_sent_type = ef.last_sent_type_filter)
      )
      -- Step 3: min interval guard via CRM last_sent_date
      AND (
        p_min_interval_days <= 0
        OR cn.last_sent_date IS NULL
        OR cn.last_sent_date < v_cutoff
      )
      -- Step 3b: min interval guard via message_send_log
      AND (
        p_min_interval_days <= 0
        OR cn.mob10 NOT IN (SELECT mob10 FROM recent_log_mobiles)
      )
      -- Step 4: blacklist
      AND (
        NOT p_exclude_blacklist
        OR cn.mob10 NOT IN (SELECT mob10 FROM bl)
      )
      -- Step 5: per-message-type data validation
      AND (
        (ef.message_type = 'abc_card' AND cn.umr_number IS NOT NULL AND BTRIM(cn.umr_number) <> '')
        OR (ef.message_type = 'abnormal_card' AND EXISTS (
              SELECT 1 FROM public.crm_abnormal_tests a
              WHERE a.contact_primary_key = cn.primary_key
            ))
        OR (ef.message_type NOT IN ('abc_card', 'abnormal_card'))
      )
  ),

  -- Step 6: anti-join drip_campaign_log for (filter_id, current cycle, status='sent')
  -- Step 7 (ABC): also exclude PKs whose CRM last_sent_type='ABC' (mirrors JS sentPks union)
  not_sent AS (
    SELECT fc.*
    FROM filter_candidates fc
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.drip_campaign_log l
      WHERE l.filter_id = fc.filter_id
        AND l.status = 'sent'
        AND COALESCE(l.cycle_number, 1) = fc.cycle
        AND l.contact_primary_key = fc.primary_key
    )
    AND NOT (
      fc.message_type = 'abc_card' AND fc.last_sent_type = 'ABC'
    )
  ),

  -- Dedup within a single (filter, mobile): one row per mobile per filter
  -- (matches JS filterSeenMobiles guard); pick the row with lowest cycle, then never-sent first
  per_filter_mobile AS (
    SELECT DISTINCT ON (filter_id, mob10) *
    FROM not_sent
    ORDER BY filter_id, mob10, cycle ASC, (CASE WHEN last_sent_type IS NULL THEN 0 ELSE 1 END) ASC, primary_key
  ),

  -- Step 8: cross-filter claim — each mobile assigned to its highest-priority candidate filter
  claimed AS (
    SELECT DISTINCT ON (mob10) *
    FROM per_filter_mobile
    ORDER BY mob10, prio_rank ASC, cycle ASC, primary_key
  ),

  -- Step 9a: per-filter record_limit cap, then ordered for fair-share allocation
  ranked_in_filter AS (
    SELECT
      c.*,
      ROW_NUMBER() OVER (
        PARTITION BY c.filter_id
        ORDER BY c.cycle ASC, (CASE WHEN c.last_sent_type IS NULL THEN 0 ELSE 1 END) ASC, c.primary_key
      ) AS rn_in_filter
    FROM claimed c
  ),
  capped_by_filter AS (
    SELECT *
    FROM ranked_in_filter
    WHERE rn_in_filter <= record_limit
  ),

  -- Step 9b: enforce maxPerDay with a fair-share + priority backfill pass.
  -- First take up to fair_share per filter (priority order); then fill remaining slots
  -- by priority (lowest prio_rank first) across whatever's left.
  first_pass AS (
    SELECT *
    FROM capped_by_filter
    WHERE rn_in_filter <= v_fair_share
  ),
  first_pass_count AS (
    SELECT COUNT(*) AS cnt FROM first_pass
  ),
  leftover AS (
    SELECT cb.*
    FROM capped_by_filter cb
    LEFT JOIN first_pass fp
      ON fp.filter_id = cb.filter_id AND fp.primary_key = cb.primary_key
    WHERE fp.primary_key IS NULL
  ),
  leftover_ranked AS (
    SELECT
      l.*,
      ROW_NUMBER() OVER (
        ORDER BY l.prio_rank ASC, l.cycle ASC, l.primary_key
      ) AS rn_overall
    FROM leftover l
  ),
  backfill AS (
    SELECT lr.*
    FROM leftover_ranked lr, first_pass_count fpc
    WHERE lr.rn_overall <= GREATEST(p_max_per_day - fpc.cnt, 0)
  ),
  final_set AS (
    SELECT * FROM first_pass
    UNION ALL
    SELECT
      filter_id, message_type, location_filter, last_sent_type_filter,
      record_limit, priority, prio_rank, once_per_mobile,
      primary_key, umr_number, patient_name, mobile_number, location,
      last_sent_type, last_sent_date, visit_date, default_discount_pct,
      mob10, cycle, rn_in_filter
    FROM backfill
  ),

  -- Final hard cap (safety) at p_max_per_day total, by priority
  final_capped AS (
    SELECT *
    FROM (
      SELECT
        f.*,
        ROW_NUMBER() OVER (ORDER BY f.prio_rank ASC, f.cycle ASC, f.primary_key) AS rn_global
      FROM final_set f
    ) t
    WHERE rn_global <= p_max_per_day
  )

  SELECT
    COUNT(*) FILTER (WHERE message_type = 'abc_card')::bigint            AS pending_abc,
    COUNT(*) FILTER (WHERE message_type = 'abnormal_card')::bigint       AS pending_abnormal,
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'Primary Key', primary_key,
          'UMR Number', umr_number,
          'Patient Name', patient_name,
          'Mobile Number', mobile_number,
          'Location', location,
          'Cycle', cycle
        )
      ) FILTER (WHERE message_type = 'abc_card'),
      '[]'::jsonb
    ) AS pending_abc_records,
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'Primary Key', primary_key,
          'UMR Number', umr_number,
          'Patient Name', patient_name,
          'Mobile Number', mobile_number,
          'Location', location,
          'Cycle', cycle
        )
      ) FILTER (WHERE message_type = 'abnormal_card'),
      '[]'::jsonb
    ) AS pending_abnormal_records
  FROM final_capped;
END;
$function$;