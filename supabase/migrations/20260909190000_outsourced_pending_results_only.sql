-- Outsourced Results queue: only registrations that still need outsourced result entry.
-- Exclude tests already entered/verified/approved/dispatched via snip OR patient_results
-- (natural outsourced often has dispatched PR rows with no snip).

CREATE OR REPLACE FUNCTION public.lims_outsourced_candidate_ids()
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH outsourced_tests AS (
    SELECT id::text AS test_id
    FROM public.tests
    WHERE COALESCE(is_outsourced, false) = true
  ),
  -- Still actionable in Outsourced UI (not yet sent to Verification / later)
  active_snip_regs AS (
    SELECT DISTINCT registration_id
    FROM public.outsourced_test_snips
    WHERE outsource_status IN ('pending', 'sent', 'results_saved')
      AND registration_id IS NOT NULL
  ),
  done_snip AS (
    SELECT DISTINCT registration_id, test_id::text AS test_id
    FROM public.outsourced_test_snips
    WHERE outsource_status IN (
      'entered', 'results_entered', 'verified', 'approved', 'dispatched'
    )
  ),
  done_results AS (
    SELECT DISTINCT registration_id, test_id::text AS test_id
    FROM public.patient_results
    WHERE status IN (
      'entered', 'results_entered', 'verified', 'approved', 'dispatched'
    )
      AND test_id IS NOT NULL
  ),
  accepted_natural_pending AS (
    SELECT DISTINCT st.registration_id
    FROM public.sample_tubes st
    CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(st.test_ids, '[]'::jsonb)) AS tid
    INNER JOIN outsourced_tests ot ON ot.test_id = tid
    LEFT JOIN done_snip ds
      ON ds.registration_id = st.registration_id
     AND ds.test_id = tid
    LEFT JOIN done_results dr
      ON dr.registration_id = st.registration_id
     AND dr.test_id = tid
    WHERE st.status = 'accepted'
      AND tid IS NOT NULL
      AND tid <> ''
      AND ds.test_id IS NULL
      AND dr.test_id IS NULL
      AND st.registration_id IS NOT NULL
  )
  SELECT COALESCE(array_agg(DISTINCT registration_id), ARRAY[]::uuid[])
  FROM (
    SELECT registration_id FROM active_snip_regs
    UNION
    SELECT registration_id FROM accepted_natural_pending
  ) s;
$$;

REVOKE ALL ON FUNCTION public.lims_outsourced_candidate_ids() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lims_outsourced_candidate_ids() TO authenticated, service_role;