
CREATE TABLE public.parameter_normal_ranges (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  parameter_id UUID NOT NULL REFERENCES public.report_test_parameters(id) ON DELETE CASCADE,
  gender TEXT NOT NULL DEFAULT 'all',
  age_min NUMERIC,
  age_max NUMERIC,
  normal_range_low NUMERIC,
  normal_range_high NUMERIC,
  normal_range_text TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.parameter_normal_ranges ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all on parameter_normal_ranges"
ON public.parameter_normal_ranges
FOR ALL
USING (true)
WITH CHECK (true);

CREATE INDEX idx_parameter_normal_ranges_param ON public.parameter_normal_ranges(parameter_id);

ALTER TABLE public.report_test_parameters
  ADD COLUMN IF NOT EXISTS use_global_normal_range BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS same_for_gender BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS same_for_all_ages BOOLEAN NOT NULL DEFAULT true;
