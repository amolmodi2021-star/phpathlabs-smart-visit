-- Partial bills: keep unfinished work visible in Results / Verification / Doctor Approval.
-- Fully finished tests stay out; registration status approved/dispatched alone must not
-- hide remaining tests (status can lag). Sample Collection / Acceptance stay tube-based.
-- Modified Approval and Dispatch unchanged.

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
  cancelled AS (
    SELECT
      pr.id AS registration_id,
      COALESCE(x.elem->>'test_id', x.elem->>'id') AS test_id
    FROM public.patient_registrations pr
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(pr.cancelled_tests, '[]'::jsonb)) AS x(elem)
  ),
  test_params AS (
    SELECT DISTINCT
      a.registration_id,
      a.test_id,
      tp.parameter_id
    FROM accepted a
    JOIN public.test_parameters tp
      ON tp.test_id::text = a.test_id
    WHERE COALESCE(tp.is_subheader, false) = false
      AND tp.parameter_id IS NOT NULL
  ),
  covered_params AS (
    SELECT DISTINCT
      pr.registration_id,
      pr.parameter_id
    FROM public.patient_results pr
    WHERE pr.status IN ('entered', 'results_entered', 'verified', 'approved', 'dispatched')
  ),
  tracked_snips AS (
    SELECT DISTINCT os.registration_id, os.test_id::text AS test_id
    FROM public.outsourced_test_snips os
    WHERE os.outsource_status IN ('entered', 'results_entered', 'verified', 'approved', 'dispatched')
  ),
  uncovered AS (
    SELECT DISTINCT tp.registration_id, tp.test_id
    FROM test_params tp
    LEFT JOIN covered_params cp
      ON cp.registration_id = tp.registration_id
     AND cp.parameter_id = tp.parameter_id
    LEFT JOIN tracked_snips ts
      ON ts.registration_id = tp.registration_id
     AND ts.test_id = tp.test_id
    WHERE ts.test_id IS NULL
      AND cp.parameter_id IS NULL
  ),
  accepted_no_params AS (
    SELECT DISTINCT a.registration_id, a.test_id
    FROM accepted a
    LEFT JOIN public.test_parameters tp
      ON tp.test_id::text = a.test_id
     AND COALESCE(tp.is_subheader, false) = false
     AND tp.parameter_id IS NOT NULL
    LEFT JOIN tracked_snips ts
      ON ts.registration_id = a.registration_id
     AND ts.test_id = a.test_id
    WHERE tp.parameter_id IS NULL
      AND ts.test_id IS NULL
  )
  SELECT COALESCE(array_agg(DISTINCT x.registration_id), ARRAY[]::uuid[])
  FROM (
    SELECT u.registration_id, u.test_id FROM uncovered u
    UNION
    SELECT a.registration_id, a.test_id FROM accepted_no_params a
  ) x
  JOIN public.patient_registrations preg ON preg.id = x.registration_id
  LEFT JOIN cancelled c
    ON c.registration_id = x.registration_id
   AND c.test_id = x.test_id
  WHERE c.test_id IS NULL
    AND x.test_id IS NOT NULL
    AND x.test_id <> ''
    AND COALESCE(preg.bill_cancelled, false) = false;
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