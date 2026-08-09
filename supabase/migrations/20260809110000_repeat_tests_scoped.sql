-- Track which specific tests are awaiting repeat collection (not the whole bill).
ALTER TABLE public.patient_registrations
  ADD COLUMN IF NOT EXISTS repeat_tests jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.patient_registrations.repeat_tests IS
  'Tests explicitly sent back for re-collection: [{test_id, test_name, requested_at, requested_by}]. Cleared as those tests leave pending.';
