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
  v_max_est int;
  v_next    int;
BEGIN
  SELECT last_sequence INTO v_counter
  FROM umr_counter
  WHERE counter_key = 'main'
  FOR UPDATE;

  SELECT COALESCE(MAX(NULLIF(regexp_replace(umr_id,     '\D','','g'),'')::int),0) INTO v_max_pm  FROM patient_master       WHERE umr_id     ~ '^UMR\d+$';
  SELECT COALESCE(MAX(NULLIF(regexp_replace(umr_number, '\D','','g'),'')::int),0) INTO v_max_pr  FROM patient_registrations WHERE umr_number ~ '^UMR\d+$';
  SELECT COALESCE(MAX(NULLIF(regexp_replace(umr_number, '\D','','g'),'')::int),0) INTO v_max_est FROM estimates             WHERE umr_number ~ '^UMR\d+$';

  v_next := GREATEST(COALESCE(v_counter,0), v_max_pm, v_max_pr, v_max_est) + 1;

  UPDATE umr_counter SET last_sequence = v_next WHERE counter_key = 'main';

  RETURN 'UMR' || lpad(v_next::text, 7, '0');
END;
$$;

UPDATE public.umr_counter
SET last_sequence = GREATEST(
  last_sequence,
  COALESCE((SELECT MAX(NULLIF(regexp_replace(umr_id,     '\D','','g'),'')::int) FROM public.patient_master       WHERE umr_id     ~ '^UMR\d+$'), 0),
  COALESCE((SELECT MAX(NULLIF(regexp_replace(umr_number, '\D','','g'),'')::int) FROM public.patient_registrations WHERE umr_number ~ '^UMR\d+$'), 0),
  COALESCE((SELECT MAX(NULLIF(regexp_replace(umr_number, '\D','','g'),'')::int) FROM public.estimates             WHERE umr_number ~ '^UMR\d+$'), 0)
)
WHERE counter_key = 'main';