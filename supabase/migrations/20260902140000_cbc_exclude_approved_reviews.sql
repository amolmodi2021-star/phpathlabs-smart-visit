-- CBC tech queue: also leave after Approve-to-Verification (status approved)

CREATE OR REPLACE FUNCTION public.lims_cbc_verification_candidate_ids()
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(array_agg(DISTINCT pr.registration_id), '{}'::uuid[])
  FROM public.patient_results pr
  JOIN public.tests t ON t.id = pr.test_id
  WHERE pr.status IN ('entered', 'results_entered')
    AND (
      lower(COALESCE(t.test_name, '')) LIKE '%cbc%'
      OR lower(COALESCE(t.test_name, '')) LIKE '%complete blood count%'
      OR t.test_code IN ('TST0068', 'TST0069')
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.cbc_smear_reviews r
      WHERE r.registration_id = pr.registration_id
        AND r.test_id = pr.test_id
        AND r.status IN ('approved', 'sent_to_doctor', 'doctor_saved')
    );
$$;

GRANT EXECUTE ON FUNCTION public.lims_cbc_verification_candidate_ids() TO anon, authenticated, service_role;