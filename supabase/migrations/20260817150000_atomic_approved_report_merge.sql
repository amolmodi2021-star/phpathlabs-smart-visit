-- Atomic approved_reports snapshot merge + heal-from-live.
-- Root cause of missing CBC/HBA1C: client read-merge-write lost updates under concurrency
-- (two Doctor Approvals load the same snapshot; the later upsert overwrites the earlier test).

CREATE OR REPLACE FUNCTION public.lims_merge_approved_report_snapshot(
  p_registration_id uuid,
  p_incoming jsonb,
  p_header jsonb DEFAULT '{}'::jsonb,
  p_snip_urls jsonb DEFAULT '[]'::jsonb,
  p_remove_test_ids uuid[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing jsonb;
  v_existing_snips jsonb;
  v_incoming jsonb := COALESCE(p_incoming, '[]'::jsonb);
  v_snips jsonb := COALESCE(p_snip_urls, '[]'::jsonb);
  v_merged jsonb;
  v_merged_snips jsonb;
  v_found boolean := false;
BEGIN
  IF p_registration_id IS NULL THEN
    RAISE EXCEPTION 'registration_id required';
  END IF;
  IF jsonb_typeof(v_incoming) <> 'array' THEN
    RAISE EXCEPTION 'p_incoming must be a JSON array';
  END IF;

  SELECT ar.test_results, ar.outsourced_snip_urls
    INTO v_existing, v_existing_snips
  FROM public.approved_reports ar
  WHERE ar.registration_id = p_registration_id
  FOR UPDATE;

  v_found := FOUND;
  v_existing := COALESCE(v_existing, '[]'::jsonb);
  v_existing_snips := COALESCE(v_existing_snips, '[]'::jsonb);

  -- Drop replaced snip-only tests and any keys that incoming is refreshing.
  SELECT COALESCE(jsonb_agg(e), '[]'::jsonb)
    INTO v_merged
  FROM jsonb_array_elements(v_existing) e
  WHERE (
      p_remove_test_ids IS NULL
      OR NOT ((e->>'test_id')::uuid = ANY (p_remove_test_ids))
    )
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(v_incoming) i
      WHERE NULLIF(i->>'test_id', '') IS NOT NULL
        AND NULLIF(i->>'parameter_id', '') IS NOT NULL
        AND i->>'test_id' = e->>'test_id'
        AND i->>'parameter_id' = e->>'parameter_id'
    )
    -- snip-only markers (no parameter_id): replace when same test_id arrives without params
    AND NOT (
      NULLIF(e->>'parameter_id', '') IS NULL
      AND EXISTS (
        SELECT 1
        FROM jsonb_array_elements(v_incoming) i
        WHERE i->>'test_id' = e->>'test_id'
          AND NULLIF(i->>'parameter_id', '') IS NULL
      )
    );

  v_merged := COALESCE(v_merged, '[]'::jsonb) || v_incoming;

  -- Merge snip URL lists (unique strings).
  SELECT COALESCE(jsonb_agg(DISTINCT x), '[]'::jsonb)
    INTO v_merged_snips
  FROM (
    SELECT jsonb_array_elements_text(v_existing_snips) AS x
    UNION
    SELECT jsonb_array_elements_text(v_snips) AS x
  ) s
  WHERE NULLIF(x, '') IS NOT NULL;

  IF v_found THEN
    UPDATE public.approved_reports ar
    SET
      test_results = v_merged,
      outsourced_snip_urls = v_merged_snips,
      invoice_number = COALESCE(p_header->>'invoice_number', ar.invoice_number),
      umr_number = COALESCE(p_header->>'umr_number', ar.umr_number),
      patient_name = COALESCE(p_header->>'patient_name', ar.patient_name),
      title = COALESCE(p_header->>'title', ar.title),
      gender = COALESCE(p_header->>'gender', ar.gender),
      dob = COALESCE((p_header->>'dob')::date, ar.dob),
      age_text = COALESCE(NULLIF(p_header->>'age_text', ''), ar.age_text),
      mobile_number = COALESCE(p_header->>'mobile_number', ar.mobile_number),
      email = COALESCE(p_header->>'email', ar.email),
      address = COALESCE(p_header->>'address', ar.address),
      doctor_name = COALESCE(p_header->>'doctor_name', ar.doctor_name),
      visit_type = COALESCE(p_header->>'visit_type', ar.visit_type),
      is_stat = COALESCE((p_header->>'is_stat')::boolean, ar.is_stat),
      report_language = COALESCE(p_header->>'report_language', ar.report_language),
      approved_by = COALESCE(p_header->>'approved_by', ar.approved_by),
      registration_date = COALESCE((p_header->>'registration_date')::timestamptz, ar.registration_date),
      approval_date = COALESCE((p_header->>'approval_date')::timestamptz, ar.approval_date, now()),
      sample_collection_date = COALESCE(
        (p_header->>'sample_collection_date')::timestamptz,
        ar.sample_collection_date
      )
    WHERE ar.registration_id = p_registration_id;
  ELSE
    INSERT INTO public.approved_reports (
      registration_id, invoice_number, umr_number, patient_name, title, gender, dob, age_text,
      mobile_number, email, address, doctor_name, visit_type, is_stat, report_language,
      approved_by, registration_date, approval_date, sample_collection_date,
      test_results, outsourced_snip_urls
    ) VALUES (
      p_registration_id,
      p_header->>'invoice_number',
      p_header->>'umr_number',
      p_header->>'patient_name',
      p_header->>'title',
      p_header->>'gender',
      NULLIF(p_header->>'dob', '')::date,
      NULLIF(p_header->>'age_text', ''),
      p_header->>'mobile_number',
      p_header->>'email',
      p_header->>'address',
      p_header->>'doctor_name',
      p_header->>'visit_type',
      COALESCE((p_header->>'is_stat')::boolean, false),
      p_header->>'report_language',
      p_header->>'approved_by',
      NULLIF(p_header->>'registration_date', '')::timestamptz,
      COALESCE(NULLIF(p_header->>'approval_date', '')::timestamptz, now()),
      NULLIF(p_header->>'sample_collection_date', '')::timestamptz,
      v_merged,
      v_merged_snips
    );
  END IF;

  RETURN jsonb_build_object(
    'registration_id', p_registration_id,
    'result_count', jsonb_array_length(v_merged),
    'created', NOT v_found
  );
END;
$$;

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

  -- Prefer signature metadata from an existing snapshot row for the same approver.
  SELECT e
    INTO v_meta
  FROM jsonb_array_elements(v_existing) e
  WHERE NULLIF(e->>'approved_by_signature_url', '') IS NOT NULL
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
      v_meta->>'approved_by_signature_url' AS approved_by_signature_url,
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

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.lims_merge_approved_report_snapshot(uuid, jsonb, jsonb, jsonb, uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.lims_heal_approved_report_from_live(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lims_merge_approved_report_snapshot(uuid, jsonb, jsonb, jsonb, uuid[]) TO authenticated, service_role, anon;
GRANT EXECUTE ON FUNCTION public.lims_heal_approved_report_from_live(uuid) TO authenticated, service_role, anon;