-- Audit stamps for snip-only outsourced tests (shown on Dispatch timeline)
ALTER TABLE public.outsourced_test_snips
  ADD COLUMN IF NOT EXISTS entered_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS entered_by text NULL,
  ADD COLUMN IF NOT EXISTS verified_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS verified_by text NULL,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS approved_by text NULL,
  ADD COLUMN IF NOT EXISTS dispatched_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS dispatched_by text NULL;

-- Backfill approved stamp from approved_reports where missing (snip-only history)
UPDATE public.outsourced_test_snips o
SET
  approved_by = COALESCE(o.approved_by, ar.approved_by),
  approved_at = COALESCE(o.approved_at, ar.approval_date)
FROM public.approved_reports ar
WHERE ar.registration_id = o.registration_id
  AND o.outsource_status IN ('approved', 'dispatched')
  AND (o.approved_by IS NULL OR o.approved_at IS NULL);
