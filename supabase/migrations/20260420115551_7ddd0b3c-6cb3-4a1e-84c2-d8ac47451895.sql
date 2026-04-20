-- Sequence for combo codes
CREATE SEQUENCE IF NOT EXISTS combo_code_seq START 1;

-- Combos table
CREATE TABLE public.combos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  combo_code text UNIQUE,
  combo_name text NOT NULL,
  display_name text,
  price numeric NOT NULL DEFAULT 0,
  fasting_required boolean NOT NULL DEFAULT false,
  discount_applicable boolean NOT NULL DEFAULT false,
  bold_in_report boolean NOT NULL DEFAULT true,
  show_in_report boolean NOT NULL DEFAULT true,
  incentive_allowed boolean NOT NULL DEFAULT false,
  incentive_amount numeric NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Junction: combo -> tests
CREATE TABLE public.combo_tests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  combo_id uuid NOT NULL REFERENCES public.combos(id) ON DELETE CASCADE,
  test_id uuid NOT NULL,
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX idx_combo_tests_combo_id ON public.combo_tests(combo_id);

-- Junction: combo -> profiles
CREATE TABLE public.combo_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  combo_id uuid NOT NULL REFERENCES public.combos(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL,
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX idx_combo_profiles_combo_id ON public.combo_profiles(combo_id);

-- Auto-code trigger
CREATE OR REPLACE FUNCTION public.auto_assign_combo_code()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.combo_code IS NULL OR NEW.combo_code = '' THEN
    NEW.combo_code := 'CMB' || lpad(nextval('combo_code_seq')::text, 4, '0');
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_auto_assign_combo_code
BEFORE INSERT ON public.combos
FOR EACH ROW EXECUTE FUNCTION public.auto_assign_combo_code();

-- updated_at trigger
CREATE TRIGGER trg_combos_updated_at
BEFORE UPDATE ON public.combos
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- RLS (open, matches sibling tables)
ALTER TABLE public.combos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.combo_tests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.combo_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all on combos" ON public.combos FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on combo_tests" ON public.combo_tests FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on combo_profiles" ON public.combo_profiles FOR ALL USING (true) WITH CHECK (true);