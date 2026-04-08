
ALTER TABLE public.report_test_parameters
  ADD COLUMN unit_conversion_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN unit_conversion_operator text NOT NULL DEFAULT '*',
  ADD COLUMN unit_conversion_value numeric NULL;
