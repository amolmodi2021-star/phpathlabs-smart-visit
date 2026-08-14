-- Dispatch list filters (lean date list + pending / all-approved / partially-approved).
-- Due-amount patients are included in all filters (payment only blocks dispatch actions).

CREATE OR REPLACE FUNCTION public.lims_reg_cancelled_test_ids(p_cancelled jsonb)
RETURNS uuid[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(array_agg(DISTINCT x.tid), ARRAY[]::uuid[])
  FROM (
    SELECT NULLIF(btrim(COALESCE(e->>'test_id', e->>'id', e#>>'{}')), '')::uuid AS tid
    FROM jsonb_array_elements(COALESCE(p_cancelled, '[]'::jsonb)) e
  ) x
  WHERE x.tid IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION public.lims_reg_active_test_ids(p_tests jsonb, p_cancelled jsonb)
RETURNS uuid[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(array_agg(DISTINCT x.tid), ARRAY[]::uuid[])
  FROM (
    SELECT NULLIF(btrim(e->>'test_id'), '')::uuid AS tid
    FROM jsonb_array_elements(COALESCE(p_tests, '[]'::jsonb)) e
  ) x
  WHERE x.tid IS NOT NULL
    AND NOT (x.tid = ANY (public.lims_reg_cancelled_test_ids(p_cancelled)));
$$;

CREATE OR REPLACE FUNCTION public.lims_reg_test_is_dispatched(p_reg_id uuid, p_test_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.patient_results r
    WHERE r.registration_id = p_reg_id AND r.test_id = p_test_id AND r.status = 'dispatched'
  )
  OR EXISTS (
    SELECT 1 FROM public.outsourced_test_snips s
    WHERE s.registration_id = p_reg_id AND s.test_id = p_test_id AND s.outsource_status = 'dispatched'
  );
$$;

CREATE OR REPLACE FUNCTION public.lims_reg_test_is_approved_ready(p_reg_id uuid, p_test_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT NOT public.lims_reg_test_is_dispatched(p_reg_id, p_test_id)
  AND (
    EXISTS (
      SELECT 1 FROM public.patient_results r
      WHERE r.registration_id = p_reg_id AND r.test_id = p_test_id AND r.status = 'approved'
    )
    OR EXISTS (
      SELECT 1 FROM public.outsourced_test_snips s
      WHERE s.registration_id = p_reg_id AND s.test_id = p_test_id AND s.outsource_status = 'approved'
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.lims_dispatch_filter_ids(
  p_mode text,
  p_search text DEFAULT NULL,
  p_date_from timestamptz DEFAULT NULL,
  p_date_to timestamptz DEFAULT NULL
)
RETURNS uuid[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mode text := lower(btrim(COALESCE(p_mode, 'all')));
BEGIN
  IF v_mode NOT IN ('all', 'pending_dispatch', 'all_approved', 'partially_approved') THEN
    v_mode := 'all';
  END IF;

  RETURN COALESCE(
    (
      SELECT array_agg(pr.id ORDER BY pr.is_stat DESC NULLS LAST, pr.invoice_number DESC)
      FROM public.patient_registrations pr
      WHERE COALESCE(pr.bill_cancelled, false) = false
        AND COALESCE(pr.status, '') IS DISTINCT FROM 'cancelled'
        AND (
          (p_search IS NOT NULL AND btrim(p_search) <> '')
          OR (
            (p_date_from IS NULL OR pr.created_at >= p_date_from)
            AND (p_date_to IS NULL OR pr.created_at <= p_date_to)
          )
        )
        AND (
          p_search IS NULL OR btrim(p_search) = '' OR
          pr.patient_name ILIKE '%' || btrim(p_search) || '%' OR
          pr.mobile_number ILIKE '%' || btrim(p_search) || '%' OR
          pr.invoice_number ILIKE '%' || btrim(p_search) || '%' OR
          pr.umr_number ILIKE '%' || btrim(p_search) || '%'
        )
        AND (
          v_mode = 'all'
          OR (
            v_mode = 'pending_dispatch'
            AND COALESCE(pr.status, '') IS DISTINCT FROM 'dispatched'
            AND cardinality(public.lims_reg_active_test_ids(pr.tests, pr.cancelled_tests)) > 0
            AND EXISTS (
              SELECT 1
              FROM unnest(public.lims_reg_active_test_ids(pr.tests, pr.cancelled_tests)) AS tid
              WHERE NOT public.lims_reg_test_is_dispatched(pr.id, tid)
            )
          )
          OR (
            v_mode = 'all_approved'
            AND COALESCE(pr.status, '') IS DISTINCT FROM 'dispatched'
            AND cardinality(public.lims_reg_active_test_ids(pr.tests, pr.cancelled_tests)) > 0
            AND NOT EXISTS (
              SELECT 1
              FROM unnest(public.lims_reg_active_test_ids(pr.tests, pr.cancelled_tests)) AS tid
              WHERE NOT public.lims_reg_test_is_approved_ready(pr.id, tid)
            )
          )
          OR (
            v_mode = 'partially_approved'
            AND COALESCE(pr.status, '') IS DISTINCT FROM 'dispatched'
            AND EXISTS (
              SELECT 1
              FROM unnest(public.lims_reg_active_test_ids(pr.tests, pr.cancelled_tests)) AS tid
              WHERE public.lims_reg_test_is_approved_ready(pr.id, tid)
            )
            AND EXISTS (
              SELECT 1
              FROM unnest(public.lims_reg_active_test_ids(pr.tests, pr.cancelled_tests)) AS tid
              WHERE NOT public.lims_reg_test_is_approved_ready(pr.id, tid)
                AND NOT public.lims_reg_test_is_dispatched(pr.id, tid)
            )
          )
        )
    ),
    ARRAY[]::uuid[]
  );
END;
$$;

-- Keep old pending RPC name working (maps to new pending_dispatch mode).
CREATE OR REPLACE FUNCTION public.lims_dispatch_pending_dispatch_ids(
  p_search text DEFAULT NULL,
  p_date_from timestamptz DEFAULT NULL,
  p_date_to timestamptz DEFAULT NULL,
  p_include_older boolean DEFAULT false
)
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.lims_dispatch_filter_ids(
    'pending_dispatch',
    p_search,
    CASE WHEN p_include_older OR (p_search IS NOT NULL AND btrim(p_search) <> '') THEN NULL ELSE p_date_from END,
    p_date_to
  );
$$;

REVOKE ALL ON FUNCTION public.lims_reg_cancelled_test_ids(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.lims_reg_active_test_ids(jsonb, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.lims_reg_test_is_dispatched(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.lims_reg_test_is_approved_ready(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.lims_dispatch_filter_ids(text, text, timestamptz, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.lims_dispatch_pending_dispatch_ids(text, timestamptz, timestamptz, boolean) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.lims_reg_cancelled_test_ids(jsonb) TO authenticated, service_role, anon;
GRANT EXECUTE ON FUNCTION public.lims_reg_active_test_ids(jsonb, jsonb) TO authenticated, service_role, anon;
GRANT EXECUTE ON FUNCTION public.lims_reg_test_is_dispatched(uuid, uuid) TO authenticated, service_role, anon;
GRANT EXECUTE ON FUNCTION public.lims_reg_test_is_approved_ready(uuid, uuid) TO authenticated, service_role, anon;
GRANT EXECUTE ON FUNCTION public.lims_dispatch_filter_ids(text, text, timestamptz, timestamptz) TO authenticated, service_role, anon;
GRANT EXECUTE ON FUNCTION public.lims_dispatch_pending_dispatch_ids(text, timestamptz, timestamptz, boolean) TO authenticated, service_role, anon;