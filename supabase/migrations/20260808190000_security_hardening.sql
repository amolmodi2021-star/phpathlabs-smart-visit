-- Security hardening: revoke anon PHI blanket SELECT; portal token-scoped RPCs;
-- exclude cancelled_tests from results-entry candidate RPC.

-- ---------------------------------------------------------------------------
-- 1. Portal RPCs (SECURITY DEFINER) — anon never needs table SELECT on PHI
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.portal_lookup(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_link public.report_share_links%ROWTYPE;
  v_reg jsonb;
BEGIN
  IF p_token IS NULL OR btrim(p_token) = '' THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_link
  FROM public.report_share_links
  WHERE token = btrim(p_token)
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF v_link.expires_at IS NOT NULL AND v_link.expires_at < now() THEN
    RETURN jsonb_build_object('expired', true, 'link', to_jsonb(v_link));
  END IF;

  SELECT to_jsonb(pr) - 'payments' INTO v_reg
  FROM public.patient_registrations pr
  WHERE pr.id = v_link.registration_id
    AND COALESCE(pr.bill_cancelled, false) = false
  LIMIT 1;

  IF v_reg IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN jsonb_build_object(
    'expired', false,
    'link', to_jsonb(v_link),
    'registration', jsonb_build_object(
      'id', v_reg->>'id',
      'invoice_number', v_reg->>'invoice_number',
      'patient_name', v_reg->>'patient_name',
      'mobile_number', v_reg->>'mobile_number',
      'umr_number', v_reg->>'umr_number',
      'dob', v_reg->>'dob',
      'due_amount', (v_reg->>'due_amount')::numeric,
      'created_at', v_reg->>'created_at',
      'tests', COALESCE(v_reg->'tests', '[]'::jsonb),
      'cancelled_tests', COALESCE(v_reg->'cancelled_tests', '[]'::jsonb),
      'status', v_reg->>'status',
      'bill_cancelled', COALESCE((v_reg->>'bill_cancelled')::boolean, false)
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.portal_bundle(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_link public.report_share_links%ROWTYPE;
  v_reg public.patient_registrations%ROWTYPE;
  v_day_start timestamptz;
  v_day_end timestamptz;
  v_siblings jsonb;
  v_reg_ids uuid[];
  v_results jsonb;
  v_tubes jsonb;
  v_snips jsonb;
  v_previous jsonb;
  v_tests jsonb;
  v_depts jsonb;
BEGIN
  IF p_token IS NULL OR btrim(p_token) = '' THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_link FROM public.report_share_links WHERE token = btrim(p_token) LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF v_link.expires_at IS NOT NULL AND v_link.expires_at < now() THEN RETURN NULL; END IF;

  SELECT * INTO v_reg FROM public.patient_registrations
  WHERE id = v_link.registration_id AND COALESCE(bill_cancelled, false) = false
  LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;

  v_day_start := date_trunc('day', v_reg.created_at);
  v_day_end := v_day_start + interval '1 day';

  SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY s.created_at), '[]'::jsonb),
         COALESCE(array_agg(s.id), ARRAY[v_reg.id]::uuid[])
  INTO v_siblings, v_reg_ids
  FROM (
    SELECT id, invoice_number, patient_name, mobile_number, umr_number, dob,
           due_amount, paid_amount, final_amount, created_at, tests, cancelled_tests,
           status, bill_cancelled
    FROM public.patient_registrations
    WHERE umr_number IS NOT NULL
      AND umr_number = v_reg.umr_number
      AND created_at >= v_day_start
      AND created_at < v_day_end
      AND COALESCE(bill_cancelled, false) = false
    ORDER BY created_at
  ) s;

  IF NOT (v_reg.id = ANY (v_reg_ids)) THEN
    v_reg_ids := array_append(v_reg_ids, v_reg.id);
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(r)), '[]'::jsonb) INTO v_results
  FROM public.patient_results r
  WHERE r.registration_id = ANY (v_reg_ids);

  SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) INTO v_tubes
  FROM public.sample_tubes t
  WHERE t.registration_id = ANY (v_reg_ids);

  SELECT COALESCE(jsonb_agg(to_jsonb(o)), '[]'::jsonb) INTO v_snips
  FROM public.outsourced_test_snips o
  WHERE o.registration_id = ANY (v_reg_ids);

  SELECT COALESCE(jsonb_agg(to_jsonb(a)), '[]'::jsonb) INTO v_previous
  FROM (
    SELECT DISTINCT ON (registration_id)
      id, registration_id, invoice_number, patient_name, registration_date, approval_date, test_results
    FROM public.approved_reports
    WHERE umr_number IS NOT NULL
      AND umr_number = v_reg.umr_number
      AND NOT (registration_id = ANY (v_reg_ids))
    ORDER BY registration_id, approval_date DESC NULLS LAST
    LIMIT 20
  ) a;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'test_name', test_name, 'department_id', department_id)), '[]'::jsonb)
  INTO v_tests FROM public.tests WHERE is_active IS DISTINCT FROM false;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'department_name', department_name, 'display_order', display_order)), '[]'::jsonb)
  INTO v_depts FROM public.report_departments;

  RETURN jsonb_build_object(
    'aggregated', COALESCE(v_siblings, '[]'::jsonb),
    'results', COALESCE(v_results, '[]'::jsonb),
    'tubes', COALESCE(v_tubes, '[]'::jsonb),
    'snips', COALESCE(v_snips, '[]'::jsonb),
    'previous', COALESCE(v_previous, '[]'::jsonb),
    'tests', COALESCE(v_tests, '[]'::jsonb),
    'departments', COALESCE(v_depts, '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.portal_lookup(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.portal_bundle(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.portal_lookup(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.portal_bundle(text) TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Revoke anon blanket PHI table access (keep share-link analytics + masters)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t text;
  drop_tables text[] := ARRAY[
    'patient_registrations',
    'patient_results',
    'sample_tubes',
    'outsourced_test_snips',
    'approved_reports',
    'patient_master',
    'parameter_normal_ranges',
    'billing_profile_tests',
    'billing_profiles',
    'health_checkup_tests',
    'health_checkup_profiles',
    'health_checkups',
    'combo_tests',
    'combo_profiles',
    'combos',
    'test_parameters',
    'report_test_parameters',
    'report_profiles',
    'report_layout_settings',
    'pathologist_signatures'
  ];
BEGIN
  FOREACH t IN ARRAY drop_tables
  LOOP
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = t) THEN
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'anon_select_' || t, t);
    END IF;
  END LOOP;
END $$;

REVOKE SELECT ON
  public.patient_registrations,
  public.patient_results,
  public.sample_tubes,
  public.outsourced_test_snips,
  public.approved_reports,
  public.patient_master,
  public.parameter_normal_ranges,
  public.billing_profile_tests,
  public.billing_profiles,
  public.health_checkup_tests,
  public.health_checkup_profiles,
  public.health_checkups,
  public.combo_tests,
  public.combo_profiles,
  public.combos,
  public.test_parameters,
  public.report_test_parameters,
  public.report_profiles,
  public.report_layout_settings,
  public.pathologist_signatures
FROM anon;

-- Keep minimal anon SELECT for portal UX masters + share analytics
GRANT SELECT ON
  public.report_share_links,
  public.report_link_events,
  public.report_link_sessions,
  public.tests,
  public.report_departments,
  public.app_settings
TO anon;

-- ---------------------------------------------------------------------------
-- 3. Exclude cancelled_tests from results-entry candidates
-- ---------------------------------------------------------------------------
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
  tracked AS (
    SELECT DISTINCT pr.registration_id, pr.test_id::text AS test_id
    FROM public.patient_results pr
    WHERE pr.status IN ('entered', 'results_entered', 'verified', 'approved', 'dispatched')
    UNION
    SELECT DISTINCT os.registration_id, os.test_id::text AS test_id
    FROM public.outsourced_test_snips os
    WHERE os.outsource_status IN ('entered', 'results_entered', 'verified', 'approved', 'dispatched')
  )
  SELECT COALESCE(array_agg(DISTINCT a.registration_id), ARRAY[]::uuid[])
  FROM accepted a
  LEFT JOIN cancelled c
    ON c.registration_id = a.registration_id
   AND c.test_id = a.test_id
  LEFT JOIN tracked t
    ON t.registration_id = a.registration_id
   AND t.test_id = a.test_id
  WHERE a.test_id IS NOT NULL
    AND a.test_id <> ''
    AND c.test_id IS NULL
    AND t.test_id IS NULL;
$$;
