-- Dispatch as status board: all regs in date/search range (including cancelled bills).
CREATE OR REPLACE FUNCTION public.lims_dispatch_status_ids(
  p_search text DEFAULT NULL,
  p_date_from timestamptz DEFAULT NULL,
  p_date_to timestamptz DEFAULT NULL
)
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    array_agg(id ORDER BY is_stat DESC NULLS LAST, invoice_number DESC),
    ARRAY[]::uuid[]
  )
  FROM public.patient_registrations
  WHERE (p_date_from IS NULL OR created_at >= p_date_from)
    AND (p_date_to IS NULL OR created_at <= p_date_to)
    AND (
      p_search IS NULL OR btrim(p_search) = '' OR
      patient_name ILIKE '%' || btrim(p_search) || '%' OR
      mobile_number ILIKE '%' || btrim(p_search) || '%' OR
      invoice_number ILIKE '%' || btrim(p_search) || '%' OR
      umr_number ILIKE '%' || btrim(p_search) || '%'
    );
$$;

REVOKE ALL ON FUNCTION public.lims_dispatch_status_ids(text, timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lims_dispatch_status_ids(text, timestamptz, timestamptz) TO authenticated, service_role, anon;

