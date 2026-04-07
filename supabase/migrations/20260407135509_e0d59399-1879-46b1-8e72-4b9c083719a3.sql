
ALTER TABLE public.tests
  ADD COLUMN IF NOT EXISTS instrument_name text,
  ADD COLUMN IF NOT EXISTS method text,
  ADD COLUMN IF NOT EXISTS sample_type text,
  ADD COLUMN IF NOT EXISTS interpretation text;
