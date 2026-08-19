-- Machine Wise Results: only registrations with pending (uncovered) params
-- for tests whose instrument_name matches p_instrument.
-- p_instrument NULL/'' = "Others" (blank/null instrument).
-- Mirrors lims_results_entry_candidate_ids, scoped to one machine.
-- is_calculated lives on report_test_parameters (joined via parameter_id).

CREATE OR REPLACE FUNCTION public.lims_results_entry_machine_candidate_ids(p_instrument text DEFAULT NULL)
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH machine_tests AS (
    SELECT t.id::text AS test_id
    FROM public.tests t
    WHERE CASE
      WHEN NULLIF(trim(COALESCE(p_instrument, '')), '') IS NULL THEN
        NULLIF(trim(COALESCE(t.instrument_name, '')), '') IS NULL
      ELSE
        trim(COALESCE(t.instrument_name, '')) = trim(p_instrument)
    END
  ),
  accepted AS (
    SELECT
      st.registration_id,
      jsonb_array_elements_text(COALESCE(st.test_ids, '[]'::jsonb)) AS test_id
    FROM public.sample_tubes st
    WHERE st.status = 'accepted'
  ),
  accepted_machine AS (
    SELECT a.registration_id, a.test_id
    FROM accepted a
    JOIN machine_tests mt ON mt.test_id = a.test_id
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
    FROM accepted_machine a
    JOIN public.test_parameters tp
      ON tp.test_id::text = a.test_id
    JOIN public.report_test_parameters rtp
      ON rtp.id = tp.parameter_id
    WHERE COALESCE(tp.is_subheader, false) = false
      AND COALESCE(rtp.is_calculated, false) = false
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
    FROM accepted_machine a
    LEFT JOIN public.test_parameters tp
      ON tp.test_id::text = a.test_id
     AND COALESCE(tp.is_subheader, false) = false
     AND tp.parameter_id IS NOT NULL
    LEFT JOIN public.report_test_parameters rtp
      ON rtp.id = tp.parameter_id
     AND COALESCE(rtp.is_calculated, false) = false
    LEFT JOIN tracked_snips ts
      ON ts.registration_id = a.registration_id
     AND ts.test_id = a.test_id
    WHERE rtp.id IS NULL
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

REVOKE ALL ON FUNCTION public.lims_results_entry_machine_candidate_ids(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lims_results_entry_machine_candidate_ids(text) TO authenticated, service_role;

COMMENT ON FUNCTION public.lims_results_entry_machine_candidate_ids(text) IS
  'Results Machine Wise: registration IDs with pending enterable params for the given instrument_name (empty = Others).';
