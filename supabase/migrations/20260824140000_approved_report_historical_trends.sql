-- Freeze Historical Trends onto approved_reports so reopening years later
-- shows the same graphs (values come from approved snapshots, not live patient_results).
ALTER TABLE public.approved_reports
  ADD COLUMN IF NOT EXISTS historical_trends jsonb;

COMMENT ON COLUMN public.approved_reports.historical_trends IS
  'Frozen Historical Trends series for PDF (last ≤5 snapshot points per analytics param). Immutable after first save.';
