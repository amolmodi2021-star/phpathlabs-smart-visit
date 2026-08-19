-- Lean bill pipeline hover: one RPC → [{test_id, test_name, status}].
-- Mirrors src/lib/testPipelineStatus.ts (incl. Outsourced vs Entered rules).

CREATE OR REPLACE FUNCTION public.lims_patient_test_pipeline_status(p_registration_id uuid)
RETURNS TABLE (
  test_id uuid,
  test_name text,
  status text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tests jsonb;
  v_cancelled jsonb;
  v_repeats jsonb;
  v_bill_cancelled boolean := false;
BEGIN
  IF p_registration_id IS NULL THEN
    RETURN;
  END IF;

  SELECT
    COALESCE(pr.tests, '[]'::jsonb),
    COALESCE(pr.cancelled_tests, '[]'::jsonb),
    COALESCE(pr.repeat_tests, '[]'::jsonb),
    COALESCE(pr.bill_cancelled, false)
  INTO v_tests, v_cancelled, v_repeats, v_bill_cancelled
  FROM public.patient_registrations pr
  WHERE pr.id = p_registration_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH
  cancelled AS (
    SELECT DISTINCT x AS id
    FROM (
      SELECT CASE
        WHEN jsonb_typeof(elem) = 'string' THEN NULLIF(trim(both '"' from elem::text), '')::uuid
        ELSE NULLIF(COALESCE(elem->>'test_id', elem->>'id'), '')::uuid
      END AS x
      FROM jsonb_array_elements(v_cancelled) elem
    ) s
    WHERE x IS NOT NULL
  ),
  repeats AS (
    SELECT DISTINCT x AS id
    FROM (
      SELECT CASE
        WHEN jsonb_typeof(elem) = 'string' THEN NULLIF(trim(both '"' from elem::text), '')::uuid
        ELSE NULLIF(elem->>'test_id', '')::uuid
      END AS x
      FROM jsonb_array_elements(v_repeats) elem
    ) s
    WHERE x IS NOT NULL
  ),
  tube_ids_raw AS (
    SELECT
      st.id AS tube_row_id,
      st.status AS tube_status,
      st.created_at,
      COALESCE(st.test_ids, '[]'::jsonb) AS tids
    FROM public.sample_tubes st
    WHERE st.registration_id = p_registration_id
  ),
  tube_leafs AS (
    SELECT DISTINCT NULLIF(trim(tid), '')::uuid AS id
    FROM tube_ids_raw t
    CROSS JOIN LATERAL jsonb_array_elements_text(t.tids) AS tid
    WHERE NULLIF(trim(tid), '') IS NOT NULL
  ),
  reg_leafs AS (
    SELECT DISTINCT NULLIF(elem->>'test_id', '')::uuid AS id
    FROM jsonb_array_elements(v_tests) elem
    WHERE NULLIF(elem->>'test_id', '') IS NOT NULL
  ),
  all_leafs AS (
    SELECT id FROM tube_leafs
    UNION
    SELECT id FROM reg_leafs
  ),
  leafs AS (
    SELECT id FROM all_leafs
    WHERE EXISTS (SELECT 1 FROM tube_leafs)
    UNION ALL
    SELECT id FROM reg_leafs
    WHERE NOT EXISTS (SELECT 1 FROM tube_leafs)
  ),
  leaf_uniq AS (
    SELECT DISTINCT id FROM leafs WHERE id IS NOT NULL
  ),
  tube_by_test AS (
    SELECT DISTINCT ON (tid)
      tid AS test_id,
      t.tube_status
    FROM tube_ids_raw t
    CROSS JOIN LATERAL jsonb_array_elements_text(t.tids) AS tid_txt
    CROSS JOIN LATERAL (SELECT NULLIF(trim(tid_txt), '')::uuid AS tid) x
    WHERE x.tid IS NOT NULL
    ORDER BY tid,
      CASE t.tube_status
        WHEN 'accepted' THEN 3
        WHEN 'collected' THEN 2
        WHEN 'deferred' THEN 1
        ELSE 0
      END DESC,
      t.created_at DESC NULLS LAST
  ),
  result_best AS (
    SELECT
      pr.test_id,
      CASE
        WHEN bool_or(pr.status = 'dispatched') THEN 'dispatched'
        WHEN bool_or(pr.status = 'approved') THEN 'approved'
        WHEN bool_or(pr.status = 'verified') THEN 'verified'
        WHEN bool_or(pr.status IN ('entered', 'results_entered')) THEN 'results_entered'
        ELSE NULL
      END AS from_results
    FROM public.patient_results pr
    WHERE pr.registration_id = p_registration_id
      AND pr.test_id IN (SELECT id FROM leaf_uniq)
    GROUP BY pr.test_id
  ),
  snip_raw AS (
    SELECT DISTINCT ON (s.test_id)
      s.test_id,
      COALESCE(s.outsource_status, '') AS outsource_status,
      lower(COALESCE(s.result_mode, '')) AS result_mode,
      COALESCE(s.snip_image_urls, '[]'::jsonb) AS snip_image_urls
    FROM public.outsourced_test_snips s
    WHERE s.registration_id = p_registration_id
      AND s.test_id IN (SELECT id FROM leaf_uniq)
    ORDER BY s.test_id, s.updated_at DESC NULLS LAST
  ),
  snip_prog AS (
    SELECT
      s.test_id,
      s.outsource_status,
      CASE
        WHEN s.outsource_status = 'dispatched' THEN 'dispatched'
        WHEN s.outsource_status = 'approved' THEN 'approved'
        WHEN s.outsource_status = 'verified' THEN 'verified'
        WHEN s.outsource_status IN ('results_entered', 'results_saved') THEN
          CASE
            WHEN (
              s.result_mode IN ('snip', 'image')
              OR (
                jsonb_typeof(s.snip_image_urls) = 'array'
                AND jsonb_array_length(s.snip_image_urls) > 0
              )
            )
            AND (
              jsonb_typeof(s.snip_image_urls) <> 'array'
              OR jsonb_array_length(s.snip_image_urls) = 0
            )
            THEN 'outsourced'
            ELSE 'results_entered'
          END
        WHEN s.outsource_status IN ('sent', 'pending', '') THEN 'outsourced'
        ELSE NULL
      END AS from_snip
    FROM snip_raw s
  ),
  has_params AS (
    SELECT tp.test_id, true AS has_param
    FROM public.test_parameters tp
    WHERE tp.test_id IN (
      SELECT lu.id FROM leaf_uniq lu
      JOIN public.tests t ON t.id = lu.id
      WHERE COALESCE(t.is_outsourced, false)
    )
      AND COALESCE(tp.is_subheader, false) = false
    GROUP BY tp.test_id
  ),
  base AS (
    SELECT
      lu.id AS test_id,
      COALESCE(NULLIF(t.test_name, ''), 'Unknown') AS test_name,
      COALESCE(t.is_outsourced, false) AS is_outsourced,
      (v_bill_cancelled OR EXISTS (SELECT 1 FROM cancelled c WHERE c.id = lu.id)) AS is_cancelled,
      EXISTS (SELECT 1 FROM repeats r WHERE r.id = lu.id) AS is_repeat,
      tb.tube_status,
      rb.from_results,
      sp.from_snip,
      sp.outsource_status AS snip_outsource_status,
      (sp.test_id IS NOT NULL) AS has_snip,
      COALESCE(hp.has_param, false) AS has_param
    FROM leaf_uniq lu
    LEFT JOIN public.tests t ON t.id = lu.id
    LEFT JOIN tube_by_test tb ON tb.test_id = lu.id
    LEFT JOIN result_best rb ON rb.test_id = lu.id
    LEFT JOIN snip_prog sp ON sp.test_id = lu.id
    LEFT JOIN has_params hp ON hp.test_id = lu.id
  ),
  derived AS (
    SELECT
      b.*,
      CASE b.tube_status
        WHEN 'accepted' THEN 'sample_accepted'
        WHEN 'collected' THEN 'sample_collected'
        WHEN 'deferred' THEN 'collect_later'
        ELSE NULL
      END AS from_tube,
      CASE
        WHEN b.from_results = 'dispatched' OR b.from_snip = 'dispatched' THEN 90
        WHEN b.from_results = 'approved' OR b.from_snip = 'approved' THEN 80
        WHEN b.from_results = 'verified' OR b.from_snip = 'verified' THEN 70
        WHEN b.from_results = 'results_entered' OR b.from_snip = 'results_entered' THEN 60
        WHEN b.from_snip = 'outsourced' THEN 55
        WHEN b.tube_status = 'accepted' THEN 50
        WHEN b.tube_status = 'collected' THEN 40
        WHEN b.tube_status = 'deferred' THEN 30
        ELSE 10
      END AS base_rank,
      CASE
        WHEN b.from_results = 'dispatched' OR b.from_snip = 'dispatched' THEN 'dispatched'
        WHEN b.from_results = 'approved' OR b.from_snip = 'approved' THEN 'approved'
        WHEN b.from_results = 'verified' OR b.from_snip = 'verified' THEN 'verified'
        WHEN b.from_results = 'results_entered' OR b.from_snip = 'results_entered' THEN 'results_entered'
        WHEN b.from_snip = 'outsourced' THEN 'outsourced'
        WHEN b.tube_status = 'accepted' THEN 'sample_accepted'
        WHEN b.tube_status = 'collected' THEN 'sample_collected'
        WHEN b.tube_status = 'deferred' THEN 'collect_later'
        ELSE 'registered'
      END AS picked
    FROM base b
  ),
  final AS (
    SELECT
      d.test_id,
      d.test_name,
      CASE
        WHEN d.is_cancelled THEN 'cancelled'
        ELSE
          CASE
            WHEN (
              (d.is_outsourced OR d.has_snip)
              OR d.from_snip = 'outsourced'
              OR (d.has_snip AND COALESCE(d.snip_outsource_status, '') IN ('pending', 'sent', ''))
            )
            AND d.from_results IS NULL
            AND COALESCE(d.from_snip, '') NOT IN ('results_entered', 'verified', 'approved', 'dispatched')
            THEN
              CASE
                WHEN d.from_tube = 'collect_later' THEN 'collect_later'
                WHEN d.is_repeat AND d.base_rank < 40 THEN 'repeat_collection'
                WHEN d.base_rank >= 55 THEN d.picked
                ELSE 'outsourced'
              END
            WHEN d.is_repeat
              AND d.from_results IS NULL
              AND COALESCE(d.from_snip, '') NOT IN ('results_entered', 'verified', 'approved', 'dispatched')
              AND d.base_rank < 40
            THEN
              CASE WHEN d.from_tube = 'collect_later' THEN 'collect_later' ELSE 'repeat_collection' END
            ELSE d.picked
          END
      END AS status
    FROM derived d
  )
  SELECT
    f.test_id,
    f.test_name,
    f.status
  FROM final f
  ORDER BY
    CASE f.status
      WHEN 'cancelled' THEN 100
      WHEN 'dispatched' THEN 90
      WHEN 'approved' THEN 80
      WHEN 'verified' THEN 70
      WHEN 'results_entered' THEN 60
      WHEN 'outsourced' THEN 55
      WHEN 'sample_accepted' THEN 50
      WHEN 'sample_collected' THEN 40
      WHEN 'collect_later' THEN 30
      WHEN 'repeat_collection' THEN 20
      ELSE 10
    END DESC,
    f.test_name ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.lims_patient_test_pipeline_status(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lims_patient_test_pipeline_status(uuid) TO authenticated, anon, service_role;

COMMENT ON FUNCTION public.lims_patient_test_pipeline_status(uuid) IS
  'Latest per-test pipeline status for one registration (hover). Returns only test_id, test_name, status.';
