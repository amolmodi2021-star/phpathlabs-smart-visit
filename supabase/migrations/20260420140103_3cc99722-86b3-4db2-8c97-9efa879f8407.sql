CREATE TABLE public.standard_price_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.standard_price_list_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  price_list_id uuid NOT NULL REFERENCES public.standard_price_lists(id) ON DELETE CASCADE,
  test_id uuid NOT NULL,
  custom_price numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(price_list_id, test_id)
);

CREATE INDEX idx_spli_list ON public.standard_price_list_items(price_list_id);
CREATE INDEX idx_spli_test ON public.standard_price_list_items(test_id);

ALTER TABLE public.standard_price_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.standard_price_list_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all on standard_price_lists" ON public.standard_price_lists FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on standard_price_list_items" ON public.standard_price_list_items FOR ALL USING (true) WITH CHECK (true);

CREATE TRIGGER update_standard_price_lists_updated_at
  BEFORE UPDATE ON public.standard_price_lists
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();