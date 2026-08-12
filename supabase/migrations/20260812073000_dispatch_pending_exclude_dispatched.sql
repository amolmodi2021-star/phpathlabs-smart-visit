-- Pending Dispatch: exclude fully dispatched registrations (status = dispatched).
-- Still requires >=1 approved (not yet dispatched) result/snip in the date window.
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
  SELECT COALESCE(
    array_agg(pr.id ORDER BY pr.is_stat DESC NULLS LAST, pr.invoice_number DESC),
    ARRAY[]::uuid[]
  )
  FROM public.patient_registrations pr
  WHERE COALESCE(pr.bill_cancelled, false) = false
    AND COALESCE(pr.status, '') IS DISTINCT FROM 'cancelled'
    AND COALESCE(pr.status, '') IS DISTINCT FROM 'dispatched'
    AND (
      CASE
        WHEN p_include_older THEN
          (p_date_to IS NULL OR pr.created_at <= p_date_to)
        ELSE
          (p_date_from IS NULL OR pr.created_at >= p_date_from)
          AND (p_date_to IS NULL OR pr.created_at <= p_date_to)
      END
    )
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

REVOKE ALL ON FUNCTION public.lims_dispatch_pending_dispatch_ids(text, timestamptz, timestamptz, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lims_dispatch_pending_dispatch_ids(text, timestamptz, timestamptz, boolean) TO authenticated, service_role, anon;
