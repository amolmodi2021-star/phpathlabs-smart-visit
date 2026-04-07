
-- Create junction table linking tests to report_test_parameters
CREATE TABLE public.test_parameters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  test_id uuid NOT NULL REFERENCES public.tests(id) ON DELETE CASCADE,
  parameter_id uuid NOT NULL REFERENCES public.report_test_parameters(id) ON DELETE CASCADE,
  display_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  UNIQUE(test_id, parameter_id)
);

-- Enable RLS
ALTER TABLE public.test_parameters ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all on test_parameters"
  ON public.test_parameters FOR ALL
  USING (true) WITH CHECK (true);

-- Add param_code to report_test_parameters
ALTER TABLE public.report_test_parameters ADD COLUMN IF NOT EXISTS param_code text;

-- Create sequence for param codes
CREATE SEQUENCE IF NOT EXISTS param_code_seq START 1;

-- Backfill existing parameters with param codes in alphabetical order
WITH numbered AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY parameter_name) AS rn
  FROM public.report_test_parameters
  WHERE param_code IS NULL
)
UPDATE public.report_test_parameters rtp
SET param_code = 'PRM' || lpad(n.rn::text, 4, '0')
FROM numbered n
WHERE rtp.id = n.id;

-- Advance the sequence past the backfilled values
SELECT setval('param_code_seq', COALESCE((SELECT COUNT(*) FROM public.report_test_parameters WHERE param_code IS NOT NULL), 0));

-- Create trigger function for auto-assigning param_code
CREATE OR REPLACE FUNCTION public.auto_assign_param_code()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.param_code IS NULL OR NEW.param_code = '' THEN
    NEW.param_code := 'PRM' || lpad(nextval('param_code_seq')::text, 4, '0');
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_auto_param_code
  BEFORE INSERT ON public.report_test_parameters
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_assign_param_code();
