
-- Sequence for health checkup codes
CREATE SEQUENCE IF NOT EXISTS health_checkup_code_seq START 1;

-- Health Check-Ups table
CREATE TABLE public.health_checkups (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  health_checkup_code TEXT,
  health_checkup_name TEXT NOT NULL,
  display_name TEXT,
  price NUMERIC NOT NULL DEFAULT 0,
  fasting_required BOOLEAN NOT NULL DEFAULT true,
  discount_applicable BOOLEAN NOT NULL DEFAULT false,
  bold_in_report BOOLEAN NOT NULL DEFAULT true,
  show_in_report BOOLEAN NOT NULL DEFAULT true,
  incentive_allowed BOOLEAN NOT NULL DEFAULT false,
  incentive_amount NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.health_checkups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on health_checkups" ON public.health_checkups FOR ALL USING (true) WITH CHECK (true);

-- Auto-assign HLT code
CREATE OR REPLACE FUNCTION public.auto_assign_health_checkup_code()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.health_checkup_code IS NULL OR NEW.health_checkup_code = '' THEN
    NEW.health_checkup_code := 'HLT' || lpad(nextval('health_checkup_code_seq')::text, 4, '0');
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_auto_health_checkup_code
  BEFORE INSERT ON public.health_checkups
  FOR EACH ROW EXECUTE FUNCTION public.auto_assign_health_checkup_code();

-- Health Check-Up Tests junction
CREATE TABLE public.health_checkup_tests (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  health_checkup_id UUID NOT NULL REFERENCES public.health_checkups(id) ON DELETE CASCADE,
  test_id UUID NOT NULL REFERENCES public.tests(id) ON DELETE CASCADE,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.health_checkup_tests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on health_checkup_tests" ON public.health_checkup_tests FOR ALL USING (true) WITH CHECK (true);

-- Sequence for profile codes
CREATE SEQUENCE IF NOT EXISTS billing_profile_code_seq START 1;

-- Billing Profiles table
CREATE TABLE public.billing_profiles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  profile_code TEXT,
  profile_name TEXT NOT NULL,
  display_name TEXT,
  price NUMERIC NOT NULL DEFAULT 0,
  department_id UUID REFERENCES public.report_departments(id),
  fasting_required BOOLEAN NOT NULL DEFAULT false,
  discount_applicable BOOLEAN NOT NULL DEFAULT false,
  is_outsourced BOOLEAN NOT NULL DEFAULT false,
  bold_in_report BOOLEAN NOT NULL DEFAULT true,
  show_in_report BOOLEAN NOT NULL DEFAULT true,
  instrument_name TEXT,
  method TEXT,
  sample_type TEXT,
  interpretation TEXT,
  description TEXT,
  incentive_allowed BOOLEAN NOT NULL DEFAULT false,
  incentive_amount NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.billing_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on billing_profiles" ON public.billing_profiles FOR ALL USING (true) WITH CHECK (true);

-- Auto-assign PRL code
CREATE OR REPLACE FUNCTION public.auto_assign_profile_code()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.profile_code IS NULL OR NEW.profile_code = '' THEN
    NEW.profile_code := 'PRL' || lpad(nextval('billing_profile_code_seq')::text, 4, '0');
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_auto_profile_code
  BEFORE INSERT ON public.billing_profiles
  FOR EACH ROW EXECUTE FUNCTION public.auto_assign_profile_code();

-- Billing Profile Tests junction
CREATE TABLE public.billing_profile_tests (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  profile_id UUID NOT NULL REFERENCES public.billing_profiles(id) ON DELETE CASCADE,
  test_id UUID NOT NULL REFERENCES public.tests(id) ON DELETE CASCADE,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.billing_profile_tests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on billing_profile_tests" ON public.billing_profile_tests FOR ALL USING (true) WITH CHECK (true);
