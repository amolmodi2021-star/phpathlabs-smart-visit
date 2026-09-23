-- Treat live approved/dispatched rows as missing when the snapshot only has
-- some tests or some parameters. Compare test/parameter ids case-insensitively.

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
    IF NOT EXISTS (
      SELECT 1
      FROM public.patient_results pr
      WHERE pr.registration_id = p_registration_id
        AND pr.status IN ('approved', 'dispatched')
        AND pr.parameter_id IS NOT NULL
        AND pr.test_id IS NOT NULL
    ) THEN
      RETURN 0;
    END IF;

    INSERT INTO public.approved_reports (
      registration_id, invoice_number, umr_number, patient_name, title, gender, dob, age_text,
      mobile_number, email, address, doctor_name, visit_type, is_stat, report_language,
      approved_by, registration_date, approval_date, sample_collection_date,
      test_results, outsourced_snip_urls
    )
    SELECT
      r.id,
      r.invoice_number,
      r.umr_number,
      r.patient_name,
      r.title,
      r.gender,
      r.dob,
      r.age_text,
      r.mobile_number,
      r.email,
      r.address,
      r.doctor_name,
      r.visit_type,
      COALESCE(r.is_stat, false),
      r.report_language,
      (
        SELECT pr.approved_by
        FROM public.patient_results pr
        WHERE pr.registration_id = p_registration_id
          AND pr.status IN ('approved', 'dispatched')
          AND NULLIF(BTRIM(pr.approved_by), '') IS NOT NULL
        ORDER BY pr.approved_at DESC NULLS LAST
        LIMIT 1
      ),
      r.created_at,
      COALESCE(
        (
          SELECT MAX(pr.approved_at)
          FROM public.patient_results pr
          WHERE pr.registration_id = p_registration_id
            AND pr.status IN ('approved', 'dispatched')
        ),
        now()
      ),
      (
        SELECT MIN(st.collected_at)
        FROM public.sample_tubes st
        WHERE st.registration_id = p_registration_id
          AND st.collected_at IS NOT NULL
      ),
      '[]'::jsonb,
      '[]'::jsonb
    FROM public.patient_registrations r
    WHERE r.id = p_registration_id;

    IF NOT FOUND THEN
      RETURN 0;
    END IF;

    SELECT ar.test_results
      INTO v_existing
    FROM public.approved_reports ar
    WHERE ar.registration_id = p_registration_id
    FOR UPDATE;
  END IF;

  v_existing := COALESCE(v_existing, '[]'::jsonb);

  SELECT e
    INTO v_meta
  FROM jsonb_array_elements(v_existing) e
  WHERE NULLIF(e->>'approved_by', '') IS NOT NULL
     OR NULLIF(e->>'approved_by_doctor_code', '') IS NOT NULL
  LIMIT 1;

  SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb), '[]'::jsonb), count(*)::int
    INTO v_added, v_count
  FROM (
    SELECT
      pr.test_id,
      COALESCE(
        NULLIF(t.test_name, ''),
        (
          SELECT NULLIF(e->>'test_name', '')
          FROM jsonb_array_elements(v_existing) e
          WHERE lower(btrim(COALESCE(e->>'test_id', ''))) = lower(btrim(pr.test_id::text))
          LIMIT 1
        ),
        ''
      ) AS test_name,
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
      COALESCE(v_meta->>'approved_by_qualification', ps.qualification) AS approved_by_qualification,
      COALESCE(v_meta->>'approved_by_designation', ps.designation) AS approved_by_designation,
      NULL::text AS approved_by_signature_url,
      COALESCE(v_meta->>'approved_by_doctor_code', ps.doctor_code) AS approved_by_doctor_code,
      pr.note,
      pr.test_note
    FROM public.patient_results pr
    LEFT JOIN public.tests t ON t.id = pr.test_id
    LEFT JOIN LATERAL (
      SELECT qualification, designation, doctor_code
      FROM public.pathologist_signatures ps
      WHERE lower(btrim(ps.pathologist_name)) = lower(btrim(COALESCE(pr.approved_by, v_meta->>'approved_by')))
      ORDER BY ps.updated_at DESC NULLS LAST
      LIMIT 1
    ) ps ON true
    WHERE pr.registration_id = p_registration_id
      AND pr.status IN ('approved', 'dispatched')
      AND pr.parameter_id IS NOT NULL
      AND pr.test_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(v_existing) e
        WHERE lower(btrim(COALESCE(e->>'test_id', e->>'testId', ''))) = lower(btrim(pr.test_id::text))
          AND lower(btrim(COALESCE(e->>'parameter_id', e->>'parameterId', ''))) = lower(btrim(pr.parameter_id::text))
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

REVOKE ALL ON FUNCTION public.lims_heal_approved_report_from_live(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lims_heal_approved_report_from_live(uuid) TO authenticated, service_role, anon;