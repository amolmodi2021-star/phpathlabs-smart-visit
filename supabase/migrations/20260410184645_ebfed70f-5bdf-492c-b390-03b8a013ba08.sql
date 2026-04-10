ALTER TABLE public.patient_results
  ADD COLUMN IF NOT EXISTS entered_at timestamptz,
  ADD COLUMN IF NOT EXISTS verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS dispatched_at timestamptz;