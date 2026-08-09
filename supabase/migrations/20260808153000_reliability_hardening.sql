-- Reliability hardening:
-- 1) Atomic patient registration (reg + tubes + payment + optional home visit)
-- 2) Server-side LIMS queue candidate RPCs (replace client N+1 scans)
-- 3) Tighten RLS: staff (authenticated JWT) full access; anon read-only portal whitelist; lock app_users

-- ---------------------------------------------------------------------------
-- 1. Atomic registration
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.register_patient_atomic(
  p_registration jsonb,
  p_tubes jsonb DEFAULT '[]'::jsonb,
  p_payment jsonb DEFAULT NULL,
  p_home_visit_id uuid DEFAULT NULL,
  p_home_visit_patch jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reg public.patient_registrations%ROWTYPE;
  v_tube jsonb;
  v_uid text;
  v_sign numeric := 1;
BEGIN
  IF p_registration IS NULL OR jsonb_typeof(p_registration) <> 'object' THEN
    RAISE EXCEPTION 'p_registration is required';
  END IF;

  INSERT INTO public.patient_registrations (
    invoice_number,
    mobile_number,
    patient_name,
    title,
    gender,
    dob,
    email,
    address,
    doctor_name,
    umr_number,
    visit_type,
    pickup_point_id,
    channel_id,
    tests,
    gross_amount,
    discount_amount,
    net_amount,
    home_visit_charges,
    final_amount,
    payments,
    paid_amount,
    due_amount,
    global_discount_type,
    global_discount_value,
    status,
    home_visit_id,
    remarks,
    is_stat,
    report_language,
    registered_by
  ) VALUES (
    COALESCE(p_registration->>'invoice_number', public.generate_invoice_number()),
    COALESCE(p_registration->>'mobile_number', ''),
    COALESCE(p_registration->>'patient_name', ''),
    NULLIF(p_registration->>'title', ''),
    NULLIF(p_registration->>'gender', ''),
    NULLIF(p_registration->>'dob', '')::date,
    NULLIF(p_registration->>'email', ''),
    COALESCE(p_registration->>'address', ''),
    COALESCE(NULLIF(p_registration->>'doctor_name', ''), 'SELF'),
    NULLIF(p_registration->>'umr_number', ''),
    COALESCE(NULLIF(p_registration->>'visit_type', ''), 'lab_visit'),
    NULLIF(p_registration->>'pickup_point_id', '')::uuid,
    NULLIF(p_registration->>'channel_id', '')::uuid,
    COALESCE(p_registration->'tests', '[]'::jsonb),
    COALESCE((p_registration->>'gross_amount')::numeric, 0),
    COALESCE((p_registration->>'discount_amount')::numeric, 0),
    COALESCE((p_registration->>'net_amount')::numeric, 0),
    COALESCE((p_registration->>'home_visit_charges')::numeric, 0),
    COALESCE((p_registration->>'final_amount')::numeric, 0),
    COALESCE(p_registration->'payments', '[]'::jsonb),
    COALESCE((p_registration->>'paid_amount')::numeric, 0),
    COALESCE((p_registration->>'due_amount')::numeric, 0),
    NULLIF(p_registration->>'global_discount_type', ''),
    COALESCE((p_registration->>'global_discount_value')::numeric, 0),
    COALESCE(NULLIF(p_registration->>'status', ''), 'registered'),
    COALESCE(NULLIF(p_registration->>'home_visit_id', '')::uuid, p_home_visit_id),
    NULLIF(p_registration->>'remarks', ''),
    COALESCE((p_registration->>'is_stat')::boolean, false),
    COALESCE(NULLIF(p_registration->>'report_language', ''), 'ENGLISH'),
    NULLIF(p_registration->>'registered_by', '')
  )
  RETURNING * INTO v_reg;

  FOR v_tube IN
    SELECT value FROM jsonb_array_elements(COALESCE(p_tubes, '[]'::jsonb))
  LOOP
    v_uid := public.generate_sample_uid();
    INSERT INTO public.sample_tubes (
      sample_uid,
      registration_id,
      tube_type,
      tube_color,
      sample_type,
      suffix,
      test_ids,
      test_names,
      status
    ) VALUES (
      v_uid,
      v_reg.id,
      NULLIF(v_tube->>'tube_type', ''),
      NULLIF(v_tube->>'tube_color', ''),
      NULLIF(v_tube->>'sample_type', ''),
      COALESCE(v_tube->>'suffix', ''),
      COALESCE(v_tube->'test_ids', '[]'::jsonb),
      COALESCE(v_tube->'test_names', '[]'::jsonb),
      COALESCE(NULLIF(v_tube->>'status', ''), 'pending')
    );
  END LOOP;

  IF p_payment IS NOT NULL AND jsonb_typeof(p_payment) = 'object' THEN
    IF COALESCE(p_payment->>'direction', 'in') = 'out' THEN
      v_sign := -1;
    END IF;

    INSERT INTO public.payment_transactions (
      registration_id,
      invoice_number,
      patient_name,
      transaction_type,
      transaction_date,
      performed_by,
      cash_amount,
      gpay_amount,
      paytm_amount,
      credit_card_amount,
      neft_amount,
      total_amount,
      direction,
      gross_amount,
      discount_amount,
      final_amount,
      paid_amount,
      due_amount,
      refund_amount,
      remarks
    ) VALUES (
      v_reg.id,
      COALESCE(p_payment->>'invoice_number', v_reg.invoice_number),
      COALESCE(NULLIF(p_payment->>'patient_name', ''), v_reg.patient_name),
      COALESCE(NULLIF(p_payment->>'transaction_type', ''), 'registration_payment'),
      COALESCE(NULLIF(p_payment->>'transaction_date', '')::timestamptz, now()),
      NULLIF(p_payment->>'performed_by', ''),
      COALESCE((p_payment->>'cash_amount')::numeric, 0) * v_sign,
      COALESCE((p_payment->>'gpay_amount')::numeric, 0) * v_sign,
      COALESCE((p_payment->>'paytm_amount')::numeric, 0) * v_sign,
      COALESCE((p_payment->>'credit_card_amount')::numeric, 0) * v_sign,
      COALESCE((p_payment->>'neft_amount')::numeric, 0) * v_sign,
      COALESCE((p_payment->>'total_amount')::numeric, 0) * v_sign,
      COALESCE(NULLIF(p_payment->>'direction', ''), 'in'),
      COALESCE((p_payment->>'gross_amount')::numeric, v_reg.gross_amount),
      COALESCE((p_payment->>'discount_amount')::numeric, v_reg.discount_amount),
      COALESCE((p_payment->>'final_amount')::numeric, v_reg.final_amount),
      COALESCE((p_payment->>'paid_amount')::numeric, v_reg.paid_amount),
      COALESCE((p_payment->>'due_amount')::numeric, v_reg.due_amount),
      COALESCE((p_payment->>'refund_amount')::numeric, 0),
      NULLIF(p_payment->>'remarks', '')
    );
  END IF;

  IF p_home_visit_id IS NOT NULL THEN
    UPDATE public.home_visits hv
    SET
      status = COALESCE(NULLIF(p_home_visit_patch->>'status', ''), 'Registered'),
      address = COALESCE(NULLIF(p_home_visit_patch->>'address', ''), hv.address),
      payment_mode = CASE
        WHEN p_home_visit_patch ? 'payment_mode' THEN NULLIF(p_home_visit_patch->>'payment_mode', '')
        ELSE hv.payment_mode
      END,
      paid_amount = CASE
        WHEN p_home_visit_patch ? 'paid_amount' THEN COALESCE((p_home_visit_patch->>'paid_amount')::numeric, hv.paid_amount)
        ELSE hv.paid_amount
      END,
      due_amount = CASE
        WHEN p_home_visit_patch ? 'due_amount' THEN COALESCE((p_home_visit_patch->>'due_amount')::numeric, hv.due_amount)
        ELSE hv.due_amount
      END,
      updated_at = now()
    WHERE hv.id = p_home_visit_id;
  END IF;

  RETURN to_jsonb(v_reg);
END;
$$;

REVOKE ALL ON FUNCTION public.register_patient_atomic(jsonb, jsonb, jsonb, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_patient_atomic(jsonb, jsonb, jsonb, uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.register_patient_atomic(jsonb, jsonb, jsonb, uuid, jsonb) TO service_role;

-- ---------------------------------------------------------------------------
-- 2. LIMS queue candidate RPCs
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lims_verification_candidate_ids()
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(array_agg(DISTINCT registration_id), ARRAY[]::uuid[])
  FROM (
    SELECT registration_id FROM public.patient_results WHERE status = 'entered'
    UNION
    SELECT registration_id FROM public.outsourced_test_snips
      WHERE outsource_status IN ('results_entered', 'entered')
  ) s
  WHERE registration_id IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION public.lims_doctor_approval_candidate_ids()
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(array_agg(DISTINCT registration_id), ARRAY[]::uuid[])
  FROM (
    SELECT registration_id FROM public.patient_results WHERE status = 'verified'
    UNION
    SELECT registration_id FROM public.outsourced_test_snips WHERE outsource_status = 'verified'
  ) s
  WHERE registration_id IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION public.lims_dispatch_candidate_ids()
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(array_agg(DISTINCT registration_id), ARRAY[]::uuid[])
  FROM (
    SELECT registration_id FROM public.patient_results WHERE status = 'approved'
    UNION
    SELECT registration_id FROM public.outsourced_test_snips WHERE outsource_status = 'approved'
  ) s
  WHERE registration_id IS NOT NULL;
$$;

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
  LEFT JOIN tracked t
    ON t.registration_id = a.registration_id
   AND t.test_id = a.test_id
  WHERE a.test_id IS NOT NULL
    AND a.test_id <> ''
    AND t.test_id IS NULL;
$$;

CREATE OR REPLACE FUNCTION public.lims_filter_sort_registration_ids(
  p_ids uuid[],
  p_search text DEFAULT NULL,
  p_date_from timestamptz DEFAULT NULL,
  p_date_to timestamptz DEFAULT NULL
)
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    array_agg(id ORDER BY is_stat DESC NULLS LAST, invoice_number DESC),
    ARRAY[]::uuid[]
  )
  FROM public.patient_registrations
  WHERE id = ANY(COALESCE(p_ids, ARRAY[]::uuid[]))
    AND bill_cancelled = false
    AND (p_date_from IS NULL OR created_at >= p_date_from)
    AND (p_date_to IS NULL OR created_at <= p_date_to)
    AND (
      p_search IS NULL OR btrim(p_search) = '' OR
      patient_name ILIKE '%' || btrim(p_search) || '%' OR
      mobile_number ILIKE '%' || btrim(p_search) || '%' OR
      invoice_number ILIKE '%' || btrim(p_search) || '%' OR
      umr_number ILIKE '%' || btrim(p_search) || '%'
    );
$$;

REVOKE ALL ON FUNCTION public.lims_verification_candidate_ids() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.lims_doctor_approval_candidate_ids() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.lims_dispatch_candidate_ids() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.lims_results_entry_candidate_ids() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.lims_filter_sort_registration_ids(uuid[], text, timestamptz, timestamptz) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.lims_verification_candidate_ids() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.lims_doctor_approval_candidate_ids() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.lims_dispatch_candidate_ids() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.lims_results_entry_candidate_ids() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.lims_filter_sort_registration_ids(uuid[], text, timestamptz, timestamptz) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. RLS hardening
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT policyname, tablename
    FROM pg_policies
    WHERE schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, r.tablename);
  END LOOP;
END $$;

DO $$
DECLARE
  t text;
BEGIN
  FOR t IN
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated USING (true) WITH CHECK (true)',
      'staff_all_' || t,
      t
    );
  END LOOP;
END $$;

-- Portal / public report: anon read whitelist (share-token UX still uses anon key)
DO $$
DECLARE
  t text;
  portal_tables text[] := ARRAY[
    'report_share_links',
    'report_link_events',
    'report_link_sessions',
    'patient_registrations',
    'patient_results',
    'sample_tubes',
    'outsourced_test_snips',
    'approved_reports',
    'tests',
    'test_parameters',
    'report_test_parameters',
    'report_departments',
    'report_profiles',
    'report_layout_settings',
    'pathologist_signatures',
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
    'app_settings'
  ];
BEGIN
  FOREACH t IN ARRAY portal_tables
  LOOP
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = t) THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR SELECT TO anon USING (true)',
        'anon_select_' || t,
        t
      );
    END IF;
  END LOOP;
END $$;

-- Portal analytics writes (anon)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='report_link_events') THEN
    CREATE POLICY anon_insert_report_link_events ON public.report_link_events
      FOR INSERT TO anon WITH CHECK (true);
  END IF;
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='report_link_sessions') THEN
    CREATE POLICY anon_insert_report_link_sessions ON public.report_link_sessions
      FOR INSERT TO anon WITH CHECK (true);
    CREATE POLICY anon_update_report_link_sessions ON public.report_link_sessions
      FOR UPDATE TO anon USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Explicit: no anon access to credentials / staff admin tables (drop any accidental select)
DROP POLICY IF EXISTS anon_select_app_settings ON public.app_settings;
-- Keep auth_epoch readable so pre-login epoch checks can work without JWT when needed
CREATE POLICY anon_select_app_settings_epoch ON public.app_settings
  FOR SELECT TO anon
  USING (setting_key = 'auth_epoch');

-- Ensure role privileges match RLS intent
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated, service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated, service_role;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
GRANT SELECT ON
  public.report_share_links,
  public.report_link_events,
  public.report_link_sessions,
  public.patient_registrations,
  public.patient_results,
  public.sample_tubes,
  public.outsourced_test_snips,
  public.approved_reports,
  public.tests,
  public.test_parameters,
  public.report_test_parameters,
  public.report_departments,
  public.report_profiles,
  public.report_layout_settings,
  public.pathologist_signatures,
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
  public.app_settings
TO anon;

GRANT INSERT ON public.report_link_events, public.report_link_sessions TO anon;
GRANT UPDATE ON public.report_link_sessions TO anon;

-- Never expose password hashes to anon
REVOKE ALL ON public.app_users FROM anon;
REVOKE ALL ON public.app_roles FROM anon;
REVOKE ALL ON public.app_user_login_history FROM anon;
REVOKE ALL ON public.payment_transactions FROM anon;
