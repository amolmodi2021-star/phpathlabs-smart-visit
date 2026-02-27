
ALTER TABLE public.home_visits
  ADD COLUMN paid_amount numeric DEFAULT 0,
  ADD COLUMN due_amount numeric DEFAULT 0,
  ADD COLUMN payment_mode text DEFAULT NULL,
  ADD COLUMN payment_remarks text DEFAULT NULL;
