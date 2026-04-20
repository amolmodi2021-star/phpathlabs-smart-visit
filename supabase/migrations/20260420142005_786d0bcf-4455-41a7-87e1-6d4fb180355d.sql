ALTER TABLE public.pickup_points
  ADD COLUMN IF NOT EXISTS allow_all_tests boolean NOT NULL DEFAULT false;