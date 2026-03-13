
ALTER TABLE public.report_profiles
  ADD COLUMN IF NOT EXISTS sample_type TEXT,
  ADD COLUMN IF NOT EXISTS is_outsourced BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS outsourced_caption TEXT,
  ADD COLUMN IF NOT EXISTS interpretation TEXT;

ALTER TABLE public.report_test_parameters
  ADD COLUMN IF NOT EXISTS sample_type TEXT,
  ADD COLUMN IF NOT EXISTS is_outsourced BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS outsourced_caption TEXT,
  ADD COLUMN IF NOT EXISTS interpretation TEXT;
