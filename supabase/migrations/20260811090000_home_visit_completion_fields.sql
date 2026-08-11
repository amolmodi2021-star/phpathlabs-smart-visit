-- Fields captured at Complete Missing Details (before LIMS registration).
ALTER TABLE public.home_visits
  ADD COLUMN IF NOT EXISTS is_stat boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS report_language text NOT NULL DEFAULT 'English',
  ADD COLUMN IF NOT EXISTS completion_receipt_number text;

COMMENT ON COLUMN public.home_visits.is_stat IS
  'STAT flag chosen at Complete Missing Details; copied into patient_registrations on register.';
COMMENT ON COLUMN public.home_visits.report_language IS
  'Report language chosen at Complete Missing Details; copied on register.';
COMMENT ON COLUMN public.home_visits.completion_receipt_number IS
  'HVR receipt number shown on completion invoice (not LIMS invoice).';
