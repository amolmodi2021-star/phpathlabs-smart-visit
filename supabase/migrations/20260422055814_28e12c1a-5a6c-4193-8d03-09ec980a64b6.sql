-- Indexes to accelerate the preflight logic
CREATE INDEX IF NOT EXISTS idx_crm_contacts_mobile10
  ON public.crm_contacts ((RIGHT(REGEXP_REPLACE(COALESCE(mobile_number, ''), '\D', '', 'g'), 10)));

CREATE INDEX IF NOT EXISTS idx_drip_log_sent_filter_mobile
  ON public.drip_campaign_log (filter_id, mobile_number, contact_primary_key)
  WHERE status = 'sent';

CREATE INDEX IF NOT EXISTS idx_drip_log_sent_mobile_cycle
  ON public.drip_campaign_log (mobile_number, cycle_number)
  WHERE status = 'sent';

-- Drop legacy version if present from a prior failed attempt
DROP FUNCTION IF EXISTS public.get_drip_pending_summary(uuid[], boolean);

-- get_drip_pending_summary: literal port of AutomatedMarketing pendingCounts queryFn
-- Inputs:
--   p_filter_ids:      ordered list of enabled filter IDs, lowest priority first
--   p_exclude_blacklist: when true, drop contacts whose mobile is on crm_blacklist
-- Output: one row with totals + JSONB arrays matching the Excel export shape.
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
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_now timestamptz := now();
BEGIN
  RETURN QUERY
  WITH
  -- Filters in priority order, with their position so we can mimic the JS
  -- "lowest-priority-first" iteration.
  ordered_filters AS (
    SELECT
      f.id,
      f.message_type,
      f.priority,
      ROW_NUMBER() OVER (ORDER BY f.priority ASC, f.created_at ASC) AS rn
    FROM public.drip_campaign_filters f
    WHERE f.id = ANY(p_filter_ids) AND f.enabled = true
  ),
  -- Normalize contacts to last-10-digit mobile, drop blacklisted when requested.
  contacts_norm AS (
    SELECT
      c.primary_key,
      c.mobile_number,
      c.umr_number,
      c.patient_name,
      c.last_sent_type,
      c.last_sent_date,
      RIGHT(REGEXP_REPLACE(COALESCE(c.mobile_number, ''), '\D', '', 'g'), 10) AS mob10
    FROM public.crm_contacts c
    WHERE LENGTH(RIGHT(REGEXP_REPLACE(COALESCE(c.mobile_number, ''), '\D', '', 'g'), 10)) = 10
      AND (
        NOT p_exclude_blacklist
        OR NOT EXISTS (
          SELECT 1 FROM public.crm_blacklist b
          WHERE b.mobile_number = RIGHT(REGEXP_REPLACE(COALESCE(c.mobile_number, ''), '\D', '', 'g'), 10)
        )
      )
  ),
  abnormal_pks AS (
    SELECT DISTINCT contact_primary_key FROM public.crm_abnormal_tests
  ),
  mobile_cycles AS (
    SELECT mobile_number, current_cycle FROM public.drip_mobile_cycles
  ),
  -- Per-mobile cycle (default 1)
  mob_cycle AS (
    SELECT
      cn.mob10,
      COALESCE(mc.current_cycle, 1) AS cycle
    FROM (SELECT DISTINCT mob10 FROM contacts_norm) cn
    LEFT JOIN mobile_cycles mc ON mc.mobile_number = cn.mob10
  ),
  -- Sent set per (mobile, filter) limited to current cycle, mirroring JS guard.
  sent_logs AS (
    SELECT l.mobile_number AS mob10, l.filter_id, l.contact_primary_key
    FROM public.drip_campaign_log l
    JOIN mob_cycle mcy ON mcy.mob10 = l.mobile_number
    WHERE l.status = 'sent'
      AND COALESCE(l.cycle_number, 1) = mcy.cycle
      AND l.contact_primary_key IS NOT NULL
  ),
  -- Eligibility per (filter, contact). JS rules:
  --   abc_card    : umr_number not blank
  --   abnormal_card: contact appears in crm_abnormal_tests
  --   other       : every contact eligible
  eligibility AS (
    SELECT
      f.id AS filter_id,
      f.message_type,
      f.priority,
      f.rn,
      c.mob10,
      c.primary_key,
      c.umr_number,
      c.patient_name,
      c.mobile_number,
      c.last_sent_type,
      c.last_sent_date
    FROM ordered_filters f
    CROSS JOIN contacts_norm c
    WHERE
      (f.message_type = 'abc_card' AND c.umr_number IS NOT NULL AND btrim(c.umr_number) <> '')
      OR (f.message_type = 'abnormal_card' AND c.primary_key IN (SELECT contact_primary_key FROM abnormal_pks))
      OR (f.message_type NOT IN ('abc_card', 'abnormal_card'))
  ),
  -- Sent-PK set per (filter, mobile). For ABC, JS unions in CRM rows whose
  -- last_sent_type='ABC' AND have a UMR. We replicate that union.
  sent_pks AS (
    SELECT filter_id, mob10, primary_key FROM (
      SELECT
        e.filter_id,
        e.mob10,
        s.contact_primary_key AS primary_key
      FROM eligibility e
      JOIN sent_logs s ON s.filter_id = e.filter_id AND s.mob10 = e.mob10
      UNION
      SELECT
        e.filter_id,
        e.mob10,
        e.primary_key
      FROM eligibility e
      WHERE e.message_type = 'abc_card'
        AND e.last_sent_type = 'ABC'
        AND e.umr_number IS NOT NULL AND btrim(e.umr_number) <> ''
    ) u
  ),
  -- Counts per (filter, mobile)
  per_filter_mobile AS (
    SELECT
      e.filter_id,
      e.message_type,
      e.priority,
      e.rn,
      e.mob10,
      COUNT(*)::bigint AS eligible_cnt,
      COUNT(*) FILTER (WHERE sp.primary_key IS NOT NULL)::bigint AS sent_cnt
    FROM eligibility e
    LEFT JOIN sent_pks sp ON sp.filter_id = e.filter_id AND sp.mob10 = e.mob10 AND sp.primary_key = e.primary_key
    GROUP BY e.filter_id, e.message_type, e.priority, e.rn, e.mob10
  ),
  -- Mirror JS priority-lock: walk filters lowest-priority-first; the first
  -- filter where eligible>0 AND sent<eligible "owns" this mobile.
  locked_priority AS (
    SELECT mob10, MIN(rn) AS owner_rn
    FROM per_filter_mobile
    WHERE eligible_cnt > 0 AND sent_cnt < eligible_cnt
    GROUP BY mob10
  ),
  -- Resolve owning filter row
  owner_filter AS (
    SELECT lp.mob10, pfm.filter_id, pfm.message_type, pfm.priority
    FROM locked_priority lp
    JOIN per_filter_mobile pfm ON pfm.mob10 = lp.mob10 AND pfm.rn = lp.owner_rn
  ),
  -- Pending records: eligible contacts under the owning filter that are NOT in sent_pks
  pending_rows AS (
    SELECT
      e.message_type,
      e.mob10,
      e.primary_key,
      e.umr_number,
      e.patient_name,
      e.mobile_number,
      e.last_sent_type,
      e.last_sent_date,
      mcy.cycle
    FROM owner_filter of
    JOIN eligibility e ON e.filter_id = of.filter_id AND e.mob10 = of.mob10
    LEFT JOIN sent_pks sp ON sp.filter_id = e.filter_id AND sp.mob10 = e.mob10 AND sp.primary_key = e.primary_key
    JOIN mob_cycle mcy ON mcy.mob10 = e.mob10
    WHERE sp.primary_key IS NULL
  ),
  abc_rows AS (
    SELECT * FROM pending_rows WHERE message_type = 'abc_card'
  ),
  abn_rows AS (
    SELECT * FROM pending_rows WHERE message_type = 'abnormal_card'
  )
  SELECT
    (SELECT COUNT(*) FROM abc_rows)::bigint,
    (SELECT COUNT(*) FROM abn_rows)::bigint,
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
    )) FROM abc_rows), '[]'::jsonb),
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
    )) FROM abn_rows), '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_drip_pending_summary(uuid[], boolean) TO anon, authenticated, service_role;