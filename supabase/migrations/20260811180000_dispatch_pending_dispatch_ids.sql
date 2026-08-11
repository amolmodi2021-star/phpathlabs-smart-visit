-- Pending Dispatch queue: regs with at least one approved (not yet dispatched) report.
-- Used by Dispatch "Pending Dispatch" filter for old backlog outside the current day.
CREATE OR REPLACE FUNCTION public.lims_dispatch_pending_dispatch_ids(
  p_search text DEFAULT NULL,
  p_before timestamptz DEFAULT NULL
)
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    array_agg(pr.id ORDER BY pr.is_stat DESC NULLS LAST, pr.invoice_number DESC),
    ARRAY[]::uuid[]
  )
  FROM public.patient_registrations pr
  WHERE COALESCE(pr.bill_cancelled, false) = false
    AND COALESCE(pr.status, '') IS DISTINCT FROM 'cancelled'
    AND (p_before IS NULL OR pr.created_at < p_before)
    AND (
      EXISTS (
        SELECT 1
        FROM public.patient_results r
        WHERE r.registration_id = pr.id
          AND r.status = 'approved'
      )
      OR EXISTS (
        SELECT 1
        FROM public.outsourced_test_snips s
        WHERE s.registration_id = pr.id
          AND s.outsource_status = 'approved'
      )
    )
    AND (
      p_search IS NULL OR btrim(p_search) = '' OR
      pr.patient_name ILIKE '%' || btrim(p_search) || '%' OR
      pr.mobile_number ILIKE '%' || btrim(p_search) || '%' OR
      pr.invoice_number ILIKE '%' || btrim(p_search) || '%' OR
      pr.umr_number ILIKE '%' || btrim(p_search) || '%'
    );
$$;

REVOKE ALL ON FUNCTION public.lims_dispatch_pending_dispatch_ids(text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lims_dispatch_pending_dispatch_ids(text, timestamptz) TO authenticated, service_role, anon;
