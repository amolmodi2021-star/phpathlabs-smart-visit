-- Keep CBC cases out of Result Verification while they wait in Dr. CBC

CREATE OR REPLACE FUNCTION public.lims_verification_candidate_ids()
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(array_agg(DISTINCT registration_id), ARRAY[]::uuid[])
  FROM (
    SELECT pr.registration_id
    FROM public.patient_results pr
    WHERE pr.status IN ('entered', 'results_entered')
      AND EXISTS (
        SELECT 1
        FROM public.test_parameters tp
        WHERE tp.test_id = pr.test_id
          AND tp.parameter_id = pr.parameter_id
          AND COALESCE(tp.is_subheader, false) = false
      )
      AND EXISTS (
        SELECT 1
        FROM public.patient_registrations preg
        WHERE preg.id = pr.registration_id
          AND COALESCE(preg.bill_cancelled, false) = false
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.patient_results done
        WHERE done.registration_id = pr.registration_id
          AND done.test_id = pr.test_id
          AND done.parameter_id IS NOT DISTINCT FROM pr.parameter_id
          AND done.status IN ('approved', 'dispatched')
      )
      -- CBC sent to Dr. CBC must not also sit in Result Verification
      AND NOT EXISTS (
        SELECT 1
        FROM public.cbc_smear_reviews r
        WHERE r.registration_id = pr.registration_id
          AND r.test_id = pr.test_id
          AND r.status IN ('sent_to_doctor', 'doctor_saved')
      )
    UNION
    SELECT os.registration_id
    FROM public.outsourced_test_snips os
    WHERE os.outsource_status IN ('results_entered', 'entered')
      AND EXISTS (
        SELECT 1
        FROM public.patient_registrations preg
        WHERE preg.id = os.registration_id
          AND COALESCE(preg.bill_cancelled, false) = false
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.patient_results pr
        WHERE pr.registration_id = os.registration_id
          AND pr.test_id = os.test_id
          AND pr.status IN ('verified', 'approved', 'dispatched')
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.outsourced_test_snips done
        WHERE done.registration_id = os.registration_id
          AND done.test_id = os.test_id
          AND done.outsource_status IN ('approved', 'dispatched')
      )
  ) s
  WHERE registration_id IS NOT NULL;
$$;

GRANT EXECUTE ON FUNCTION public.lims_verification_candidate_ids() TO authenticated, service_role;