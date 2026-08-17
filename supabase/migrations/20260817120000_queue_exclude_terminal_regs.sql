-- Keep Verification / Doctor Approval queues free of fully finished bills.
-- Example: 2608160010 was dispatched but could linger in Result Verification via
-- stale UI or leftover entered/snip rows while registration.status is terminal.

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
    WHERE pr.status = 'entered'
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
          AND COALESCE(preg.status, '') NOT IN ('approved', 'dispatched')
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
          AND COALESCE(preg.status, '') NOT IN ('approved', 'dispatched')
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.patient_results pr
        WHERE pr.registration_id = os.registration_id
          AND pr.test_id = os.test_id
          AND pr.status IN ('verified', 'approved', 'dispatched')
      )
  ) s
  WHERE registration_id IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION public.lims_doctor_approval_candidate_ids()
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
    WHERE pr.status = 'verified'
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
          AND COALESCE(preg.status, '') NOT IN ('approved', 'dispatched')
      )
    UNION
    SELECT os.registration_id
    FROM public.outsourced_test_snips os
    WHERE os.outsource_status = 'verified'
      AND EXISTS (
        SELECT 1
        FROM public.patient_registrations preg
        WHERE preg.id = os.registration_id
          AND COALESCE(preg.bill_cancelled, false) = false
          AND COALESCE(preg.status, '') NOT IN ('approved', 'dispatched')
      )
  ) s
  WHERE registration_id IS NOT NULL;
$$;

REVOKE ALL ON FUNCTION public.lims_verification_candidate_ids() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.lims_doctor_approval_candidate_ids() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lims_verification_candidate_ids() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.lims_doctor_approval_candidate_ids() TO authenticated, service_role;