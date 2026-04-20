-- 1. Create junction table
CREATE TABLE public.test_sample_tubes (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  test_id uuid NOT NULL REFERENCES public.tests(id) ON DELETE CASCADE,
  tube_value text NOT NULL,
  sample_type text,
  tube_color text,
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX idx_test_sample_tubes_test_id ON public.test_sample_tubes(test_id);

-- 2. Enable RLS with open policy (matches rest of project)
ALTER TABLE public.test_sample_tubes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all on test_sample_tubes"
ON public.test_sample_tubes
FOR ALL
USING (true)
WITH CHECK (true);

-- 3. Backfill existing single-tube data from tests table
INSERT INTO public.test_sample_tubes (test_id, tube_value, sample_type, tube_color, display_order)
SELECT id, sample_tube, sample_type, tube_color, 0
FROM public.tests
WHERE sample_tube IS NOT NULL AND sample_tube <> '';