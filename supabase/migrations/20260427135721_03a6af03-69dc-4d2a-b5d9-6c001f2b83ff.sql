ALTER TABLE public.tests ADD COLUMN IF NOT EXISTS report_display_order integer;

-- Backfill: assign per-department order based on current alphabetical sort
WITH ordered AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY department_id ORDER BY test_name) AS rn
  FROM public.tests
)
UPDATE public.tests t
SET report_display_order = o.rn
FROM ordered o
WHERE t.id = o.id AND t.report_display_order IS NULL;

CREATE INDEX IF NOT EXISTS idx_tests_dept_order
  ON public.tests (department_id, report_display_order);