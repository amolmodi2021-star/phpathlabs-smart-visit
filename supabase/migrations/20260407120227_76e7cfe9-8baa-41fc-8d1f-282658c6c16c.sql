ALTER TABLE public.patient_registrations
ADD COLUMN remarks text DEFAULT NULL,
ADD COLUMN is_stat boolean NOT NULL DEFAULT false;