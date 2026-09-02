-- CBC Send to Doctor / Dr. CBC workflow

ALTER TABLE public.cbc_smear_reviews
  DROP CONSTRAINT IF EXISTS cbc_smear_reviews_status_check;

ALTER TABLE public.cbc_smear_reviews
  ADD CONSTRAINT cbc_smear_reviews_status_check
  CHECK (status IN (
    'draft',
    'interpreted',
    'approved',
    'discarded',
    'sent_to_doctor',
    'doctor_saved'
  ));

ALTER TABLE public.cbc_smear_reviews
  ADD COLUMN IF NOT EXISTS sent_to_doctor_at timestamptz,
  ADD COLUMN IF NOT EXISTS sent_to_doctor_by text,
  ADD COLUMN IF NOT EXISTS doctor_saved_at timestamptz,
  ADD COLUMN IF NOT EXISTS doctor_saved_by text;

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
        AND r.status IN ('sent_to_doctor', 'doctor_saved')
    );
$$;

CREATE OR REPLACE FUNCTION public.lims_cbc_dr_candidate_ids()
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(array_agg(DISTINCT r.registration_id), '{}'::uuid[])
  FROM public.cbc_smear_reviews r
  WHERE r.status = 'sent_to_doctor';
$$;

GRANT EXECUTE ON FUNCTION public.lims_cbc_verification_candidate_ids() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.lims_cbc_dr_candidate_ids() TO anon, authenticated, service_role;