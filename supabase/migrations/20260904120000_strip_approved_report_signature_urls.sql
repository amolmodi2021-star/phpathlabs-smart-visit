-- Slim approved_reports.test_results: drop embedded signature images (base64/data URLs).
-- PDF reports resolve signature images from pathologist_signatures by approved_by name.
-- Also update heal-from-live so it no longer copies bloated signature URLs forward.

CREATE OR REPLACE FUNCTION public.lims_strip_approved_report_signature_urls()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated bigint := 0;
BEGIN
  WITH rewritten AS (
    SELECT
      ar.id,
      COALESCE((
        SELECT jsonb_agg(
          CASE
            WHEN jsonb_typeof(e) <> 'object' THEN e
            ELSE
              (
                (e - 'approved_by_signature_url')
                || jsonb_build_object('approved_by_signature_url', NULL)
                || CASE
                     WHEN jsonb_typeof(e->'parameters') = 'array' THEN
                       jsonb_build_object(
                         'parameters',
                         COALESCE((
                           SELECT jsonb_agg(
                             CASE
                               WHEN jsonb_typeof(p) = 'object' THEN
                                 (p - 'approved_by_signature_url')
                                 || jsonb_build_object('approved_by_signature_url', NULL)
                               ELSE p
                             END
                           )
                           FROM jsonb_array_elements(e->'parameters') p
                         ), '[]'::jsonb)
                       )
                     ELSE '{}'::jsonb
                   END
              )
          END
        )
        FROM jsonb_array_elements(COALESCE(ar.test_results, '[]'::jsonb)) e
      ), '[]'::jsonb) AS new_results
    FROM public.approved_reports ar
    WHERE COALESCE(ar.test_results, '[]'::jsonb) <> '[]'::jsonb
      AND ar.test_results::text LIKE '%approved_by_signature_url%'
  )
  UPDATE public.approved_reports ar
  SET test_results = r.new_results
  FROM rewritten r
  WHERE ar.id = r.id
    AND ar.test_results IS DISTINCT FROM r.new_results;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$$;

REVOKE ALL ON FUNCTION public.lims_strip_approved_report_signature_urls() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lims_strip_approved_report_signature_urls() TO service_role;

CREATE OR REPLACE FUNCTION public.lims_heal_approved_report_from_live(p_registration_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing jsonb;
  v_meta jsonb;
  v_added jsonb := '[]'::jsonb;
  v_count int := 0;
  v_hist_added int := 0;
BEGIN
  IF p_registration_id IS NULL THEN
    RETURN 0;
  END IF;

  SELECT ar.test_results
    INTO v_existing
  FROM public.approved_reports ar
  WHERE ar.registration_id = p_registration_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN 0;
  END IF;
  v_existing := COALESCE(v_existing, '[]'::jsonb);

  -- Prefer name/qualification/designation only — never copy embedded signature images.
  SELECT e
    INTO v_meta
  FROM jsonb_array_elements(v_existing) e
  WHERE NULLIF(e->>'approved_by', '') IS NOT NULL
  LIMIT 1;

  SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb), '[]'::jsonb), count(*)::int
    INTO v_added, v_count
  FROM (
    SELECT
      pr.test_id,
      COALESCE(t.test_name, '') AS test_name,
      pr.parameter_id,
      pr.param_code,
      pr.parameter_name,
      pr.result_value,
      pr.unit,
      pr.reference_range,
      pr.normal_range_low,
      pr.normal_range_high,
      pr.flag,
      COALESCE(pr.is_calculated, false) AS is_calculated,
      false AS is_outsourced,
      NULL::text AS outsource_lab_name,
      COALESCE(pr.approved_by, v_meta->>'approved_by') AS approved_by,
      v_meta->>'approved_by_qualification' AS approved_by_qualification,
      v_meta->>'approved_by_designation' AS approved_by_designation,
      NULL::text AS approved_by_signature_url,
      pr.note,
      pr.test_note
    FROM public.patient_results pr
    LEFT JOIN public.tests t ON t.id = pr.test_id
    WHERE pr.registration_id = p_registration_id
      AND pr.status IN ('approved', 'dispatched')
      AND pr.parameter_id IS NOT NULL
      AND pr.test_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(v_existing) e
        WHERE e->>'test_id' = pr.test_id::text
          AND e->>'parameter_id' = pr.parameter_id::text
      )
  ) x;

  IF v_count > 0 THEN
    UPDATE public.approved_reports
    SET test_results = v_existing || v_added
    WHERE registration_id = p_registration_id;
  END IF;

  v_hist_added := public.lims_heal_approved_report_histograms(p_registration_id);
  RETURN v_count + v_hist_added;
END;
$$;

SELECT public.lims_strip_approved_report_signature_urls();
