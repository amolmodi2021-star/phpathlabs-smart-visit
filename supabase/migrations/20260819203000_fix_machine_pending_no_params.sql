-- Fix Machine Wise false positives: accepted_no_params must mean
-- "zero enterable params on this machine test", not "has a calculated param row".
-- Previous LEFT JOIN … AND is_calculated=false made rtp.id NULL on calculated
-- rows, so fully entered CBC (with calculated params) still matched.

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
    WHERE os.outsource_status IN (
      'entered', 'results_entered', 'results_saved', 'verified', 'approved', 'dispatched'
    )
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
  -- Only machine tests with NO enterable (non-calc) parameters configured
  accepted_no_params AS (
    SELECT DISTINCT a.registration_id, a.test_id
    FROM accepted_machine a
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.test_parameters tp
      JOIN public.report_test_parameters rtp ON rtp.id = tp.parameter_id
      WHERE tp.test_id::text = a.test_id
        AND COALESCE(tp.is_subheader, false) = false
        AND COALESCE(rtp.is_calculated, false) = false
        AND tp.parameter_id IS NOT NULL
    )
    AND NOT EXISTS (
      SELECT 1
      FROM tracked_snips ts
      WHERE ts.registration_id = a.registration_id
        AND ts.test_id = a.test_id
    )
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

COMMENT ON FUNCTION public.lims_results_entry_machine_candidate_ids(text) IS
  'Results Machine Wise: regs with pending enterable params for instrument (empty = Others).';
