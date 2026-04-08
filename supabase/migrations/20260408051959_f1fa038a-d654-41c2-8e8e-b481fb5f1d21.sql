
ALTER TABLE public.tests ADD COLUMN is_active boolean NOT NULL DEFAULT true;
ALTER TABLE public.health_checkups ADD COLUMN is_active boolean NOT NULL DEFAULT true;
ALTER TABLE public.billing_profiles ADD COLUMN is_active boolean NOT NULL DEFAULT true;
ALTER TABLE public.report_test_parameters ADD COLUMN is_active boolean NOT NULL DEFAULT true;
