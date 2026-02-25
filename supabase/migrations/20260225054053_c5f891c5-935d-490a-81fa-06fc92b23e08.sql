
-- Tests table
CREATE TABLE public.tests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  test_name TEXT NOT NULL,
  price NUMERIC(10,2) NOT NULL DEFAULT 0,
  fasting_required BOOLEAN NOT NULL DEFAULT false,
  discount_applicable BOOLEAN NOT NULL DEFAULT true,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Phlebotomists table
CREATE TABLE public.phlebotomists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  mobile TEXT NOT NULL,
  alternate_mobile TEXT,
  area_zone TEXT,
  status TEXT NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Inactive')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Estimates table
CREATE TABLE public.estimates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_name TEXT,
  whatsapp_number TEXT NOT NULL,
  total_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  discount_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  home_visit_charges NUMERIC(10,2) NOT NULL DEFAULT 0,
  final_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  global_discount_type TEXT CHECK (global_discount_type IN ('percent', 'amount')),
  global_discount_value NUMERIC(10,2) DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'Estimate Created' CHECK (status IN ('Estimate Created', 'Home Visit Booked')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Estimate tests (junction)
CREATE TABLE public.estimate_tests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  estimate_id UUID NOT NULL REFERENCES public.estimates(id) ON DELETE CASCADE,
  test_id UUID NOT NULL REFERENCES public.tests(id) ON DELETE CASCADE,
  test_name TEXT NOT NULL,
  price NUMERIC(10,2) NOT NULL,
  fasting_required BOOLEAN NOT NULL DEFAULT false,
  discount_applicable BOOLEAN NOT NULL DEFAULT true,
  individual_discount_type TEXT CHECK (individual_discount_type IN ('percent', 'amount')),
  individual_discount_value NUMERIC(10,2) DEFAULT 0,
  discounted_price NUMERIC(10,2) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Home visits table
CREATE TABLE public.home_visits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  estimate_id UUID NOT NULL REFERENCES public.estimates(id) ON DELETE CASCADE,
  visit_date DATE NOT NULL,
  visit_time TEXT NOT NULL,
  address TEXT NOT NULL,
  phlebotomist_id UUID REFERENCES public.phlebotomists(id),
  status TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Completed', 'Cancelled')),
  cancellation_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Message templates
CREATE TABLE public.message_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_key TEXT NOT NULL UNIQUE,
  template_value TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Insert default message templates
INSERT INTO public.message_templates (template_key, template_value) VALUES
  ('estimate_header', 'PH PathLabs - Estimate'),
  ('visit_confirmation_header', 'PH PathLabs - Visit Confirmation'),
  ('fasting_instructions', '8 to 10 hours of fasting is required.'),
  ('home_visit_disclaimer', 'Home visit charges are not included and will be charged extra depending on your area of visit.'),
  ('footer_text', 'LabLine : 6356 55 66 99\nPH PathLabs - Vesu');

-- Enable RLS on all tables
ALTER TABLE public.tests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.phlebotomists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.estimates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.estimate_tests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.home_visits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_templates ENABLE ROW LEVEL SECURITY;

-- Since this is a single-user fixed-credential app, allow all operations for anyone
-- The app itself handles auth via hardcoded credentials
CREATE POLICY "Allow all on tests" ON public.tests FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on phlebotomists" ON public.phlebotomists FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on estimates" ON public.estimates FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on estimate_tests" ON public.estimate_tests FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on home_visits" ON public.home_visits FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on message_templates" ON public.message_templates FOR ALL USING (true) WITH CHECK (true);

-- Updated_at trigger function
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Attach triggers
CREATE TRIGGER update_tests_updated_at BEFORE UPDATE ON public.tests FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_phlebotomists_updated_at BEFORE UPDATE ON public.phlebotomists FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_estimates_updated_at BEFORE UPDATE ON public.estimates FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_home_visits_updated_at BEFORE UPDATE ON public.home_visits FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_message_templates_updated_at BEFORE UPDATE ON public.message_templates FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
