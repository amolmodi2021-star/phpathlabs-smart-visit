ALTER TABLE public.parameter_normal_ranges
ADD COLUMN range_type text NOT NULL DEFAULT 'numeric',
ADD COLUMN expected_value text;