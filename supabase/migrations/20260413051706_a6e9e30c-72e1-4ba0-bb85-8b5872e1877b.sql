
-- Add registered_by to patient_registrations
ALTER TABLE public.patient_registrations ADD COLUMN IF NOT EXISTS registered_by text;

-- Add collected_by and accepted_by to sample_tubes
ALTER TABLE public.sample_tubes ADD COLUMN IF NOT EXISTS collected_by text;
ALTER TABLE public.sample_tubes ADD COLUMN IF NOT EXISTS accepted_by text;

-- Add verified_by, approved_by, dispatched_by to patient_results
ALTER TABLE public.patient_results ADD COLUMN IF NOT EXISTS verified_by text;
ALTER TABLE public.patient_results ADD COLUMN IF NOT EXISTS approved_by text;
ALTER TABLE public.patient_results ADD COLUMN IF NOT EXISTS dispatched_by text;
