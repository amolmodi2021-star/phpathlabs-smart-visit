ALTER TABLE public.estimate_tests
ADD COLUMN IF NOT EXISTS item_type text NOT NULL DEFAULT 'test';