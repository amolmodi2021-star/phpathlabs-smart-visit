-- Fully approved / dispatched registrations must not appear in Results Entry,
-- Result Verification, or Doctor Approval. (Modified Approval and Dispatch unchanged.)

CREATE OR REPLACE FUNCTION public.lims_results_entry_candidate_ids()
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH accepted AS (
    SELECT
      st.registration_id,
      jsonb_array_elements_text(COALESCE(st.test_ids, '[]'::jsonb)) AS test_id
    FROM public.sample_tubes st
    WHERE st.status = 'accepted'
  ),
  tracked AS (
    SELECT DISTINCT pr.registration_id, pr.test_id::text AS test_id
    FROM public.patient_results pr
    WHERE pr.status IN ('entered', 'results_entered', 'verified', 'approved', 'dispatched')
      AND EXISTS (
        SELECT 1
        FROM public.test_parameters tp
        WHERE tp.test_id = pr.test_id
          AND tp.parameter_id = pr.parameter_id
          AND COALESCE(tp.is_subheader, false) = false
      )
    UNION
    SELECT DISTINCT os.registration_id, os.test_id::text AS test_id
    FROM public.outsourced_test_snips os
    WHERE os.outsource_status IN ('entered', 'results_entered', 'verified', 'approved', 'dispatched')
  )
  SELECT COALESCE(array_agg(DISTINCT a.registration_id), ARRAY[]::uuid[])
  FROM accepted a
  JOIN public.patient_registrations preg ON preg.id = a.registration_id
  LEFT JOIN tracked t
    ON t.registration_id = a.registration_id
   AND t.test_id = a.test_id
  WHERE a.test_id IS NOT NULL
    AND a.test_id <> ''
    AND t.test_id IS NULL
    AND COALESCE(preg.bill_cancelled, false) = false
    AND COALESCE(preg.status, '') NOT IN ('approved', 'dispatched');
$$;

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
      AND NOT EXISTS (
        SELECT 1
        FROM public.patient_results done
        WHERE done.registration_id = pr.registration_id
          AND done.test_id = pr.test_id
          AND done.parameter_id IS NOT DISTINCT FROM pr.parameter_id
          AND done.status IN ('approved', 'dispatched')
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
      AND NOT EXISTS (
        SELECT 1
        FROM public.patient_results done
        WHERE done.registration_id = pr.registration_id
          AND done.test_id = pr.test_id
          AND done.parameter_id IS NOT DISTINCT FROM pr.parameter_id
          AND done.status IN ('approved', 'dispatched')
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

REVOKE ALL ON FUNCTION public.lims_results_entry_candidate_ids() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.lims_verification_candidate_ids() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.lims_doctor_approval_candidate_ids() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lims_results_entry_candidate_ids() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.lims_verification_candidate_ids() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.lims_doctor_approval_candidate_ids() TO authenticated, service_role;