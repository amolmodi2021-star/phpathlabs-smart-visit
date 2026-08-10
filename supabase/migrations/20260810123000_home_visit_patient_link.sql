-- Persist which LIMS patient a home visit belongs to (same mobile can have many UMRs).
-- UMR itself is still allocated only at LIMS registration save for new patients.
ALTER TABLE public.home_visits
  ADD COLUMN IF NOT EXISTS linked_umr_number text,
  ADD COLUMN IF NOT EXISTS register_as_new_patient boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.home_visits.linked_umr_number IS
  'Existing patient_master UMR chosen at Complete Missing Details. Null when register_as_new_patient.';
COMMENT ON COLUMN public.home_visits.register_as_new_patient IS
  'True = allocate a new UMR at LIMS registration save (concurrent-safe).';
