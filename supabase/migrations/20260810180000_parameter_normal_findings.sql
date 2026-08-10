-- Descriptive ranges: Display Text (normal_range_text) is for report reference only.
-- normal_findings is used only for result highlighting (flag X), not shown on PDF.
ALTER TABLE public.parameter_normal_ranges
  ADD COLUMN IF NOT EXISTS normal_findings text;

-- Preserve prior highlight behaviour for existing descriptive rows that only had Display Text.
UPDATE public.parameter_normal_ranges
SET normal_findings = normal_range_text
WHERE range_type = 'descriptive'
  AND COALESCE(TRIM(normal_findings), '') = ''
  AND COALESCE(TRIM(normal_range_text), '') <> '';
