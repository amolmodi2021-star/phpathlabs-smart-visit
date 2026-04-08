ALTER TABLE public.report_test_parameters
ADD COLUMN custom_sample_suffix_enabled boolean NOT NULL DEFAULT false,
ADD COLUMN custom_sample_suffix text;