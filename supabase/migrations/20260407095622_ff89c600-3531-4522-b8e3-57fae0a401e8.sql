
ALTER TABLE public.patient_registrations
  ADD COLUMN refund_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN refund_mode text,
  ADD COLUMN refund_date timestamp with time zone,
  ADD COLUMN cancelled_tests jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN bill_cancelled boolean NOT NULL DEFAULT false;
