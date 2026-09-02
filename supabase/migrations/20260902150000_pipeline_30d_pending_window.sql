-- 30-day pending window for Results / Verification / Doctor Approval queues.
-- p_include_older=true (UI "Show older pending") removes the window.
-- Recent activity still shows even on old registrations (accepted_at / entered_at / verified_at).

CREATE OR REPLACE FUNCTION public.lims_queue_cutoff_30d()
RETURNS timestamptz
LANGUAGE sql
STABLE
AS $$
  SELECT timezone('utc', now()) - interval '30 days';
$$;

-- ─── Results Entry ─────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.lims_results_entry_candidate_ids();
CREATE OR REPLACE FUNCTION public.lims_results_entry_candidate_ids(
  p_include_older boolean DEFAULT false
)
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH accepted AS (
    SELECT
      st.registration_id,
      jsonb_array_elements_text(COALESCE(st.test_ids, '[]'::jsonb)) AS test_id,
      st.accepted_at,
      st.created_at AS tube_created_at
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
      tp.parameter_id,
      a.accepted_at,
      a.tube_created_at
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
    SELECT DISTINCT tp.registration_id, tp.test_id, tp.accepted_at, tp.tube_created_at
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
    SELECT DISTINCT a.registration_id, a.test_id, a.accepted_at, a.tube_created_at
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
    SELECT u.registration_id, u.test_id, u.accepted_at, u.tube_created_at FROM uncovered u
    UNION
    SELECT a.registration_id, a.test_id, a.accepted_at, a.tube_created_at FROM accepted_no_params a
  ) x
  JOIN public.patient_registrations preg ON preg.id = x.registration_id
  LEFT JOIN cancelled c
    ON c.registration_id = x.registration_id
   AND c.test_id = x.test_id
  WHERE c.test_id IS NULL
    AND x.test_id IS NOT NULL
    AND x.test_id <> ''
    AND COALESCE(preg.bill_cancelled, false) = false
    AND (
      p_include_older
      OR preg.created_at >= public.lims_queue_cutoff_30d()
      OR COALESCE(x.accepted_at, x.tube_created_at) >= public.lims_queue_cutoff_30d()
    );
$$;

-- ─── Results Machine Wise ──────────────────────────────────────
DROP FUNCTION IF EXISTS public.lims_results_entry_machine_candidate_ids(text);
CREATE OR REPLACE FUNCTION public.lims_results_entry_machine_candidate_ids(
  p_instrument text DEFAULT NULL,
  p_include_older boolean DEFAULT false
)
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
      jsonb_array_elements_text(COALESCE(st.test_ids, '[]'::jsonb)) AS test_id,
      st.accepted_at,
      st.created_at AS tube_created_at
    FROM public.sample_tubes st
    WHERE st.status = 'accepted'
  ),
  accepted_machine AS (
    SELECT a.registration_id, a.test_id, a.accepted_at, a.tube_created_at
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
      tp.parameter_id,
      a.accepted_at,
      a.tube_created_at
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
    SELECT DISTINCT tp.registration_id, tp.test_id, tp.accepted_at, tp.tube_created_at
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
    SELECT DISTINCT a.registration_id, a.test_id, a.accepted_at, a.tube_created_at
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
    SELECT u.registration_id, u.test_id, u.accepted_at, u.tube_created_at FROM uncovered u
    UNION
    SELECT a.registration_id, a.test_id, a.accepted_at, a.tube_created_at FROM accepted_no_params a
  ) x
  JOIN public.patient_registrations preg ON preg.id = x.registration_id
  LEFT JOIN cancelled c
    ON c.registration_id = x.registration_id
   AND c.test_id = x.test_id
  WHERE c.test_id IS NULL
    AND x.test_id IS NOT NULL
    AND x.test_id <> ''
    AND COALESCE(preg.bill_cancelled, false) = false
    AND (
      p_include_older
      OR preg.created_at >= public.lims_queue_cutoff_30d()
      OR COALESCE(x.accepted_at, x.tube_created_at) >= public.lims_queue_cutoff_30d()
    );
$$;

-- ─── Verification (keep Dr. CBC exclusion + results_entered) ───
DROP FUNCTION IF EXISTS public.lims_verification_candidate_ids();
CREATE OR REPLACE FUNCTION public.lims_verification_candidate_ids(
  p_include_older boolean DEFAULT false
)
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
    JOIN public.patient_registrations preg ON preg.id = pr.registration_id
    WHERE pr.status IN ('entered', 'results_entered')
      AND COALESCE(preg.bill_cancelled, false) = false
      AND EXISTS (
        SELECT 1
        FROM public.test_parameters tp
        WHERE tp.test_id = pr.test_id
          AND tp.parameter_id = pr.parameter_id
          AND COALESCE(tp.is_subheader, false) = false
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.patient_results done
        WHERE done.registration_id = pr.registration_id
          AND done.test_id = pr.test_id
          AND done.parameter_id IS NOT DISTINCT FROM pr.parameter_id
          AND done.status IN ('approved', 'dispatched')
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.cbc_smear_reviews r
        WHERE r.registration_id = pr.registration_id
          AND r.test_id = pr.test_id
          AND r.status IN ('sent_to_doctor', 'doctor_saved')
      )
      AND (
        p_include_older
        OR preg.created_at >= public.lims_queue_cutoff_30d()
        OR COALESCE(pr.entered_at, pr.updated_at, pr.created_at) >= public.lims_queue_cutoff_30d()
      )
    UNION
    SELECT os.registration_id
    FROM public.outsourced_test_snips os
    JOIN public.patient_registrations preg ON preg.id = os.registration_id
    WHERE os.outsource_status IN ('results_entered', 'entered')
      AND COALESCE(preg.bill_cancelled, false) = false
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
      AND (
        p_include_older
        OR preg.created_at >= public.lims_queue_cutoff_30d()
        OR COALESCE(os.entered_at, os.updated_at, os.sent_at) >= public.lims_queue_cutoff_30d()
      )
  ) s
  WHERE registration_id IS NOT NULL;
$$;

-- ─── Doctor Approval ───────────────────────────────────────────
DROP FUNCTION IF EXISTS public.lims_doctor_approval_candidate_ids();
CREATE OR REPLACE FUNCTION public.lims_doctor_approval_candidate_ids(
  p_include_older boolean DEFAULT false
)
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
    JOIN public.patient_registrations preg ON preg.id = pr.registration_id
    WHERE pr.status = 'verified'
      AND COALESCE(preg.bill_cancelled, false) = false
      AND EXISTS (
        SELECT 1
        FROM public.test_parameters tp
        WHERE tp.test_id = pr.test_id
          AND tp.parameter_id = pr.parameter_id
          AND COALESCE(tp.is_subheader, false) = false
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.patient_results done
        WHERE done.registration_id = pr.registration_id
          AND done.test_id = pr.test_id
          AND done.parameter_id IS NOT DISTINCT FROM pr.parameter_id
          AND done.status IN ('approved', 'dispatched')
      )
      AND (
        p_include_older
        OR preg.created_at >= public.lims_queue_cutoff_30d()
        OR COALESCE(pr.verified_at, pr.updated_at, pr.entered_at, pr.created_at) >= public.lims_queue_cutoff_30d()
      )
    UNION
    SELECT os.registration_id
    FROM public.outsourced_test_snips os
    JOIN public.patient_registrations preg ON preg.id = os.registration_id
    WHERE os.outsource_status = 'verified'
      AND COALESCE(preg.bill_cancelled, false) = false
      AND NOT EXISTS (
        SELECT 1
        FROM public.outsourced_test_snips done
        WHERE done.registration_id = os.registration_id
          AND done.test_id = os.test_id
          AND done.outsource_status IN ('approved', 'dispatched')
      )
      AND (
        p_include_older
        OR preg.created_at >= public.lims_queue_cutoff_30d()
        OR COALESCE(os.verified_at, os.updated_at, os.entered_at) >= public.lims_queue_cutoff_30d()
      )
  ) s
  WHERE registration_id IS NOT NULL;
$$;

GRANT EXECUTE ON FUNCTION public.lims_results_entry_candidate_ids(boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.lims_results_entry_machine_candidate_ids(text, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.lims_verification_candidate_ids(boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.lims_doctor_approval_candidate_ids(boolean) TO authenticated, service_role;
