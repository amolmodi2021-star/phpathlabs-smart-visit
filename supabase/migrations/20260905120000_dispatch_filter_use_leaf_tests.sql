-- Fix Dispatch All Approved / Partially Approved filters for package/profile bills.
-- patient_registrations.tests stores container IDs (package/combo/profile), while
-- patient_results / snips / tubes use leaf test IDs. Checking approval on the
-- container ID always failed, so All Approved returned empty.

CREATE OR REPLACE FUNCTION public.lims_reg_dispatch_leaf_test_ids(p_reg_id uuid)
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH cancelled AS (
    SELECT DISTINCT x.tid
    FROM (
      SELECT NULLIF(BTRIM(COALESCE(e->>'test_id', e->>'id', e#>>'{}')), '')::uuid AS tid
      FROM public.patient_registrations pr
      CROSS JOIN LATERAL jsonb_array_elements(COALESCE(pr.cancelled_tests, '[]'::jsonb)) e
      WHERE pr.id = p_reg_id
    ) x
    WHERE x.tid IS NOT NULL
  ),
  leafs AS (
    SELECT DISTINCT NULLIF(BTRIM(tid_txt), '')::uuid AS tid
    FROM public.sample_tubes st
    CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(st.test_ids, '[]'::jsonb)) AS tid_txt
    WHERE st.registration_id = p_reg_id
      AND NULLIF(BTRIM(tid_txt), '') IS NOT NULL

    UNION

    SELECT DISTINCT pr.test_id
    FROM public.patient_results pr
    WHERE pr.registration_id = p_reg_id
      AND pr.test_id IS NOT NULL

    UNION

    SELECT DISTINCT s.test_id
    FROM public.outsourced_test_snips s
    WHERE s.registration_id = p_reg_id
      AND s.test_id IS NOT NULL
  )
  SELECT COALESCE(array_agg(DISTINCT l.tid), ARRAY[]::uuid[])
  FROM leafs l
  WHERE l.tid IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM cancelled c WHERE c.tid = l.tid);
$$;

REVOKE ALL ON FUNCTION public.lims_reg_dispatch_leaf_test_ids(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lims_reg_dispatch_leaf_test_ids(uuid) TO authenticated, service_role, anon;

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
      WHERE (
          v_mode = 'all'
          OR (
            COALESCE(pr.bill_cancelled, false) = false
            AND COALESCE(pr.status, '') IS DISTINCT FROM 'cancelled'
          )
        )
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
            AND cardinality(public.lims_reg_dispatch_leaf_test_ids(pr.id)) > 0
            AND EXISTS (
              SELECT 1
              FROM unnest(public.lims_reg_dispatch_leaf_test_ids(pr.id)) AS tid
              WHERE NOT public.lims_reg_test_is_dispatched(pr.id, tid)
            )
          )
          OR (
            v_mode = 'all_approved'
            AND COALESCE(pr.status, '') IS DISTINCT FROM 'dispatched'
            AND cardinality(public.lims_reg_dispatch_leaf_test_ids(pr.id)) > 0
            AND EXISTS (
              SELECT 1
              FROM unnest(public.lims_reg_dispatch_leaf_test_ids(pr.id)) AS tid
              WHERE public.lims_reg_test_is_approved_ready(pr.id, tid)
            )
            AND NOT EXISTS (
              SELECT 1
              FROM unnest(public.lims_reg_dispatch_leaf_test_ids(pr.id)) AS tid
              WHERE NOT public.lims_reg_test_is_approved_ready(pr.id, tid)
                AND NOT public.lims_reg_test_is_dispatched(pr.id, tid)
            )
          )
          OR (
            v_mode = 'partially_approved'
            AND COALESCE(pr.status, '') IS DISTINCT FROM 'dispatched'
            AND EXISTS (
              SELECT 1
              FROM unnest(public.lims_reg_dispatch_leaf_test_ids(pr.id)) AS tid
              WHERE public.lims_reg_test_is_approved_ready(pr.id, tid)
            )
            AND EXISTS (
              SELECT 1
              FROM unnest(public.lims_reg_dispatch_leaf_test_ids(pr.id)) AS tid
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

COMMENT ON FUNCTION public.lims_dispatch_filter_ids(text, text, timestamptz, timestamptz) IS
  'Dispatch list filters using leaf test IDs (tubes/results/snips), not package container IDs.';