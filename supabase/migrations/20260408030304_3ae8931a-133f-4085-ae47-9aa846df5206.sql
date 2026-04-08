
ALTER TABLE public.report_test_parameters
  ADD COLUMN IF NOT EXISTS machine_id text,
  ADD COLUMN IF NOT EXISTS machine_name text,
  ADD COLUMN IF NOT EXISTS send_for_interface boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS is_calculated boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS calculation_formula jsonb DEFAULT '[]'::jsonb;
