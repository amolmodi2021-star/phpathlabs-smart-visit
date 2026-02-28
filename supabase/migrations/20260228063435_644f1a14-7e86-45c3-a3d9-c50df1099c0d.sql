
ALTER TABLE public.tests
ADD COLUMN incentive_allowed boolean NOT NULL DEFAULT false,
ADD COLUMN incentive_amount numeric NOT NULL DEFAULT 0;
