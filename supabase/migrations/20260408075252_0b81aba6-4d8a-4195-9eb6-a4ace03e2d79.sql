
CREATE TABLE public.master_lookup (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  category text NOT NULL,
  value text NOT NULL,
  display_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(category, value)
);

ALTER TABLE public.master_lookup ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all on master_lookup" ON public.master_lookup FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX idx_master_lookup_category ON public.master_lookup (category, display_order);
