ALTER TABLE public.patient_master
  ADD COLUMN IF NOT EXISTS title text,
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'lims',
  ADD COLUMN IF NOT EXISTS legacy_imported_at timestamptz;

ALTER TABLE public.patient_master DROP COLUMN IF EXISTS ref_doctor;

CREATE UNIQUE INDEX IF NOT EXISTS patient_master_umr_id_uniq ON public.patient_master(umr_id);
CREATE INDEX IF NOT EXISTS patient_master_mobile_idx ON public.patient_master(mobile_number);