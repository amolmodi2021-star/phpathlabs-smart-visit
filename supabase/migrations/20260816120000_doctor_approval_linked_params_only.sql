-- Doctor Approval / Verification / Results queues must ignore orphan patient_results
-- rows whose parameter_id is not on the test current parameter list.
-- Example: invoice 2608140022 had verified Sample Type not linked to the test,
-- which stranded the bill in Doctor Approval with no Approve button while real params
-- (Chlamydia / Gonorrhoea) were still pending with empty values.

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
    UNION
    SELECT registration_id
    FROM public.outsourced_test_snips
    WHERE outsource_status = 'verified'
  ) s
  WHERE registration_id IS NOT NULL;
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
    UNION
    SELECT registration_id
    FROM public.outsourced_test_snips
    WHERE outsource_status IN ('results_entered', 'entered')
  ) s
  WHERE registration_id IS NOT NULL;
$$;

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
  LEFT JOIN tracked t
    ON t.registration_id = a.registration_id
   AND t.test_id = a.test_id
  WHERE a.test_id IS NOT NULL
    AND a.test_id <> ''
    AND t.test_id IS NULL;
$$;

REVOKE ALL ON FUNCTION public.lims_verification_candidate_ids() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.lims_doctor_approval_candidate_ids() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.lims_results_entry_candidate_ids() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.lims_verification_candidate_ids() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.lims_doctor_approval_candidate_ids() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.lims_results_entry_candidate_ids() TO authenticated, service_role;