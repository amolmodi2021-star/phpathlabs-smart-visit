-- Backfill: strip trailing unit suffix from interface-imported numeric result_values
-- Pattern: number + whitespace + non-numeric tail containing letters/*/ -> keep only the number head.
UPDATE public.patient_results
SET
  result_value = regexp_replace(result_value, '^([+-]?[0-9]+(\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)\s+.*$', '\1'),
  updated_at = now()
WHERE is_from_interface = true
  AND result_value ~ '^[+-]?[0-9]+(\.[0-9]+)?(?:[eE][+-]?[0-9]+)?\s+.*[A-Za-z*/].*$';
