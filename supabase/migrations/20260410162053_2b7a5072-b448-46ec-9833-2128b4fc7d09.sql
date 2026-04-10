
-- Create sample_tubes table
CREATE TABLE public.sample_tubes (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  sample_uid text UNIQUE NOT NULL,
  registration_id uuid NOT NULL REFERENCES public.patient_registrations(id) ON DELETE CASCADE,
  tube_type text,
  tube_color text,
  sample_type text,
  suffix text,
  test_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  test_names jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'pending',
  collected_at timestamp with time zone,
  accepted_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.sample_tubes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all on sample_tubes"
ON public.sample_tubes
FOR ALL
USING (true)
WITH CHECK (true);

-- Create index for fast lookups
CREATE INDEX idx_sample_tubes_registration_id ON public.sample_tubes(registration_id);
CREATE INDEX idx_sample_tubes_status ON public.sample_tubes(status);

-- Create sample_tube_counter table
CREATE TABLE public.sample_tube_counter (
  date_key text NOT NULL PRIMARY KEY,
  last_sequence integer NOT NULL DEFAULT 0
);

ALTER TABLE public.sample_tube_counter ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all on sample_tube_counter"
ON public.sample_tube_counter
FOR ALL
USING (true)
WITH CHECK (true);

-- Create generate_sample_uid function
CREATE OR REPLACE FUNCTION public.generate_sample_uid()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  today text := to_char(CURRENT_DATE, 'YYMMDD');
  seq integer;
BEGIN
  INSERT INTO sample_tube_counter (date_key, last_sequence)
  VALUES (today, 1)
  ON CONFLICT (date_key) DO UPDATE SET last_sequence = sample_tube_counter.last_sequence + 1
  RETURNING last_sequence INTO seq;
  RETURN 'S' || today || lpad(seq::text, 5, '0');
END;
$$;

-- Enable realtime for sample_tubes
ALTER PUBLICATION supabase_realtime ADD TABLE public.sample_tubes;
