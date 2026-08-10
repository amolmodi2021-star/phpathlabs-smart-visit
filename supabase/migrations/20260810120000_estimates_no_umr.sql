-- Estimates must not participate in UMR allocation or store UMR numbers.
CREATE OR REPLACE FUNCTION public.generate_umr_number()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_counter int;
  v_max_pm  int;
  v_max_pr  int;
  v_next    int;
BEGIN
  INSERT INTO public.umr_counter (counter_key, last_sequence)
  VALUES ('main', 0)
  ON CONFLICT (counter_key) DO NOTHING;

  SELECT last_sequence INTO v_counter
  FROM public.umr_counter
  WHERE counter_key = 'main'
  FOR UPDATE;

  SELECT COALESCE(MAX(NULLIF(regexp_replace(umr_id,     '\D', '', 'g'), '')::int), 0)
    INTO v_max_pm
  FROM public.patient_master
  WHERE umr_id ~ '^UMR\d+$';

  SELECT COALESCE(MAX(NULLIF(regexp_replace(umr_number, '\D', '', 'g'), '')::int), 0)
    INTO v_max_pr
  FROM public.patient_registrations
  WHERE umr_number ~ '^UMR\d+$';

  v_next := GREATEST(COALESCE(v_counter, 0), v_max_pm, v_max_pr) + 1;

  UPDATE public.umr_counter
  SET last_sequence = v_next
  WHERE counter_key = 'main';

  RETURN 'UMR' || lpad(v_next::text, 7, '0');
END;
$$;

UPDATE public.estimates
SET umr_number = NULL
WHERE umr_number IS NOT NULL;

UPDATE public.umr_counter
SET last_sequence = GREATEST(
  last_sequence,
  COALESCE((SELECT MAX(NULLIF(regexp_replace(umr_id,     '\D', '', 'g'), '')::int) FROM public.patient_master WHERE umr_id ~ '^UMR\d+$'), 0),
  COALESCE((SELECT MAX(NULLIF(regexp_replace(umr_number, '\D', '', 'g'), '')::int) FROM public.patient_registrations WHERE umr_number ~ '^UMR\d+$'), 0)
)
WHERE counter_key = 'main';

COMMENT ON FUNCTION public.generate_umr_number() IS
  'Allocate next LIMS UMR from patient_master + patient_registrations only. Estimates do not use UMR.';
