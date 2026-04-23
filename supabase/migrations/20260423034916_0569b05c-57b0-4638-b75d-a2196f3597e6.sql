-- Drop the obsolete intermediate table; interface now writes patient_results directly.
-- (Mapped results were being mirrored into both tables — keeping only patient_results halves write volume.)
DROP TABLE IF EXISTS public.lims_test_results CASCADE;

-- Stop broadcasting writes from these high-churn tables to every connected tab.
-- (Tables remain — only the realtime fan-out is removed.)
DO $$
BEGIN
  -- Each ALTER PUBLICATION ... DROP TABLE errors if the table isn't a member, so guard each one.
  BEGIN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.message_send_log;
  EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.lims_interface_logs;
  EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.lims_unmapped_results;
  EXCEPTION WHEN OTHERS THEN NULL; END;
END $$;