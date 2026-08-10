-- Re-enable Realtime for LIMS pipeline tables (several were trimmed earlier for cost).
-- Needed so queue membership, cancellations, holds, and result values sync live.

DO $$
DECLARE
  t text;
  tables_to_add text[] := ARRAY[
    'patient_registrations',
    'sample_tubes',
    'patient_results',
    'outsourced_test_snips',
    'approved_reports',
    'lims_result_notify',
    'whatsapp_console_outbox'
  ];
BEGIN
  FOREACH t IN ARRAY tables_to_add LOOP
    BEGIN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    EXCEPTION
      WHEN duplicate_object THEN NULL;
      WHEN undefined_table THEN NULL;
      WHEN OTHERS THEN NULL;
    END;
  END LOOP;
END $$;
