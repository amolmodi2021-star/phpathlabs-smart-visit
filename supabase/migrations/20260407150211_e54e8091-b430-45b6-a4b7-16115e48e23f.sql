ALTER TABLE public.parameter_normal_ranges
ADD COLUMN descriptive_options jsonb DEFAULT '[]'::jsonb;