
-- UMR counter table
CREATE TABLE public.umr_counter (
  counter_key text PRIMARY KEY DEFAULT 'main',
  last_sequence integer NOT NULL DEFAULT 0
);

ALTER TABLE public.umr_counter ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on umr_counter" ON public.umr_counter FOR ALL USING (true) WITH CHECK (true);

-- Seed with initial row
INSERT INTO public.umr_counter (counter_key, last_sequence) VALUES ('main', 0);

-- Function to generate next UMR
CREATE OR REPLACE FUNCTION public.generate_umr_number()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  seq integer;
BEGIN
  UPDATE umr_counter SET last_sequence = last_sequence + 1 WHERE counter_key = 'main' RETURNING last_sequence INTO seq;
  RETURN 'UMR' || lpad(seq::text, 7, '0');
END;
$$;
