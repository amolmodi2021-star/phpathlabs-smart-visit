
-- Add new columns
ALTER TABLE public.tests
  ADD COLUMN IF NOT EXISTS display_name text,
  ADD COLUMN IF NOT EXISTS bold_in_report boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS show_in_report boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS is_single_parameter boolean NOT NULL DEFAULT false;

-- Create a sequence for test codes
CREATE SEQUENCE IF NOT EXISTS test_code_seq START 1;

-- Auto-populate test_code for existing tests that don't have one
WITH numbered AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY test_name) AS rn
  FROM public.tests
  WHERE test_code IS NULL OR test_code = ''
)
UPDATE public.tests t
SET test_code = 'TST' || lpad(n.rn::text, 4, '0')
FROM numbered n
WHERE t.id = n.id;

-- Set sequence to max existing code number (safe on empty table)
DO $$
DECLARE
  m int;
BEGIN
  SELECT COALESCE(MAX(NULLIF(regexp_replace(test_code, '[^0-9]', '', 'g'), '')::int), 0)
  INTO m FROM public.tests;
  IF m < 1 THEN
    PERFORM setval('test_code_seq', 1, false);
  ELSE
    PERFORM setval('test_code_seq', m, true);
  END IF;
END $$;

-- Create trigger function to auto-assign test_code on insert
CREATE OR REPLACE FUNCTION public.auto_assign_test_code()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.test_code IS NULL OR NEW.test_code = '' THEN
    NEW.test_code := 'TST' || lpad(nextval('test_code_seq')::text, 4, '0');
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_auto_test_code
  BEFORE INSERT ON public.tests
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_assign_test_code();
