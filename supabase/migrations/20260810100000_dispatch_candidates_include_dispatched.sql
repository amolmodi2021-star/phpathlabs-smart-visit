-- Keep recently dispatched registrations on the Dispatch screen so staff can resend reports.
CREATE OR REPLACE FUNCTION public.lims_dispatch_candidate_ids()
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(array_agg(DISTINCT registration_id), ARRAY[]::uuid[])
  FROM (
    SELECT registration_id
    FROM public.patient_results
    WHERE status IN ('approved', 'dispatched')
    UNION
    SELECT registration_id
    FROM public.outsourced_test_snips
    WHERE outsource_status IN ('approved', 'dispatched')
  ) s
  WHERE registration_id IS NOT NULL;
$$;
