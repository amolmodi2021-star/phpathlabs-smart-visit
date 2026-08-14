-- Align "all" mode with former status board: include cancelled bills in date list.
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