-- One-off rescue: any registration whose stored status is terminal
-- (approved / dispatched / partially_*) but where at least one accepted-tube
-- test has neither a meaningful patient_results row nor a terminal outsourced
-- snip should be downgraded so it reappears in upstream queues.
--
-- This heals registrations like 2605020012 (URINE ALB./CREAT RATIO never entered)
-- and 2605020013 (LH/FSH/PROLACTIN snips still pending) which were invisible to
-- every queue except Dispatch.

WITH accepted_tube_tests AS (
  SELECT DISTINCT
    st.registration_id,
    jsonb_array_elements_text(st.test_ids) AS test_id
  FROM public.sample_tubes st
  WHERE st.status = 'accepted'
),
tracked_results AS (
  SELECT DISTINCT registration_id, test_id::text AS test_id
  FROM public.patient_results
  WHERE (result_value IS NOT NULL AND btrim(result_value) <> '')
     OR status IN ('entered','results_entered','verified','approved','dispatched')
),
tracked_snips AS (
  SELECT DISTINCT registration_id, test_id::text AS test_id
  FROM public.outsourced_test_snips
  WHERE outsource_status IN ('results_entered','entered','verified','approved','dispatched')
),
untracked AS (
  SELECT att.registration_id
  FROM accepted_tube_tests att
  LEFT JOIN tracked_results tr
    ON tr.registration_id = att.registration_id AND tr.test_id = att.test_id
  LEFT JOIN tracked_snips ts
    ON ts.registration_id = att.registration_id AND ts.test_id = att.test_id
  WHERE tr.test_id IS NULL AND ts.test_id IS NULL
  GROUP BY att.registration_id
)
UPDATE public.patient_registrations r
SET status = CASE r.status
  WHEN 'dispatched' THEN 'partially_dispatched'
  WHEN 'approved'   THEN 'partially_approved'
  WHEN 'verified'   THEN 'partial_verified'
  WHEN 'processed'  THEN 'partial_processing'
  ELSE r.status
END,
updated_at = now()
FROM untracked u
WHERE r.id = u.registration_id
  AND r.status IN ('dispatched','approved','verified','processed');