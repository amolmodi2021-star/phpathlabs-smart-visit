
ALTER TABLE public.tests
  ADD COLUMN IF NOT EXISTS is_outsourced boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS outsourced_caption text,
  ADD COLUMN IF NOT EXISTS department_id uuid REFERENCES public.report_departments(id) ON DELETE SET NULL;
