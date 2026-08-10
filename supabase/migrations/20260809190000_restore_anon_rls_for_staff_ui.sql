-- Staff LIMS uses the anon API key for PostgREST (custom JWT is not project-signed).
-- Security hardening left only authenticated staff_* policies, so masters/PHI became invisible.
-- Restore anon policies for operational tables; staff login remains the app-level gate.

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'abnormal_card_templates',
    'app_roles',
    'app_settings',
    'app_user_login_history',
    'app_users',
    'approved_reports',
    'billing_profile_tests',
    'billing_profiles',
    'channel_prices',
    'channels',
    'cloudinary_accounts',
    'combo_profiles',
    'combo_tests',
    'combos',
    'doctors',
    'estimate_tests',
    'estimates',
    'health_checkup_profiles',
    'health_checkup_tests',
    'health_checkups',
    'home_visits',
    'invoice_counter',
    'lims_code_mapping',
    'lims_interface_logs',
    'lims_no_map_required',
    'lims_result_notify',
    'lims_test_orders',
    'lims_unmapped_results',
    'loyalty_card_templates',
    'marketing_templates',
    'master_lookup',
    'message_templates',
    'outsourced_test_snips',
    'parameter_normal_ranges',
    'pathologist_signatures',
    'patient_master',
    'patient_registrations',
    'patient_results',
    'payment_transactions',
    'phlebotomist_leaves',
    'phlebotomists',
    'pickup_point_invoice_items',
    'pickup_point_invoice_payments',
    'pickup_point_invoices',
    'pickup_point_prices',
    'pickup_points',
    'profile_parameters',
    'report_departments',
    'report_layout_settings',
    'report_link_events',
    'report_link_sessions',
    'report_profiles',
    'report_share_links',
    'report_templates',
    'report_test_parameters',
    'sample_tube_counter',
    'sample_tubes',
    'standard_price_list_items',
    'standard_price_lists',
    'test_parameters',
    'test_sample_tubes',
    'tests',
    'umr_counter',
    'webhook_messages',
    'whatsapp_console_outbox'
  ];
BEGIN
  FOREACH t IN ARRAY tables
  LOOP
    IF EXISTS (
      SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO anon', t);
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'anon_all_' || t, t);
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR ALL TO anon USING (true) WITH CHECK (true)',
        'anon_all_' || t,
        t
      );
    END IF;
  END LOOP;
END $$;