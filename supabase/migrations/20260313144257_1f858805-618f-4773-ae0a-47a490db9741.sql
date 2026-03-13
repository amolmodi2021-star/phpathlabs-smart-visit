CREATE TABLE public.extraction_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parameter_name text NOT NULL,
  field_corrected text NOT NULL,
  original_value text,
  corrected_value text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.extraction_corrections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all on extraction_corrections"
  ON public.extraction_corrections
  FOR ALL
  TO public
  USING (true)
  WITH CHECK (true);

CREATE INDEX idx_extraction_corrections_param ON public.extraction_corrections (parameter_name, field_corrected, created_at DESC);