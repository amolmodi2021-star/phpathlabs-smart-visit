
ALTER TABLE public.outsourced_test_snips
  ADD COLUMN IF NOT EXISTS outsourced_lab_name text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS outsource_status text NOT NULL DEFAULT 'pending';
